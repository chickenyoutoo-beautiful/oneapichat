import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from engine.provider_runtime import _anthropic_messages, _normalize_tool_turns_for_provider
from engine.runtime_store import AgentRuntimeStore, RuntimeEvent


def call(call_id="call_a"):
    return {
        "id": call_id,
        "type": "function",
        "function": {"name": "read", "arguments": "{}"},
    }


def test_provider_normalizer_requires_adjacent_matching_results():
    messages = [
        {"role": "user", "content": "go"},
        {"role": "assistant", "content": "", "tool_calls": [call(), {"id": "", "function": {}}]},
        {"role": "tool", "tool_call_id": "call_a", "content": {"ok": True}},
        {"role": "tool", "tool_call_id": "late", "content": "orphan"},
    ]
    normalized = _normalize_tool_turns_for_provider(messages)
    assert [item["role"] for item in normalized] == ["user", "assistant", "tool"]
    assert normalized[1]["tool_calls"][0]["id"] == "call_a"
    assert normalized[2]["tool_call_id"] == "call_a"

    anthropic, _ = _anthropic_messages(messages)
    tool_blocks = [block for item in anthropic for block in item["content"] if block.get("type") == "tool_result"]
    assert [block["tool_use_id"] for block in tool_blocks] == ["call_a"]

    multi = [
        {"role": "assistant", "content": "", "tool_calls": [call("a"), call("a"), call("b")]},
        {"role": "tool", "tool_call_id": "b", "content": "B"},
        {"role": "tool", "tool_call_id": "a", "content": "A"},
    ]
    multi_normalized = _normalize_tool_turns_for_provider(multi)
    assert [item.get("tool_call_id") for item in multi_normalized[1:]] == ["a", "b"]
    assert [item["id"] for item in multi_normalized[0]["tool_calls"]] == ["a", "b"]


def test_runtime_projection_joins_tool_events_in_order(tmp_path):
    store = AgentRuntimeStore(tmp_path)
    state = store._initial_projection("s1", "u1", "c1")
    state = store._apply_projection(state, RuntimeEvent("s1", 0, 1.0, "assistant/message", {
        "message": {"role": "assistant", "content": "", "tool_calls": [call()]},
    }))
    state = store._apply_projection(state, RuntimeEvent("s1", 1, 2.0, "tool/call", {
        "call_id": "call_a", "name": "read", "arguments": "{}",
    }))
    assert [item["role"] for item in state["messages"]] == ["assistant"]
    state = store._apply_projection(state, RuntimeEvent("s1", 2, 3.0, "tool/result", {
        "call_id": "call_a", "result": {"ok": True},
    }))
    assert [item["role"] for item in state["messages"]] == ["assistant", "tool"]
    assert state["messages"][1]["tool_call_id"] == "call_a"
    assert state["messages"][1]["content"] == '{"ok":true}'


if __name__ == "__main__":
    test_provider_normalizer_requires_adjacent_matching_results()
    from tempfile import TemporaryDirectory
    with TemporaryDirectory() as directory:
        test_runtime_projection_joins_tool_events_in_order(Path(directory))
    print("test_tool_pairing.py: all assertions passed")
