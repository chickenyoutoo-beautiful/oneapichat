#!/usr/bin/env python3
"""查询 learning_records.db 中所有课程的 status / completed_videos / completed_works / total_videos / total_works"""
import sqlite3, json, sys, os, argparse

db_path = '/tmp/AutomaticCB/api/learning_records.db'

parser = argparse.ArgumentParser()
parser.add_argument('--user-id', default='')
parser.add_argument('--phone', default='')
parser.add_argument('--reset-in-progress', action='store_true', help='重置 in_progress/running 状态为 not_started')
parser.add_argument('--stats', action='store_true', help='统计模式：返回该用户的聚合统计（取代 stats_query.py）')
parser.add_argument('--clear-cache', action='store_true', help='清空该用户所有课程记录（切换账号时清理旧数据）')
args = parser.parse_args()
# ★ 账号同步：phone 作为唯一标准，优先使用 phone，user_id 仅作兼容
_phone = args.phone.strip() if args.phone else ''
user_id = _phone if _phone else args.user_id.strip()

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
        c.execute("DELETE FROM courses WHERE user_id = ?", (user_id,))
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
        r = c.execute("""
            SELECT COUNT(*),
                   SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END),
                   SUM(completed_videos),
                   SUM(completed_works)
            FROM courses
            WHERE user_id = ?
        """, (user_id,)).fetchone()
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
        c.execute("UPDATE courses SET status='not_started' WHERE user_id=? AND status IN ('in_progress','running')", (user_id,))
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
    rows = c.execute("""
        SELECT id, status, completed_videos, completed_works, total_videos, total_works
        FROM courses
        WHERE user_id = ?
    """, (user_id,)).fetchall()
    conn.close()

    courses = []
    for row in rows:
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
