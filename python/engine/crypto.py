"""
OneAPIChat Engine - 加密工具 (AES-256-GCM + XOR 兼容)
提取自 engine_server.py
"""
import base64
import configparser
import os


def load_encryption_key(project_root: str = None) -> str:
    """从 config.ini 加载加密密钥(与 PHP getEncryptionKey 一致)"""
    if project_root:
        config_path = os.path.join(project_root, 'config.ini')
    else:
        config_path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'config.ini')
    try:
        cp = configparser.ConfigParser()
        cp.read(config_path, encoding='utf-8')
        key = cp.get('common', 'encryption_key', fallback=None)
        if key:
            return key
    except Exception:
        pass
    return 'naujtrats-secret'  # 降级默认值


def get_aes_key(encryption_key: str) -> bytes:
    """PBKDF2 派生 AES-256 密钥(与前端 _getAesKey 一致)"""
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    from cryptography.hazmat.primitives import hashes
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(), length=32,
        salt=b'oneapichat-aes-v2', iterations=100000
    )
    return kdf.derive(encryption_key.encode('utf-8'))


def decrypt_xor(encoded: str, encryption_key: str, aes_key: bytes = None) -> str:
    """AES-256-GCM 解密(与前端 decrypt 一致) + XOR 向后兼容"""
    if not encoded:
        return ""
    try:
        # v2: AES-256-GCM (新格式)
        if encoded.startswith('v2:'):
            from cryptography.hazmat.primitives.ciphers.aead import AESGCM
            raw = base64.b64decode(encoded[3:])
            if len(raw) < 28:
                return None
            iv = raw[:12]
            tag = raw[-16:]
            ciphertext = raw[12:-16]
            if aes_key is None:
                aes_key = get_aes_key(encryption_key)
            aesgcm = AESGCM(aes_key)
            return aesgcm.decrypt(iv, ciphertext + tag, None).decode('utf-8')
        # 旧版 XOR 解密 (向后兼容)
        bin_bytes = base64.b64decode(encoded)
        key_bytes = encryption_key.encode('utf-8')
        result = bytearray(len(bin_bytes))
        for i in range(len(bin_bytes)):
            result[i] = bin_bytes[i] ^ key_bytes[i % len(key_bytes)]
        return result.decode('utf-8')
    except Exception:
        return None
