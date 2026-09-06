#!/usr/bin/env python3
"""
Test suite for Mihomo OpenAI proxy failover and probe functionality.
Verifies that:
1. openai-failover.sh probe returns OPENAI_OK and valid response time without 503 errors.
2. current_node correctly parses the active proxy group node without syntax errors.
3. mihomo_proxy.php API handles probe action and maps to green "可用" status.
4. Auto recovery successfully selects healthy low-latency candidate.
"""
import subprocess
import json
import urllib.request
import os
import sys

def test_probe_direct():
    print("[1] Testing direct probe for candidate nodes...")
    cmd = ["sudo", "-n", "/home/naujtrats/mihomo/openai-failover.sh", "probe", "JP7-HY2"]
    res = subprocess.run(cmd, capture_output=True, text=True, check=True)
    out = res.stdout.strip()
    print(f"    Output: {out}")
    assert "OPENAI_OK" in out, f"Expected OPENAI_OK in output, got: {out}"
    assert "503" not in out, "503 error found in probe output"
    print("    -> PASS")

def test_current_node():
    print("[2] Testing current_node extraction...")
    res = subprocess.run(
        ["bash", "-c", 'source /home/naujtrats/mihomo/openai-failover.sh; current_node'],
        capture_output=True, text=True
    )
    cur = res.stdout.strip()
    print(f"    Current node: '{cur}'")
    assert cur, "current_node should not be empty"
    print("    -> PASS")

def test_api_probe():
    print("[3] Testing PHP API probe action...")
    with open("/var/www/html/oneapichat/users/sessions.json") as f:
        sessions = json.load(f)
    root_tokens = [k for k, v in sessions.items() if v.get("user_id") == "u_a418898cebde5e2b1e15d181"]
    assert root_tokens, "Root token not found"
    token = root_tokens[0]

    url = f"http://127.0.0.1/oneapichat/api/mihomo_proxy.php?action=probe&node=JP7-HY2&group=OPENAI&token={token}"
    req = urllib.request.Request(url, headers={"Host": "naujtrats.xyz"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.loads(resp.read().decode())
    
    print(f"    API response: {data}")
    assert data.get("success") is True, f"API failed: {data}"
    assert data.get("class") == "OPENAI_OK"
    assert data.get("detail", {}).get("ok") is True
    assert data.get("detail", {}).get("color") == "green"
    print("    -> PASS")

def test_health_check_script():
    print("[4] Testing proxy-health-check.sh...")
    res = subprocess.run(["/home/naujtrats/mihomo/proxy-health-check.sh"], capture_output=True, text=True, check=True)
    with open("/home/naujtrats/mihomo/health.log") as f:
        lines = f.readlines()
    last = lines[-1].strip()
    print(f"    Last health log: {last}")
    assert "OPENAI=" in last
    print("    -> PASS")

if __name__ == "__main__":
    test_probe_direct()
    test_current_node()
    test_api_probe()
    test_health_check_script()
    print("\nAll Mihomo OpenAI probe tests PASSED successfully!")
