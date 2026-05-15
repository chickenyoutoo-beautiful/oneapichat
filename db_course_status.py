#!/usr/bin/env python3
"""查询 learning_records.db 中所有课程的 status / completed_videos / completed_works / total_videos / total_works"""
import sqlite3, json, sys, os, argparse, tempfile

# 读取与 api/tracker.py 相同的 learning_records.db
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
db_path = os.path.join(SCRIPT_DIR, 'api', 'learning_records.db')
# fallback: 旧版路径（/tmp/AutomaticCB/api/learning_records.db）
if not os.path.exists(db_path):
    alt = os.path.join(tempfile.gettempdir(), 'AutomaticCB', 'api', 'learning_records.db')
    if os.path.exists(alt):
        db_path = alt

parser = argparse.ArgumentParser()
parser.add_argument('--user-id', default='')
parser.add_argument('--phone', default='')
parser.add_argument('--reset-in-progress', action='store_true', help='重置 in_progress/running 状态为 not_started')
parser.add_argument('--stats', action='store_true', help='统计模式：返回该用户的聚合统计（取代 stats_query.py）')
parser.add_argument('--clear-cache', action='store_true', help='清空该用户所有课程记录（切换账号时清理旧数据）')
args = parser.parse_args()
# ★ 账号同步：同时用 user-id（auth id）和 phone 查询
_auth_id = args.user_id.strip() if args.user_id else ''
_phone_val = args.phone.strip() if args.phone else ''
# 构建去重的 user_id 列表
_user_ids = list(dict.fromkeys([uid for uid in [_auth_id, _phone_val] if uid]))
user_id = _user_ids[0] if _user_ids else ''
user_ids = _user_ids

try:
    conn = sqlite3.connect(db_path)
    c = conn.cursor()

    # 确保 user_id 列存在
    c.execute("PRAGMA table_info(courses)")
    cols = [row[1] for row in c.fetchall()]
    if 'user_id' not in cols:
        c.execute("ALTER TABLE courses ADD COLUMN user_id TEXT DEFAULT ''")
        conn.commit()

    # 添加索引优化
    c.execute("CREATE INDEX IF NOT EXISTS idx_courses_user_id ON courses(user_id)")
    conn.commit()

    # ★ 清空该用户缓存（切换账号时用）
    if args.clear_cache:
        if not user_id:
            print(json.dumps({'error': '--clear-cache 需要 --user-id 参数'}))
            conn.close()
            sys.exit(1)
        placeholders = ','.join('?' * len(user_ids))
        c.execute(f"DELETE FROM courses WHERE user_id IN ({placeholders})", user_ids)
        conn.commit()
        print(json.dumps({'success': True, 'deleted': c.rowcount, 'action': 'clear_cache'}))
        conn.close()
        sys.exit(0)

    # ★ 统计模式（取代 stats_query.py）
    if args.stats:
        if not user_id:
            print(json.dumps({'total_courses': 0, 'completed': 0, 'videos_done': 0, 'works_done': 0}))
            conn.close()
            sys.exit(0)
        placeholders = ','.join('?' * len(user_ids))
        r = c.execute(f"""
            SELECT COUNT(*),
                   SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END),
                   SUM(completed_videos),
                   SUM(completed_works)
            FROM courses
            WHERE user_id IN ({placeholders})
        """, user_ids).fetchone()
        conn.close()
        print(json.dumps({
            'total_courses': r[0] or 0,
            'completed': r[1] or 0,
            'videos_done': r[2] or 0,
            'works_done': r[3] or 0
        }))
        sys.exit(0)

    # ★ 重置 in_progress 课程（stop 时调用）
    if args.reset_in_progress and user_id:
        placeholders = ','.join('?' * len(user_ids))
        c.execute(f"UPDATE courses SET status='not_started' WHERE user_id IN ({placeholders}) AND status IN ('in_progress','running')", user_ids)
        conn.commit()
        print(json.dumps({'success': True, 'reset': c.rowcount}))
        conn.close()
        sys.exit(0)

    # 如果没有传 user-id，返回空（防止未授权查询全部）
    if not user_id:
        print(json.dumps({'courses': []}))
        conn.close()
        sys.exit(0)

    # 带 user_id 过滤的查询
    placeholders = ','.join('?' * len(user_ids))
    rows = c.execute(f"""
        SELECT id, status, completed_videos, completed_works, total_videos, total_works
        FROM courses
        WHERE user_id IN ({placeholders})
    """, user_ids).fetchall()
    conn.close()

    # 按 course id 去重（同一个课程可能在多组 user_id 下重复存储），取中最大值
    seen = {}
    for row in rows:
        cid = row[0]
        if cid not in seen:
            seen[cid] = row
        else:
            # 合并：取较大的 completed 值
            old = list(seen[cid])
            new = list(row)
            seen[cid] = tuple(
                new[i] if i <= 1 else max((old[i] or 0), (new[i] or 0))
                for i in range(len(row))
            )

    courses = []
    for cid, row in seen.items():
        courses.append({
            'id': row[0],
            'status': row[1],
            'completed_videos': row[2],
            'completed_works': row[3],
            'total_videos': row[4],
            'total_works': row[5]
        })
    print(json.dumps({'courses': courses}))
except Exception as e:
    print(json.dumps({'error': str(e)}))
