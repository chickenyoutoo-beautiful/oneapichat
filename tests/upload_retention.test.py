import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'python'))
from engine.upload_retention import cleanup_uploads


class UploadRetentionTest(unittest.TestCase):
    def test_keeps_recent_and_deletes_old(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            recent = root / 'user_a' / 'recent.docx'
            old = root / 'user_a' / 'old.docx'
            shared_old = root / 'shared' / 'old.docx'
            for path in (recent, old, shared_old):
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text('x')
            old_time = time.time() - 100 * 86400
            for path in (old, shared_old):
                import os
                os.utime(path, (old_time, old_time))
            result = cleanup_uploads(root, user_retention_days=90, shared_retention_days=30)
            self.assertTrue(recent.exists())
            self.assertFalse(old.exists())
            self.assertFalse(shared_old.exists())
            self.assertEqual(result['deleted'], 2)

    def test_protected_reference_is_kept(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = root / 'user_a' / 'referenced.docx'
            path.parent.mkdir(parents=True)
            path.write_text('x')
            old_time = time.time() - 120 * 86400
            import os
            os.utime(path, (old_time, old_time))
            result = cleanup_uploads(root, referenced=[str(path)], user_retention_days=90)
            self.assertTrue(path.exists())
            self.assertEqual(result['skipped_referenced'], 1)


if __name__ == '__main__':
    unittest.main()
