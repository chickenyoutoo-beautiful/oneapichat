import sys
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


PYTHON_ROOT = Path(__file__).resolve().parents[1]
if str(PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(PYTHON_ROOT))

from chaoxing.base import Chaoxing
from chaoxing.answer import CacheDAO
from chaoxing.decode import decode_course_card


class _Response:
    status_code = 200

    def json(self):
        return {
            "status": "success",
            "dtoken": "dtoken",
            "duration": 20,
            "crc": "crc",
            "key": "key",
        }


class _Session:
    def __init__(self):
        self.headers = {}

    def get(self, _url):
        return _Response()


class ChaoxingCompletionTests(unittest.TestCase):
    def _runner(self, progress_results):
        runner = Chaoxing.__new__(Chaoxing)
        runner._tracker = None
        runner.get_fid = lambda: "fid"
        calls = []

        def progress(_session, _course, _job, _job_info, _dtoken, _duration, playing_time, _type):
            calls.append(playing_time)
            return progress_results[min(len(calls) - 1, len(progress_results) - 1)]

        runner.video_progress_log = progress
        return runner, calls

    @patch("chaoxing.base.show_progress", lambda *_args, **_kwargs: None)
    @patch("chaoxing.base.get_random_seconds", lambda: 10)
    @patch("chaoxing.base.init_session", lambda **_kwargs: _Session())
    def test_early_is_passed_accepts_server_accumulated_progress(self):
        runner, calls = self._runner([{"isPassed": True}])
        ok = runner.study_video(
            {"courseId": "c", "clazzId": "z", "cpi": "p"},
            {"name": "video", "objectid": "o", "jobid": "j", "otherinfo": "x"},
            {"knowledgeid": "k"},
            _speed=2,
        )
        self.assertTrue(ok)
        self.assertEqual(calls, [0])

    @patch("chaoxing.base.show_progress", lambda *_args, **_kwargs: None)
    @patch("chaoxing.base.get_random_seconds", lambda: 10)
    @patch("chaoxing.base.init_session", lambda **_kwargs: _Session())
    def test_end_without_server_confirmation_remains_incomplete(self):
        runner, calls = self._runner([{"isPassed": False}, {"isPassed": False}, {"isPassed": False}])
        ok = runner.study_video(
            {"courseId": "c", "clazzId": "z", "cpi": "p"},
            {"name": "video", "objectid": "o", "jobid": "j", "otherinfo": "x"},
            {"knowledgeid": "k"},
        )
        self.assertFalse(ok)
        self.assertEqual(calls, [0, 10, 20])
        self.assertTrue(runner.last_task_failure["retryable"])

    @patch("chaoxing.base.init_session")
    def test_broken_video_resource_is_not_retried(self, init_session_mock):
        class FailedResponse:
            def json(self):
                return {"status": "failed", "filename": "broken.mp4"}

        class FailedSession:
            def __init__(self):
                self.headers = {}

            def get(self, _url):
                return FailedResponse()

        init_session_mock.return_value = FailedSession()
        runner = Chaoxing.__new__(Chaoxing)
        runner._tracker = None
        runner.get_fid = lambda: "fid"
        ok = runner.study_video(
            {"courseId": "c", "clazzId": "z", "cpi": "p"},
            {"name": "broken.mp4", "objectid": "o", "jobid": "j", "otherinfo": "x"},
            {"knowledgeid": "k"},
        )
        self.assertFalse(ok)
        self.assertFalse(runner.last_task_failure["retryable"])
        self.assertEqual(runner.last_task_failure["status"], "failed")

    @patch("chaoxing.base.init_session")
    def test_unknown_video_resource_is_not_retried(self, init_session_mock):
        class UnknownResponse:
            def json(self):
                return {"error": "object not found"}

        class UnknownSession:
            def __init__(self):
                self.headers = {}

            def get(self, _url):
                return UnknownResponse()

        init_session_mock.return_value = UnknownSession()
        runner = Chaoxing.__new__(Chaoxing)
        runner._tracker = None
        runner.get_fid = lambda: "fid"
        ok = runner.study_video(
            {"courseId": "c", "clazzId": "z", "cpi": "p"},
            {"name": "missing.mp4", "objectid": "o", "jobid": "j", "otherinfo": "x"},
            {"knowledgeid": "k"},
        )
        self.assertFalse(ok)
        self.assertFalse(runner.last_task_failure["retryable"])
        self.assertEqual(runner.last_task_failure["status"], "unknown")

    @patch("chaoxing.base.init_session")
    def test_progress_403_is_not_retried(self, init_session_mock):
        class ProgressResponse:
            status_code = 403

        class MixedSession:
            def __init__(self):
                self.headers = {}

            def get(self, url):
                if "/ananas/status/" in url:
                    return _Response()
                return ProgressResponse()

        init_session_mock.return_value = MixedSession()
        runner = Chaoxing.__new__(Chaoxing)
        runner._tracker = None
        runner.get_fid = lambda: "fid"
        runner.get_uid = lambda: "uid"
        ok = runner.study_video(
            {"courseId": "c", "clazzId": "z", "cpi": "p"},
            {"name": "forbidden.mp3", "objectid": "o", "jobid": "j", "otherinfo": "x"},
            {"knowledgeid": "k"},
            _type="Audio",
        )
        self.assertFalse(ok)
        self.assertFalse(runner.last_task_failure["retryable"])
        self.assertEqual(runner.last_task_failure["status"], 403)
        self.assertEqual(runner.last_task_failure["kind"], "video_progress_rejected")

    @patch("chaoxing.base.show_progress", lambda *_args, **_kwargs: None)
    @patch("chaoxing.base.get_random_seconds", lambda: 10)
    @patch("chaoxing.base.init_session", lambda **_kwargs: _Session())
    def test_face_metadata_alone_does_not_imply_face_verification(self):
        runner, _calls = self._runner([{"isPassed": False}])
        ok = runner.study_video(
            {"courseId": "c", "clazzId": "z", "cpi": "p"},
            {
                "name": "face.mp4", "objectid": "o", "jobid": "j",
                "otherinfo": "nodeId_k-ff_1", "videoFaceCaptureEnc": "required",
            },
            {"knowledgeid": "k"},
        )
        self.assertFalse(ok)
        self.assertTrue(runner.last_task_failure["retryable"])
        self.assertEqual(runner.last_task_failure["kind"], "video_unconfirmed")

    def test_retryable_failure_stays_on_current_chapter(self):
        source = (PYTHON_ROOT / "chaoxing" / "main.py").read_text(encoding="utf-8")
        start = source.index("retry_count = chapter_retry_counts.get(chapter_id, 0) + 1", source.index("remaining_types ="))
        stop = source.index("当前章节重试{max_chapter_retries}次后仍未通过", start)
        retryable_branch = source[start:stop]
        self.assertIn("continue", retryable_branch)
        self.assertNotIn("__point_index += 1", retryable_branch)
        self.assertIn("max_chapter_retries = 8", source)
        self.assertIn("min(30, 5 * retry_count)", source)
        self.assertIn("if blocked_course_summaries:", source)
        self.assertIn("不会标记为全部完成", source)

    def test_retry_exhaustion_is_blocked_then_skipped(self):
        source = (PYTHON_ROOT / "chaoxing" / "main.py").read_text(encoding="utf-8")
        start = source.index("course_block_reason = f\"{point['title']} [{remaining_types}] 重试")
        stop = source.index("continue", start) + len("continue")
        exhausted_branch = source[start:stop]
        self.assertIn("status='blocked'", exhausted_branch)
        self.assertIn("__point_index += 1", exhausted_branch)
        self.assertNotIn("course_blocked = True", exhausted_branch)

    def test_non_retryable_failure_is_blocked_then_skipped(self):
        source = (PYTHON_ROOT / "chaoxing" / "main.py").read_text(encoding="utf-8")
        start = source.index("if non_retryable_failures:")
        stop = source.index("retry_count = chapter_retry_counts.get(chapter_id, 0) + 1", start)
        blocked_branch = source[start:stop]
        self.assertIn("status='blocked'", blocked_branch)
        self.assertIn("blocked_reason=course_block_reason", blocked_branch)
        self.assertIn("__point_index += 1", blocked_branch)
        self.assertIn("continue", blocked_branch)
        self.assertNotIn("course_blocked = True", blocked_branch)

    def test_explicit_empty_card_is_a_successful_fetch(self):
        jobs, info = decode_course_card('<script>mArg = "";</script><dd>暂无内容</dd>')
        self.assertEqual(jobs, [])
        self.assertTrue(info["fetch_ok"])
        self.assertTrue(info["empty_card"])

    @patch("chaoxing.base.show_progress", lambda *_args, **_kwargs: None)
    @patch("chaoxing.base.get_random_seconds", lambda: 10)
    @patch("chaoxing.base.init_session", lambda **_kwargs: _Session())
    def test_video_resumes_from_server_play_time(self):
        runner, calls = self._runner([{"isPassed": False}, {"isPassed": True}])
        ok = runner.study_video(
            {"courseId": "c", "clazzId": "z", "cpi": "p"},
            {
                "name": "video", "objectid": "o", "jobid": "j", "otherinfo": "x",
                "playTime": 10000,
            },
            {"knowledgeid": "k"},
        )
        self.assertTrue(ok)
        self.assertEqual(calls, [10, 20])

    @patch("chaoxing.base.show_progress", lambda *_args, **_kwargs: None)
    @patch("chaoxing.base.get_random_seconds", lambda: 10)
    @patch("chaoxing.base.init_session", lambda **_kwargs: _Session())
    def test_video_retry_can_restart_from_zero(self):
        runner, calls = self._runner([{"isPassed": False}, {"isPassed": True}])
        ok = runner.study_video(
            {"courseId": "c", "clazzId": "z", "cpi": "p"},
            {
                "name": "video", "objectid": "o", "jobid": "j", "otherinfo": "x",
                "playTime": 10000,
            },
            {"knowledgeid": "k"},
            _resume=False,
        )
        self.assertTrue(ok)
        self.assertEqual(calls, [0, 10])

    def test_required_video_validation_fields_are_reported(self):
        seen_urls = []

        class ProgressSession:
            def get(self, url):
                seen_urls.append(url)
                return _Response()

        runner = Chaoxing.__new__(Chaoxing)
        runner.get_uid = lambda: "uid"
        result = runner.video_progress_log(
            ProgressSession(),
            {"courseId": "c", "clazzId": "z", "cpi": "p"},
            {
                "jobid": "j", "objectid": "o", "otherinfo": "nodeId_k-rt_d",
                "videoFaceCaptureEnc": "face", "attDuration": 108,
                "attDurationEnc": "duration-enc",
            },
            {}, "token", 108, 85,
        )
        self.assertEqual(result, {
            "status": "success", "dtoken": "dtoken", "duration": 20,
            "crc": "crc", "key": "key",
        })
        self.assertIn("videoFaceCaptureEnc=face", seen_urls[0])
        self.assertIn("attDuration=108", seen_urls[0])
        self.assertIn("attDurationEnc=duration-enc", seen_urls[0])
        self.assertIn("rt=1", seen_urls[0])

    def test_video_final_heartbeat_falls_back_to_alternate_rt(self):
        seen_urls = []

        class ResultResponse:
            status_code = 200

            def __init__(self, passed):
                self.passed = passed

            def json(self):
                return {"isPassed": self.passed}

        class ProgressSession:
            def get(self, url):
                seen_urls.append(url)
                return ResultResponse("rt=0.9" in url)

        runner = Chaoxing.__new__(Chaoxing)
        runner.get_uid = lambda: "uid"
        result = runner.video_progress_log(
            ProgressSession(),
            {"courseId": "c", "clazzId": "z", "cpi": "p"},
            {"jobid": "j", "objectid": "o", "otherinfo": "nodeId_k-rt_d"},
            {}, "token", 20, 20,
        )
        self.assertEqual(result, {"isPassed": True})
        self.assertEqual(len(seen_urls), 2)
        self.assertIn("rt=1", seen_urls[0])
        self.assertIn("rt=0.9", seen_urls[1])

    def test_question_cache_uses_writable_user_runtime_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            with patch.dict(os.environ, {
                "CHAOXING_RUNTIME_DIR": tmp,
                "CHAOXING_USER_ID": "user/test",
            }):
                cache = CacheDAO()
                cache.addCache("question", "answer")
                self.assertEqual(cache.getCache("question"), "answer")
                self.assertEqual(cache.cacheFile, Path(tmp) / "cache_user_test.json")
                cache.close()


if __name__ == "__main__":
    unittest.main()
