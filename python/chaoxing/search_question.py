#!/usr/bin/env python3
"""搜题接口 - 由 PHP 调用，返回答案"""
import sys, os, json, argparse

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--title', default='')
    p.add_argument('--options', default='')
    p.add_argument('--type', default='single')
    args = p.parse_args()

    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    sys.path.insert(0, base_dir)
    os.chdir(base_dir)

    # 抑制日志
    from loguru import logger as _lr
    _lr.remove()
    _lr.add(lambda _: None)

    from chaoxing.answer import Tiku

    tiku = Tiku()
    try:
        tiku = tiku.get_tiku_from_config()
        tiku.init_tiku()
    except Exception:
        pass

    if tiku.DISABLE:
        print(json.dumps({"error": "题库未配置"}))
        return

    # 类型映射
    type_map = {'single': 0, 'multiple': 1, 'completion': 2, 'judgement': 3}
    q_type = type_map.get(args.type, 0)

    q_info = {
        'title': args.title,
        'options': args.options,
        'type': q_type,
        # 去掉前缀"【单选题】"等
        '_raw_title': args.title,
    }
    # 去除题型前缀
    import re
    q_info['title'] = re.sub(r'^【[^】]+】', '', args.title).strip()

    try:
        answer = tiku.query(q_info)
        if answer:
            print(json.dumps({"answer": answer}))
        else:
            print(json.dumps({"error": "未找到答案"}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == '__main__':
    main()
