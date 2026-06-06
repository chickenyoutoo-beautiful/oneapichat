#!/usr/bin/env python3
"""OneAPIChat Engine — 加密模块单元测试"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from engine.crypto import load_encryption_key, get_aes_key, decrypt_xor


class TestCrypto(unittest.TestCase):

    def test_load_default_key(self):
        """加载加密密钥(回退默认值)"""
        key = load_encryption_key()
        self.assertIsNotNone(key)
        self.assertIsInstance(key, str)
        self.assertGreater(len(key), 8)

    def test_get_aes_key(self):
        """派生 AES-256 密钥"""
        encryption_key = "test-key-32-chars-long-enough!"
        aes_key = get_aes_key(encryption_key)
        self.assertIsNotNone(aes_key)
        self.assertEqual(len(aes_key), 32)  # AES-256 = 32 bytes

    def test_aes_key_deterministic(self):
        """相同输入产生相同密钥"""
        k1 = get_aes_key("same-key")
        k2 = get_aes_key("same-key")
        self.assertEqual(k1, k2)

    def test_aes_key_different(self):
        """不同输入产生不同密钥"""
        k1 = get_aes_key("key-one")
        k2 = get_aes_key("key-two")
        self.assertNotEqual(k1, k2)

    def test_decrypt_xor_empty(self):
        """空输入返回空字符串"""
        result = decrypt_xor("", "test-key")
        self.assertEqual(result, "")

    def test_decrypt_xor_null(self):
        """None 输入返回空"""
        result = decrypt_xor(None, "test-key")
        self.assertEqual(result, "")

    def test_decrypt_xor_invalid(self):
        """无效密文返回 None"""
        result = decrypt_xor("not-valid-base64!!!", "test-key")
        self.assertIsNone(result)

    def test_decrypt_xor_roundtrip(self):
        """XOR 解密往返: base64(XOR(plaintext)) → plaintext"""
        import base64
        key = "test-key-1234"
        plaintext = "hello world"
        # Encrypt (XOR + base64)
        key_bytes = key.encode('utf-8')
        pt_bytes = plaintext.encode('utf-8')
        xor_bytes = bytearray(len(pt_bytes))
        for i in range(len(pt_bytes)):
            xor_bytes[i] = pt_bytes[i] ^ key_bytes[i % len(key_bytes)]
        encoded = base64.b64encode(bytes(xor_bytes)).decode('utf-8')
        # Decrypt
        result = decrypt_xor(encoded, key)
        self.assertEqual(result, plaintext)


if __name__ == "__main__":
    unittest.main(verbosity=2)
