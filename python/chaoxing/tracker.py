#!/usr/bin/env python3
import sqlite3
from datetime import datetime
from pathlib import Path

class LearningTracker:
    DB_PATH = Path(__file__).parent / "learning_records.db"

    def __init__(self, user_id=None, phone=None):
        # 优先用 phone（学习通账号）作为 user_id，实现跨聊天账号共享数据
        self.user_id = phone if phone else user_id
        self.phone = phone
        # ★ 确保 DB 文件和目录可写（以防 owner 不匹配导致 readonly 错误）
        self.DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(self.DB_PATH))
        self._ensure_writable()
        self._init_db()

    def _ensure_writable(self):
        """写能力探测 + 自修复。

        sqlite3.connect() 在只读文件上不抛错（SQLite 惰性降级为只读打开），
        真正的 "attempt to write a readonly database" 出现在第一次写操作时——
        因此用 CREATE/DROP 临时表主动触发真实写页面（只读库立即抛 OperationalError，探测后零残留）。
        探测失败则尝试修复：目录 775 + 文件 664（chown 到 www-data 需 root 才有效），
        修复后重连重测；仍失败抛出带修复命令的明确错误。
        """
        import os

        def _probe():
            self.conn.execute("CREATE TABLE IF NOT EXISTS __rw_probe (id INTEGER)")
            self.conn.commit()
            self.conn.execute("DROP TABLE IF EXISTS __rw_probe")
            self.conn.commit()

        try:
            _probe()
            return
        except sqlite3.OperationalError as e:
            if "readonly" not in str(e).lower() and "permission" not in str(e).lower():
                raise
            # 只读 → 尝试自修复（属主/root 才能生效；www-data 改不动别人的文件则保持原状）
            try:
                os.chmod(str(self.DB_PATH.parent), 0o775)
                os.chmod(str(self.DB_PATH), 0o664)
                if os.geteuid() == 0:
                    import grp, pwd
                    www_uid = pwd.getpwnam('www-data').pw_uid
                    www_gid = grp.getgrnam('www-data').gr_gid
                    os.chown(str(self.DB_PATH), www_uid, www_gid)
                    os.chown(str(self.DB_PATH.parent), www_uid, www_gid)
            except Exception:
                pass
            self.conn = sqlite3.connect(str(self.DB_PATH))
            try:
                _probe()
                return
            except sqlite3.OperationalError as e2:
                raise sqlite3.OperationalError(
                    f"learning_records.db 不可写 (uid={os.geteuid()}): {e2} — "
                    f"请以 root 执行: chown www-data:www-data python/chaoxing/learning_records.db "
                    f"&& chmod 664 python/chaoxing/learning_records.db && chmod 775 python/chaoxing/"
                ) from e2

    def _init_db(self):
        self.conn.executescript("""
            CREATE TABLE IF NOT EXISTS courses (
                id TEXT NOT NULL, user_id TEXT NOT NULL, title TEXT, teacher TEXT,
                status TEXT DEFAULT 'not_started', completed_videos INTEGER DEFAULT 0,
                completed_works INTEGER DEFAULT 0, total_videos INTEGER DEFAULT 0,
                total_works INTEGER DEFAULT 0, last_study_time TEXT,
                PRIMARY KEY (id, user_id));
            CREATE TABLE IF NOT EXISTS chapters (
                id TEXT NOT NULL, user_id TEXT NOT NULL, course_id TEXT NOT NULL,
                title TEXT, status TEXT DEFAULT 'not_started', video_count INTEGER DEFAULT 0,
                video_done INTEGER DEFAULT 0, work_count INTEGER DEFAULT 0,
                work_done INTEGER DEFAULT 0, blocked_reason TEXT, last_update TEXT,
                PRIMARY KEY (id, user_id));
            CREATE TABLE IF NOT EXISTS video_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, chapter_id TEXT,
                video_name TEXT, duration INTEGER, watched_at TEXT);
        """)
        # 迁移旧表：添加新增列（若无则添加）
        for table, col, dtype in [
            ("courses", "last_study_time", "TEXT"),
            ("courses", "completed_videos", "INTEGER DEFAULT 0"),
            ("courses", "completed_works", "INTEGER DEFAULT 0"),
            ("courses", "total_videos", "INTEGER DEFAULT 0"),
            ("courses", "total_works", "INTEGER DEFAULT 0"),
            ("chapters", "video_count", "INTEGER DEFAULT 0"),
            ("chapters", "video_done", "INTEGER DEFAULT 0"),
            ("chapters", "work_count", "INTEGER DEFAULT 0"),
            ("chapters", "work_done", "INTEGER DEFAULT 0"),
            ("chapters", "blocked_reason", "TEXT"),
            ("chapters", "last_update", "TEXT"),
            ("video_logs", "video_name", "TEXT"),
            ("video_logs", "watched_at", "TEXT"),
        ]:
            try:
                self.conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {dtype}")
            except Exception:
                pass  # 列已存在

    def start_course(self, course_id, title, teacher=''):
        if not self.user_id: return
        # ★ 不再跳过已开始/已完成的课：课程可能新增内容，需重新检测
        # 只跳过 not_started 的课程（首次创建）
        self.conn.execute(
            "INSERT INTO courses (id,user_id,title,teacher,status,last_study_time) VALUES (?,?,?,?,'in_progress',?) ON CONFLICT(id,user_id) DO UPDATE SET last_study_time=excluded.last_study_time",
            (course_id, self.user_id, title, teacher, datetime.now().isoformat()))
        self.conn.commit()

    def log_video(self, chapter_id, video_name, duration):
        if not self.user_id: return
        self.conn.execute("INSERT INTO video_logs (user_id,chapter_id,video_name,duration,watched_at) VALUES (?,?,?,?,?)",
            (self.user_id, chapter_id, video_name, duration, datetime.now().isoformat()))
        self.conn.commit()

    def update_chapter(self, chapter_id, course_id, title='', status=None, video_count=None,
                       work_count=None, video_done=None, work_done=None, blocked_reason=None):
        if not self.user_id: return
        # 服务端再次返回未完成任务时，即使本地旧记录是 completed 也必须降级。
        if status:
            ex = self.conn.execute("SELECT video_count, work_count, status FROM chapters WHERE id=? AND user_id=?",(chapter_id,self.user_id)).fetchone()
            new_vc = video_count if video_count is not None else (ex[0] if ex else 0)
            new_wc = work_count if work_count is not None else (ex[1] if ex else 0)
            if ex and ex[2] == 'completed' and status == 'running':
                self.conn.execute("UPDATE chapters SET video_count=?, work_count=?, video_done=0, work_done=0, status='running', last_update=? WHERE id=? AND user_id=?",
                    (new_vc, new_wc, datetime.now().isoformat(), chapter_id, self.user_id))
                video_count = None
                work_count = None
                status = None
            if status:
                self.conn.execute("INSERT INTO chapters (id,user_id,course_id,title,status,last_update) VALUES (?,?,?,?,?,?) ON CONFLICT(id,user_id) DO UPDATE SET status=excluded.status,last_update=excluded.last_update",
                    (chapter_id, self.user_id, course_id, title, status, datetime.now().isoformat()))
            # 重新扫描或完成章节时清除旧阻塞原因；blocked 状态保留明确的人工作业原因。
            if status in ('running', 'completed'):
                self.conn.execute("UPDATE chapters SET blocked_reason=NULL WHERE id=? AND user_id=?",
                    (chapter_id, self.user_id))
            elif status == 'blocked':
                self.conn.execute("UPDATE chapters SET blocked_reason=? WHERE id=? AND user_id=?",
                    (blocked_reason or '需要人工处理', chapter_id, self.user_id))
        if video_count is not None:
            ex = self.conn.execute("SELECT video_count FROM chapters WHERE id=? AND user_id=?",(chapter_id,self.user_id)).fetchone()
            if ex: self.conn.execute("UPDATE chapters SET video_count=? WHERE id=? AND user_id=?",(video_count,chapter_id,self.user_id))
            else: self.conn.execute("INSERT INTO chapters (id,user_id,course_id,title,video_count,last_update) VALUES (?,?,?,?,?,?)",(chapter_id,self.user_id,course_id,title,video_count,datetime.now().isoformat()))
        if work_count is not None:
            ex = self.conn.execute("SELECT work_count FROM chapters WHERE id=? AND user_id=?",(chapter_id,self.user_id)).fetchone()
            if ex: self.conn.execute("UPDATE chapters SET work_count=? WHERE id=? AND user_id=?",(work_count,chapter_id,self.user_id))
            else: self.conn.execute("INSERT INTO chapters (id,user_id,course_id,title,work_count,last_update) VALUES (?,?,?,?,?,?)",(chapter_id,self.user_id,course_id,title,work_count,datetime.now().isoformat()))
        # video_done=True: 增量+1（上限 video_count，防重复累加），检查是否全部完成
        # 修复：只有 video 章节（work_count=0）视频达标才标记 completed；混合章节需等 work 也完成
        if video_done is True:
            self.conn.execute("UPDATE chapters SET video_done = MIN(video_done + 1, video_count), last_update = ?, status = CASE WHEN video_count > 0 AND video_done + 1 >= video_count AND work_count = 0 THEN 'completed' WHEN video_count > 0 AND video_done + 1 >= video_count AND work_count > 0 AND work_done >= work_count THEN 'completed' ELSE status END WHERE id=? AND user_id=?",
                (datetime.now().isoformat(), chapter_id, self.user_id))
        elif video_done is not None:
            self.conn.execute("UPDATE chapters SET video_done=? WHERE id=? AND user_id=?",(video_done,chapter_id,self.user_id))
        # work_done=True: 增量+1（上限 work_count，防重复累加），检查是否全部完成
        # 修复：只有 work 章节（video_count=0）答题达标才标记 completed；混合章节需等 video 也完成
        if work_done is True:
            self.conn.execute("UPDATE chapters SET work_done = MIN(work_done + 1, work_count), last_update = ?, status = CASE WHEN work_count > 0 AND work_done + 1 >= work_count AND video_count = 0 THEN 'completed' WHEN work_count > 0 AND work_done + 1 >= work_count AND video_count > 0 AND video_done >= video_count THEN 'completed' ELSE status END WHERE id=? AND user_id=?",
                (datetime.now().isoformat(), chapter_id, self.user_id))
        elif work_done is not None:
            self.conn.execute("UPDATE chapters SET work_done=? WHERE id=? AND user_id=?",(work_done,chapter_id,self.user_id))
        self._update_course_stats(course_id)
        self.conn.commit()

    def _update_course_stats(self, course_id):
        if not self.user_id: return
        chapters = self.conn.execute("SELECT video_done,work_done,video_count,work_count,status FROM chapters WHERE course_id=? AND user_id=?",(course_id,self.user_id)).fetchall()
        if not chapters or not chapters[0]: return
        total_videos = sum(c[2] for c in chapters if c[2])
        total_works = sum(c[3] for c in chapters if c[3])
        # 修复：completed_videos 统计所有章节（含混合章节）的 video 完成量
        completed_videos = sum(
            c[0] for c in chapters
            if c[4]=='completed' and c[2]>0 and c[0] is not None and c[0]>=c[2]
        )
        # 答题完成：所有章节（含混合章节）的 work 完成量
        completed_works = sum(
            c[1] for c in chapters
            if c[4]=='completed' and c[3]>0 and c[1] is not None and c[1]>=c[3]
        )
        # 修复：只有 status='completed' 才算章节完成
        # 旧逻辑误判 running+0计数 章节为完成，导致未刷课程被标记 completed
        all_chapters_completed = all(c[4] == 'completed' for c in chapters)
        # 章节状态来自处理后的服务端任务卡复核；计数仅用于展示，不再参与完成判定。
        course_completed = bool(chapters) and all_chapters_completed
        new_status = 'completed' if course_completed else 'in_progress'
        self.conn.execute("UPDATE courses SET total_videos=?,completed_videos=?,total_works=?,completed_works=?,status=?,last_study_time=? WHERE id=? AND user_id=?",
            (total_videos,completed_videos,total_works,completed_works,new_status,datetime.now().isoformat(),course_id,self.user_id))
