#!/usr/bin/env python3
"""Upload a large local file to Cloudreve via chunked upload (background-safe)."""
import json, os, sys, time, glob, urllib.request, urllib.error

CLOUDREVE_BASE = "http://127.0.0.1:5212/api/v4"
HOST_HEADER = "cloudreve.naujtrats.xyz"

def api_request(method, path, data=None, token="", timeout=30, binary=False):
    url = CLOUDREVE_BASE + path
    body = None
    headers = {"Host": HOST_HEADER}
    if token:
        headers["Authorization"] = "Bearer " + token
    if data is not None and not binary:
        body = json.dumps(data).encode("utf-8")
        headers["Content-Type"] = "application/json"
    elif binary:
        body = data
        headers["Content-Type"] = "application/octet-stream"
        headers["Content-Length"] = str(len(body))
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode("utf-8"))
        except:
            return {"code": e.code, "msg": str(e)}
    except Exception as e:
        return {"code": -1, "msg": str(e)}

def get_token():
    """Same logic as PHP cr_getAccessToken('') - try all cached login files."""
    token_files = glob.glob('/tmp/cloudreve_login_*.json')
    if not token_files:
        return None
    # Sort by mtime descending (newest first)
    token_files.sort(key=lambda f: os.path.getmtime(f), reverse=True)
    for tf in token_files:
        try:
            with open(tf) as f:
                data = json.load(f)
            email = data.get("email", "")
            password = data.get("password", "")
            if not email or not password:
                continue
            resp = api_request("POST", "/session/token", {"email": email, "password": password})
            if resp.get("code") == 0:
                token = resp.get("data", {}).get("token", {}).get("access_token", "")
                if token:
                    return token
        except Exception:
            continue
    return None

def main():
    local_path = sys.argv[1] if len(sys.argv) > 1 else "/var/www/html/oneapichat/uploads/downloads/qwen3vl_32b_h3_ultra_uncensored_heretic_int8_convrot.safetensors"
    cr_category = sys.argv[2] if len(sys.argv) > 2 else "downloads"
    cr_name = sys.argv[3] if len(sys.argv) > 3 else ""

    token = get_token()
    if not token:
        print("ERROR: No cloudreve token found", flush=True)
        sys.exit(1)

    if not os.path.isfile(local_path):
        print(f"ERROR: File not found: {local_path}", flush=True)
        sys.exit(1)

    file_size = os.path.getsize(local_path)
    file_name = cr_name or os.path.basename(local_path)
    cr_folder = f"OneAPIChat/{cr_category}"
    uri = f"cloudreve://my/{cr_folder}/{file_name}"

    print(f"FILE: {local_path}", flush=True)
    print(f"SIZE: {file_size} bytes ({file_size/1024/1024/1024:.2f} GB)", flush=True)
    print(f"TARGET: {uri}", flush=True)

    # Step 1: Ensure folder exists
    print("Creating folder (if needed)...", flush=True)
    folder_parts = cr_folder.split("/")
    current_path = ""
    for part in folder_parts:
        current_path = f"{current_path}/{part}" if current_path else part
        api_request("POST", "/directory", {"uri": f"cloudreve://my/{current_path}"}, token)

    # Step 2: Create upload session
    print("Creating upload session...", flush=True)
    resp = api_request("PUT", "/file/upload", {"uri": uri, "size": file_size}, token)
    if resp.get("code") != 0:
        err = resp.get("msg", "unknown")
        if "exist" in str(err).lower():
            print(f"FILE_ALREADY_EXISTS: {uri}", flush=True)
            sys.exit(0)
        print(f"ERROR: Create session failed: {err}", flush=True)
        sys.exit(1)

    session_id = resp["data"]["session_id"]
    chunk_size = resp["data"].get("chunk_size", 26214400)  # 25MB default
    total_chunks = (file_size + chunk_size - 1) // chunk_size
    print(f"SESSION: {session_id}, CHUNK_SIZE: {chunk_size}, TOTAL_CHUNKS: {total_chunks}", flush=True)

    # Step 3: Upload chunks
    start_time = time.time()
    with open(local_path, "rb") as fh:
        for i in range(total_chunks):
            chunk_data = fh.read(chunk_size)
            if not chunk_data:
                break

            chunk_url = f"/file/upload/{session_id}/{i}"
            chunk_resp = api_request("POST", chunk_url, chunk_data, token, timeout=120, binary=True)

            if chunk_resp.get("code") != 0:
                print(f"ERROR: Chunk {i}/{total_chunks} failed: {chunk_resp.get('msg', 'unknown')}", flush=True)
                sys.exit(1)

            # Progress every 10 chunks or on last
            if (i + 1) % 10 == 0 or i == total_chunks - 1:
                elapsed = time.time() - start_time
                uploaded = (i + 1) * chunk_size
                pct = min(100, (i + 1) / total_chunks * 100)
                speed = uploaded / elapsed / 1024 / 1024 if elapsed > 0 else 0
                eta = (total_chunks - i - 1) * (elapsed / (i + 1)) if i > 0 else 0
                print(f"PROGRESS: {i+1}/{total_chunks} ({pct:.1f}%) | {speed:.1f} MB/s | ETA: {eta/60:.1f} min", flush=True)

    elapsed = time.time() - start_time
    print(f"SUCCESS: Uploaded {file_name} ({file_size/1024/1024/1024:.2f} GB) in {elapsed/60:.1f} min", flush=True)
    print(f"PATH: {cr_folder}/{file_name}", flush=True)

if __name__ == "__main__":
    main()
