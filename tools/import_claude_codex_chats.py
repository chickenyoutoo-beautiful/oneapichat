
import os
import sys
import json
import glob
import re
import shutil
from datetime import datetime, timezone

USER_ID = "u_a418898cebde5e2b1e15d181"
DATA_DIR = "/var/www/html/oneapichat/chat_data"
ALL_JSON = f"{DATA_DIR}/user_{USER_ID}_all.json"

with open(ALL_JSON, 'r', encoding='utf-8') as f:
    all_data = json.load(f)

# 清理旧的 claude_ 和 codex_ 残留
keys_to_remove = [k for k in all_data['chats'].keys() if k.startswith('claude_') or k.startswith('codex_')]
for k in keys_to_remove:
    del all_data['chats'][k]

old_single_files = glob.glob(f"{DATA_DIR}/user_{USER_ID}_claude_*.json") + glob.glob(f"{DATA_DIR}/user_{USER_ID}_codex_*.json")
for fpath in old_single_files:
    try:
        os.remove(fpath)
    except Exception:
        pass

def parse_claude_jsonl(fpath):
    title = None
    messages = []
    created_at = None
    session_id = os.path.basename(fpath).replace('.jsonl', '')
    
    with open(fpath, 'r', encoding='utf-8', errors='ignore') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
            except:
                continue
                
            if data.get('type') == 'ai-title' and data.get('aiTitle'):
                title = data.get('aiTitle').strip()
                
            if data.get('type') == 'user' and 'message' in data:
                msg_obj = data['message']
                content_raw = msg_obj.get('content', '')
                text = ""
                if isinstance(content_raw, str):
                    text = content_raw
                elif isinstance(content_raw, list):
                    for b in content_raw:
                        if isinstance(b, dict) and b.get('type') == 'text':
                            text += b.get('text', '')
                
                ts_str = data.get('timestamp') or msg_obj.get('timestamp')
                ts = None
                if ts_str:
                    try:
                        ts = int(datetime.fromisoformat(ts_str.replace('Z', '+00:00')).timestamp() * 1000)
                    except:
                        pass
                if not ts:
                    ts = int(datetime.now().timestamp() * 1000)
                if not created_at:
                    created_at = ts
                    
                if text.strip():
                    messages.append({
                        "role": "user",
                        "content": text.strip(),
                        "text": text.strip(),
                        "files": [],
                        "time": ts
                    })
                    
            msg_obj = data.get('message')
            if isinstance(msg_obj, dict) and msg_obj.get('role') == 'assistant':
                content_raw = msg_obj.get('content', [])
                text = ""
                reasoning = ""
                tool_calls = []
                
                if isinstance(content_raw, str):
                    text = content_raw
                elif isinstance(content_raw, list):
                    for b in content_raw:
                        if not isinstance(b, dict):
                            continue
                        b_type = b.get('type')
                        if b_type == 'text':
                            text += b.get('text', '')
                        elif b_type == 'thinking':
                            reasoning += b.get('thinking', '')
                        elif b_type == 'tool_use':
                            tool_name = b.get('name', 'tool')
                            tool_calls.append(tool_name)
                            
                ts_str = data.get('timestamp') or msg_obj.get('timestamp')
                ts = None
                if ts_str:
                    try:
                        ts = int(datetime.fromisoformat(ts_str.replace('Z', '+00:00')).timestamp() * 1000)
                    except:
                        pass
                if not ts:
                    ts = int(datetime.now().timestamp() * 1000)
                    
                if text.strip() or reasoning.strip() or tool_calls:
                    full_content = text.strip()
                    if not full_content and tool_calls:
                        full_content = f"*(调用工具: {', '.join(tool_calls)})*"
                    elif tool_calls and full_content:
                        full_content += f"\n\n*(调用工具: {', '.join(tool_calls)})*"
                    elif not full_content and reasoning.strip():
                        full_content = "*(思考中 / 完成分析)*"
                        
                    msg_item = {
                        "role": "assistant",
                        "content": full_content,
                        "reasoning": reasoning.strip(),
                        "time": ts
                    }
                    messages.append(msg_item)
                    
    deduped = []
    for m in messages:
        if deduped and deduped[-1]['role'] == m['role'] and deduped[-1]['content'] == m['content'] and deduped[-1].get('reasoning') == m.get('reasoning'):
            continue
        deduped.append(m)
        
    if not deduped:
        return None
        
    if not title:
        for m in deduped:
            if m['role'] == 'user':
                title = m['content'][:50].replace('\n', ' ')
                break
    if not title:
        title = "Claude 会话"
        
    iso_time = datetime.fromtimestamp((created_at or 0)/1000, tz=timezone.utc).isoformat() if created_at else datetime.now(timezone.utc).isoformat()
    
    return {
        "session_id": session_id,
        "title": title,
        "messages": deduped,
        "created_at": created_at,
        "updated_at": iso_time,
        "source": "claude_code"
    }

def clean_codex_text(text):
    text = re.sub(r'<environment_context>.*?</environment_context>', '', text, flags=re.DOTALL)
    text = re.sub(r'<instructions>.*?</instructions>', '', text, flags=re.DOTALL)
    text = re.sub(r'# AGENTS\.MD.*', '', text, flags=re.DOTALL)
    return text.strip()

def parse_codex_file(fpath):
    messages = []
    title = None
    created_at = None
    session_id = os.path.basename(fpath).replace('.jsonl', '')
    if session_id.startswith('rollout-'):
        parts = session_id.split('-')
        session_id = parts[-1]
        
    with open(fpath, 'r', encoding='utf-8', errors='ignore') as f:
        for line in f:
            if not line.strip():
                continue
            try:
                item = json.loads(line)
            except:
                continue
                
            itype = item.get('type')
            payload = item.get('payload', {})
            ts_str = item.get('timestamp')
            ts = None
            if ts_str:
                try:
                    ts = int(datetime.fromisoformat(ts_str.replace('Z', '+00:00')).timestamp() * 1000)
                except:
                    pass
            if not ts:
                ts = int(datetime.now().timestamp() * 1000)
            if not created_at:
                created_at = ts
                
            if itype == 'response_item':
                ptype = payload.get('type')
                if ptype == 'message':
                    role = payload.get('role')
                    if role in ['user', 'assistant', 'system']:
                        content_list = payload.get('content', [])
                        text = ""
                        for c in content_list:
                            if isinstance(c, dict):
                                if c.get('type') in ['input_text', 'output_text', 'text']:
                                    text += c.get('text', '')
                            elif isinstance(c, str):
                                text += c
                        cleaned_txt = clean_codex_text(text) if role == 'user' else text.strip()
                        if cleaned_txt:
                            if role == 'user':
                                messages.append({'role': 'user', 'content': cleaned_txt, 'text': cleaned_txt, 'files': [], 'time': ts})
                                if not title:
                                    title = cleaned_txt[:50].replace('\n', ' ')
                            elif role == 'assistant':
                                messages.append({'role': 'assistant', 'content': cleaned_txt, 'reasoning': '', 'time': ts})
                elif ptype == 'reasoning':
                    summary = payload.get('summary', [])
                    r_text = ""
                    for s in summary:
                        if isinstance(s, dict):
                            r_text += s.get('text', '')
                    if r_text.strip() and messages and messages[-1]['role'] == 'assistant':
                        messages[-1]['reasoning'] = r_text.strip()
                elif ptype == 'function_call':
                    fname = payload.get('name', 'tool')
                    tool_desc = f"*(调用工具: {fname})*"
                    if messages and messages[-1]['role'] == 'assistant':
                        messages[-1]['content'] += f"\n\n{tool_desc}"
                    else:
                        messages.append({'role': 'assistant', 'content': tool_desc, 'reasoning': '', 'time': ts})
            elif itype == 'user_message':
                txt = payload.get('text', '')
                cleaned_txt = clean_codex_text(txt)
                if cleaned_txt:
                    messages.append({'role': 'user', 'content': cleaned_txt, 'text': cleaned_txt, 'files': [], 'time': ts})
                    if not title:
                        title = cleaned_txt[:50].replace('\n', ' ')
            elif itype == 'assistant_message':
                txt = payload.get('text', '')
                if txt.strip():
                    messages.append({'role': 'assistant', 'content': txt.strip(), 'reasoning': '', 'time': ts})

    deduped = []
    for m in messages:
        if deduped and deduped[-1]['role'] == m['role'] and deduped[-1]['content'] == m['content']:
            continue
        deduped.append(m)
        
    if not deduped:
        return None
        
    iso_time = datetime.fromtimestamp((created_at or 0)/1000, tz=timezone.utc).isoformat() if created_at else datetime.now(timezone.utc).isoformat()
    return {
        'session_id': session_id,
        'title': title or 'Codex 会话',
        'messages': deduped,
        'created_at': created_at,
        'updated_at': iso_time,
        'source': 'codex'
    }

claude_files = sorted(glob.glob('/home/naujtrats/.claude/projects/*/*.jsonl'))
claude_imported = 0
for cf in claude_files:
    parsed = parse_claude_jsonl(cf)
    if not parsed:
        continue
    sid_short = re.sub(r'[^a-zA-Z0-9_-]', '', parsed['session_id'])[:16]
    chat_id = f"claude_{sid_short}"
    
    single_file = f"{DATA_DIR}/user_{USER_ID}_{chat_id}.json"
    single_doc = {
        "chat_id": chat_id,
        "title": parsed["title"],
        "userId": USER_ID,
        "updated_at": parsed["updated_at"],
        "messages": parsed["messages"],
        "source": "claude_code_import",
        "source_session_id": parsed["session_id"]
    }
    with open(single_file, 'w', encoding='utf-8') as f:
        json.dump(single_doc, f, ensure_ascii=False, indent=2)
    
    all_data['chats'][chat_id] = {
        "title": parsed["title"],
        "updated_at": parsed["updated_at"],
        "userId": USER_ID,
        "msgCount": len(parsed["messages"]),
        "messages": parsed["messages"],
        "_localIndex": True,
        "source": "claude_code_import"
    }
    claude_imported += 1

codex_files = sorted(glob.glob('/home/naujtrats/.codex/sessions/**/rollout-*.jsonl', recursive=True))
codex_imported = 0
for cf in codex_files:
    parsed = parse_codex_file(cf)
    if not parsed:
        continue
    sid_short = re.sub(r'[^a-zA-Z0-9_-]', '', parsed['session_id'])[:16]
    chat_id = f"codex_{sid_short}"
    
    single_file = f"{DATA_DIR}/user_{USER_ID}_{chat_id}.json"
    single_doc = {
        "chat_id": chat_id,
        "title": parsed["title"],
        "userId": USER_ID,
        "updated_at": parsed["updated_at"],
        "messages": parsed["messages"],
        "source": "codex_import",
        "source_session_id": parsed["session_id"]
    }
    with open(single_file, 'w', encoding='utf-8') as f:
        json.dump(single_doc, f, ensure_ascii=False, indent=2)
    
    all_data['chats'][chat_id] = {
        "title": parsed["title"],
        "updated_at": parsed["updated_at"],
        "userId": USER_ID,
        "msgCount": len(parsed["messages"]),
        "messages": parsed["messages"],
        "_localIndex": True,
        "source": "codex_import"
    }
    codex_imported += 1

all_data['updated_at'] = datetime.now(timezone.utc).isoformat()
with open(ALL_JSON, 'w', encoding='utf-8') as f:
    json.dump(all_data, f, ensure_ascii=False, indent=2)

print(f"Final summary: Claude={claude_imported}, Codex={codex_imported}, Total={len(all_data['chats'])}")
