#!/usr/bin/env python3
"""Generate config.ini for 刷课 from environment variables."""
import os

with open("config.ini", "w", encoding="utf-8") as f:
    f.write(f"""[common]
username = {os.environ.get('CHAOXING_USERNAME', '')}
password = {os.environ.get('CHAOXING_PASSWORD', '')}
course_list = {os.environ.get('CHAOXING_COURSE_ID', '')}
speed = 2
auto_next = true
brush_mode = all
chapter_order = sequential

[tiku]
provider = TikuYanxi,TikuAI
submit = true
tokens = {os.environ.get('CHAOXING_TIKU_TOKEN', '')}
true_list = 正确,对,√,是
false_list = 错误,错,×,否,不对,不正确
ai_base_url = {os.environ.get('CHAOXING_TIKU_URL', 'https://oneapi.naujtrats.xyz/v1')}
ai_model = {os.environ.get('CHAOXING_TIKU_MODEL', 'deepseek-v4-flash')}
""")
print("config.ini generated")