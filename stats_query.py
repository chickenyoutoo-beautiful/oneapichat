#!/usr/bin/env python3
"""查询刷课统计数据（供PHP API调用）"""
import sqlite3, json, sys, argparse, os, tempfile

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
db_path = os.path.join(SCRIPT_DIR, 'api', 'learning_records.db')
if not os.path.exists(db_path):
    alt = os.path.join(tempfile.gettempdir(), 'AutomaticCB', 'api', 'learning_records.db')
    if os.path.exists(alt):
        db_path = alt

parser = argparse.ArgumentParser()
parser.add_argument('--user-id', default='')
args = parser.parse_args()
user_id = args.user_id.strip()

# 如果没有传 user-id，返回空（防止未授权查询全部）
if not user_id:
    print(json.dumps({
        'total_courses': 0, 'completed': 0, 'videos_done': 0, 'works_done': 0
    }))
    sys.exit(0)

try:
    c = sqlite3.connect(db_path)
    r = c.execute("""
        SELECT COUNT(*),
               SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END),
               SUM(completed_videos),
               SUM(completed_works)
        FROM courses
        WHERE user_id = ?
    """, (user_id,)).fetchone()
    c.close()
    print(json.dumps({
        'total_courses': r[0] or 0,
        'completed': r[1] or 0,
        'videos_done': r[2] or 0,
        'works_done': r[3] or 0
    }))
except Exception as e:
    print(json.dumps({'error': str(e), 'total_courses': 0, 'completed': 0, 'videos_done': 0, 'works_done': 0}))
