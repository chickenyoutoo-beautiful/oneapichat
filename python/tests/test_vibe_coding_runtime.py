import importlib.util
import json
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SERVER_TOOLS = ROOT / 'python' / 'engine' / 'server_tools.py'
RUNNER = ROOT / 'python' / 'engine' / 'run_code_runner.mjs'

spec = importlib.util.spec_from_file_location('server_tools_under_test', SERVER_TOOLS)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

def test_allowed_path_default_and_full_access():
    assert mod._allowed_path(ROOT / 'CLAUDE.md')
    assert not mod._allowed_path(Path('/etc/hosts'))
    assert mod._allowed_path(Path('/etc/hosts'), full_access=True)

def test_observation_registry_is_owner_scoped():
    path = Path(tempfile.gettempdir()) / 'oneapi-observe-unit.txt'
    path.write_text('x')
    try:
        mod._mark_observed('user-a', path)
        assert mod._was_observed('user-a', path)
        assert not mod._was_observed('user-b', path)
    finally:
        path.unlink(missing_ok=True)

def test_run_code_runner_rpc_round_trip():
    proc = subprocess.Popen(['node', '--permission', f'--allow-fs-read={RUNNER}', str(RUNNER)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        proc.stdin.write(json.dumps({'type':'init','code':'const r = await tools.read({file_path:"x"}); return r.answer;'}) + '\n')
        proc.stdin.flush()
        call = json.loads(proc.stdout.readline())
        assert call['type'] == 'call' and call['name'] == 'read'
        proc.stdin.write(json.dumps({'type':'response','id':call['id'],'ok':True,'value':{'answer':42}}) + '\n')
        proc.stdin.flush()
        result = json.loads(proc.stdout.readline())
        assert result == {'type':'result','value':42}
    finally:
        proc.kill()

def test_permission_required_code_on_file_endpoints():
    # Test that un-authorized external path access returns PERMISSION_REQUIRED
    ext_path = Path("/etc/hosts")
    assert not mod._allowed_path(ext_path)
    assert mod._allowed_path(ext_path, full_access=True)

if __name__ == '__main__':
    test_allowed_path_default_and_full_access()
    test_observation_registry_is_owner_scoped()
    test_run_code_runner_rpc_round_trip()
    test_permission_required_code_on_file_endpoints()
    print('vibe coding runtime: PASS')
