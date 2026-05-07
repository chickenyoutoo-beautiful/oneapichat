#!/usr/bin/env python3
import sqlite3
from datetime import datetime
from pathlib import Path

class LearningTracker:
    DB_PATH = Path(__file__).parent / "learning_records.db"

    def __init__(self, user_id=None):
        self.user_id = user_id
        self.conn = sqlite3.connect(str(self.DB_PATH))
        self._init_db()

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
                work_done INTEGER DEFAULT 0, last_update TEXT, PRIMARY KEY (id, user_id));
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
        self.conn.execute("INSERT INTO courses (id,user_id,title,teacher,status,last_study_time) VALUES (?,?,?,?,'in_progress',?) ON CONFLICT(id,user_id) DO UPDATE SET title=excluded.title,teacher=excluded.teacher,last_study_time=excluded.last_study_time",
            (course_id, self.user_id, title, teacher, datetime.now().isoformat()))
        self.conn.commit()

    def log_video(self, chapter_id, video_name, duration):
        if not self.user_id: return
        self.conn.execute("INSERT INTO video_logs (user_id,chapter_id,video_name,duration,watched_at) VALUES (?,?,?,?,?)",
            (self.user_id, chapter_id, video_name, duration, datetime.now().isoformat()))
        self.conn.commit()

    def update_chapter(self, chapter_id, course_id, title='', status=None, video_count=None, work_count=None, video_done=None, work_done=None):
        if not self.user_id: return
        if status:
            self.conn.execute("INSERT INTO chapters (id,user_id,course_id,title,status,last_update) VALUES (?,?,?,?,?,?) ON CONFLICT(id,user_id) DO UPDATE SET status=excluded.status,last_update=excluded.last_update",
                (chapter_id, self.user_id, course_id, title, status, datetime.now().isoformat()))
        if video_count is not None:
            ex = self.conn.execute("SELECT video_count FROM chapters WHERE id=? AND user_id=?",(chapter_id,self.user_id)).fetchone()
            if ex: self.conn.execute("UPDATE chapters SET video_count=? WHERE id=? AND user_id=?",(video_count,chapter_id,self.user_id))
            else: self.conn.execute("INSERT INTO chapters (id,user_id,course_id,title,video_count,last_update) VALUES (?,?,?,?,?,?)",(chapter_id,self.user_id,course_id,title,video_count,datetime.now().isoformat()))
        if work_count is not None:
            ex = self.conn.execute("SELECT work_count FROM chapters WHERE id=? AND user_id=?",(chapter_id,self.user_id)).fetchone()
            if ex: self.conn.execute("UPDATE chapters SET work_count=? WHERE id=? AND user_id=?",(work_count,chapter_id,self.user_id))
            else: self.conn.execute("INSERT INTO chapters (id,user_id,course_id,title,work_count,last_update) VALUES (?,?,?,?,?,?)",(chapter_id,self.user_id,course_id,title,work_count,datetime.now().isoformat()))
        # video_done=True: 增量+1，同时检查是否全部完成并更新 status
        if video_done is True:
            self.conn.execute("UPDATE chapters SET video_done = video_done + 1, last_update = ?, status = CASE WHEN video_count > 0 AND video_done + 1 >= video_count THEN 'completed' ELSE status END WHERE id=? AND user_id=?",
                (datetime.now().isoformat(), chapter_id, self.user_id))
        elif video_done is not None:
            self.conn.execute("UPDATE chapters SET video_done=? WHERE id=? AND user_id=?",(video_done,chapter_id,self.user_id))
        # work_done=True: 增量+1，同时检查是否全部完成并更新 status
        if work_done is True:
            self.conn.execute("UPDATE chapters SET work_done = work_done + 1, last_update = ?, status = CASE WHEN work_count > 0 AND work_done + 1 >= work_count THEN 'completed' ELSE status END WHERE id=? AND user_id=?",
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
        completed_videos = sum(1 for c in chapters if c[4]=='completed' and c[2]>0 and c[0] is not None and c[0]>=c[2])
        completed_works = sum(1 for c in chapters if c[4]=='completed' and c[3]>0 and c[1] is not None and c[1]>=c[3])
        all_chapters_completed = all(c[4]=='completed' for c in chapters)
        # 课程完成：全部章节完成 且 计数达标（或章节数为0且全部完成）
        course_completed = all_chapters_completed and (
            (total_videos > 0 and completed_videos >= total_videos) or
            (total_works > 0 and completed_works >= total_works) or
            (total_videos == 0 and total_works == 0 and completed_videos >= len(chapters))
        )
        new_status = 'completed' if course_completed else 'in_progress'
        self.conn.execute("UPDATE courses SET total_videos=?,completed_videos=?,total_works=?,completed_works=?,status=?,last_study_time=? WHERE id=? AND user_id=?",
            (total_videos,completed_videos,total_works,completed_works,new_status,datetime.now().isoformat(),course_id,self.user_id))
