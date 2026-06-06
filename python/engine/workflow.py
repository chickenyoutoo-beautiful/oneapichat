"""
OneAPIChat Engine - 工作流引擎 (链式子代理编排)
提取自 engine_server.py
"""
import json
import os
import re
import threading
from datetime import datetime


def create_workflow(name: str, steps_json: str, user_id: str, get_ns) -> dict:
    """创建多步骤工作流"""
    wf_store = get_ns("workflows", user_id)
    workflows = wf_store.get()
    try:
        parsed_steps = json.loads(steps_json)
    except Exception:
        return {"error": "steps 必须为有效 JSON 数组"}
    if not isinstance(parsed_steps, list) or len(parsed_steps) == 0:
        return {"error": "steps 必须为非空数组"}
    for i, step in enumerate(parsed_steps):
        if "role" not in step or "prompt" not in step:
            return {"error": f"第{i+1}步缺少 role 或 prompt"}
        step.setdefault("output_key", f"step_{i}")

    workflows[name] = {
        "name": name, "steps": parsed_steps,
        "status": "created", "current_step": 0,
        "results": {}, "errors": [],
        "created": datetime.now().isoformat()
    }
    wf_store.set(workflows)
    return {"ok": True, "workflow": name, "steps": len(parsed_steps)}


def run_workflow(name: str, user_id: str, get_ns, get_main_config, agent_roles, filter_tools) -> dict:
    """异步启动工作流执行"""
    wf_store = get_ns("workflows", user_id)
    workflows = wf_store.get()
    wf = workflows.get(name)
    if not wf:
        return {"error": "工作流不存在"}
    if wf["status"] == "running":
        return {"error": "工作流正在运行中"}

    def _run_background():
        _execute_workflow(name, user_id, get_ns, get_main_config, agent_roles, filter_tools)

    t = threading.Thread(target=_run_background, name=f"wf_{user_id}_{name}", daemon=True)
    t.start()
    return {"ok": True, "workflow": name, "status": "running"}


def _execute_workflow(name, user_id, get_ns, get_main_config, agent_roles, filter_tools):
    """后台执行工作流(每个步骤创建子代理)"""
    wf_store = get_ns("workflows", user_id)
    workflows = wf_store.get()
    wf = workflows.get(name)
    if not wf:
        return
    wf["status"] = "running"
    wf["current_step"] = 0
    wf["results"] = {}
    wf["errors"] = []
    wf_store.set(workflows)

    for i, step in enumerate(wf["steps"]):
        wf_store = get_ns("workflows", user_id)
        workflows = wf_store.get()
        wf = workflows.get(name)
        if not wf or wf["status"] == "cancelled":
            return

        prompt = step["prompt"]
        for key, val in wf["results"].items():
            prompt = prompt.replace("{" + key + "}", str(val)[:2000])

        step_agent_name = f"wf_{name}_step{i}_{datetime.now().strftime('%H%M%S')}"
        step_role = step.get("role", "general")

        main_config = get_main_config(user_id)
        step_api_key = main_config.get("api_key", "") or os.getenv("OPENAI_API_KEY", "")
        if not step_api_key:
            wf["status"] = "failed"
            wf["errors"].append({"step": i, "error": "未配置API Key"})
            wf_store.set(workflows)
            return

        try:
            from openai import OpenAI
            client = OpenAI(api_key=step_api_key, timeout=120)
            step_tools = filter_tools(step_role)
            messages = [{"role": "user", "content": prompt}]
            step_max_rounds = agent_roles.get(step_role, agent_roles["general"])["max_rounds"]
            step_result_parts = []
            step_model = main_config.get("model", "") or "MiniMax-M2.7"
            if "api.minimaxi.com" in step_model and "minimax" not in step_model.lower():
                step_model = "MiniMax-M2.7"
            if agent_roles.get(step_role, {}).get("model_tier") == "cheap":
                cheap_m = main_config.get("cheap_model", "")
                if cheap_m:
                    step_model = cheap_m

            for round_num in range(step_max_rounds):
                resp = client.chat.completions.create(
                    model=step_model, messages=messages,
                    tools=step_tools if step_tools else None,
                    tool_choice="auto" if step_tools else None,
                    temperature=0.3, max_tokens=2048, timeout=120
                )
                msg = resp.choices[0].message
                if msg.content:
                    cleaned = msg.content
                    if '<think>' in cleaned:
                        cleaned = re.sub(r'<think>.*?</think>', '', cleaned, flags=re.DOTALL).strip()
                    step_result_parts.append(cleaned)
                if not msg.tool_calls:
                    break
                asst_msg = {"role": "assistant", "content": msg.content}
                if hasattr(msg.tool_calls, 'model_dump'):
                    asst_msg["tool_calls"] = msg.tool_calls.model_dump()
                else:
                    asst_msg["tool_calls"] = [{"id": tc.id, "type": tc.type,
                        "function": {"name": tc.function.name, "arguments": tc.function.arguments}}
                        for tc in msg.tool_calls]
                messages.append(asst_msg)
                for tc in msg.tool_calls:
                    step_result_parts.append(f"[工具: {tc.function.name}]")
                    messages.append({"role": "tool", "tool_call_id": tc.id, "content": "工具已调用"})

            step_output = "\n".join(step_result_parts)
        except Exception as e:
            step_output = f"[错误] 步骤{i}执行失败: {str(e)}"
            wf["errors"].append({"step": i, "error": str(e)})

        # 保存步骤结果
        wf_store = get_ns("workflows", user_id)
        workflows = wf_store.get()
        wf = workflows.get(name, {})
        wf["results"][step.get("output_key", f"step_{i}")] = step_output
        wf["current_step"] = i + 1
        workflows[name] = wf
        wf_store.set(workflows)

        # 推送通知
        push_store = get_ns("heartbeat", user_id)
        push_data = push_store.get()
        pending = push_data.get("pending_messages", [])
        pending.append({"msg": f"[工作流 {name}] 步骤{i+1}/{len(wf['steps'])} 完成 ({step_role})",
                       "time": datetime.now().isoformat()})
        push_data["pending_messages"] = pending
        push_store.set(push_data)

    # 全部完成
    wf_store = get_ns("workflows", user_id)
    workflows = wf_store.get()
    wf = workflows.get(name, {})
    has_errors = len(wf.get("errors", [])) > 0
    wf["status"] = "failed" if has_errors else "completed"
    workflows[name] = wf
    wf_store.set(workflows)

    push_store = get_ns("heartbeat", user_id)
    push_data = push_store.get()
    pending = push_data.get("pending_messages", [])
    status = "完成" if wf["status"] == "completed" else "失败"
    pending.append({"msg": f"[工作流] {name} 执行{status}({len(wf['steps'])}步)", "time": datetime.now().isoformat()})
    push_data["pending_messages"] = pending
    push_store.set(push_data)


def list_workflows(user_id: str, get_ns) -> dict:
    wf_store = get_ns("workflows", user_id)
    return wf_store.get()


def status_workflow(name: str, user_id: str, get_ns) -> dict:
    wf_store = get_ns("workflows", user_id)
    workflows = wf_store.get()
    wf = workflows.get(name)
    if not wf:
        return {"error": "工作流不存在"}
    return wf


def delete_workflow(name: str, user_id: str, get_ns) -> dict:
    wf_store = get_ns("workflows", user_id)
    workflows = wf_store.get()
    if name not in workflows:
        return {"ok": False, "error": "不存在"}
    del workflows[name]
    wf_store.set(workflows)
    return {"ok": True}


def get_roles(agent_roles: dict) -> dict:
    return {"roles": [{"id": k, "label": v["label"], "desc": v["desc"]}
                     for k, v in agent_roles.items()]}
