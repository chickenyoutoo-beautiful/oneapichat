from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
BRIDGE = ROOT / "api" / "engine_api.php"


def test_browser_bridge_forwards_verified_owner():
    source = BRIDGE.read_text(encoding="utf-8")
    assert "$engineUserQuery = $userId ? '?user_id=' . urlencode($userId) : '';" in source
    endpoints = (
        "navigate",
        "screenshot",
        "click",
        "type",
        "content",
        "snapshot",
        "js",
    )
    for endpoint in endpoints:
        needle = f"$engine_url . '/engine/browser/{endpoint}' . $engineUserQuery"
        assert needle in source, f"missing owner forwarding for browser/{endpoint}"


if __name__ == "__main__":
    test_browser_bridge_forwards_verified_owner()
    print("test_browser_bridge.py: all assertions passed")
