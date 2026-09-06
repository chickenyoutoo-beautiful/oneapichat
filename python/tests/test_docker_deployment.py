import importlib.util
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "python"))

spec = importlib.util.spec_from_file_location("server_tools_docker", ROOT / "python" / "engine" / "server_tools.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def test_image_and_container_validation():
    assert mod._docker_valid_image("yatoridev/yatori-go-console:latest")
    assert not mod._docker_valid_image("yatori image")
    assert mod._docker_valid_name("yatori-console")
    assert not mod._docker_valid_name("../docker")


def test_deploy_path_is_bounded():
    assert mod._docker_host_path(str(Path.home() / "yatori")) is not None
    assert mod._docker_host_path("/etc/oneapichat") is None


def test_doctor_reaches_local_daemon():
    if not (Path("/usr/bin/docker").exists() or Path("/usr/local/bin/docker").exists()):
        return
    result = mod._docker_run(["version", "--format", "{{.Server.Version}}"], 10, "doctor")
    assert result.get("ok") is True, result
    assert result.get("stdout")


if __name__ == "__main__":
    test_image_and_container_validation()
    test_deploy_path_is_bounded()
    test_doctor_reaches_local_daemon()
    print("docker deployment: PASS")
