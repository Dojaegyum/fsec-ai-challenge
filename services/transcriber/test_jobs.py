"""`JobStore` 의 접수 규칙 — 같은 증거를 두 번 돌리지 않는다.

정본: spec/common/08-14-api.md §3.2 3단계 · §3.3(폴링)

## 왜 이 시험이 있나

`POST /api/cases/{case_token}/evidence/{evidence_id}/complete` 는 **다시 부를 수 있는
자리**입니다 — 화면이 재시도하거나 사용자가 다시 누를 수 있고, 상한도 걸려 있지
않습니다. 그때마다 모델을 다시 돌리면 GPU 시간이 그대로 배수로 붙고, 진행률이
서로 덮어써서 화면의 폴링이 뒤로 갑니다.

**접수가 멱등이어야 그 경로가 안전해집니다.** 상한으로는 못 막습니다 — 분당 10회를
걸어도 10번 돕니다.

의존성 없이 돕니다:
    python -m unittest discover -s services/transcriber -t .
"""

from __future__ import annotations

import threading
import unittest

from .jobs import JobStore


class CreateIsIdempotent(unittest.TestCase):
    def test_새_번호는_연다(self) -> None:
        store = JobStore()
        job, opened = store.create("audio", "EV1")
        self.assertTrue(opened)
        self.assertEqual(job.job_id, "EV1")
        self.assertEqual(job.status, "running")

    def test_돌고_있으면_다시_열지_않는다(self) -> None:
        store = JobStore()
        first, _ = store.create("audio", "EV1")
        store.progress("EV1", 40)

        again, opened = store.create("audio", "EV1")

        self.assertFalse(opened, "돌고 있는 작업을 다시 열면 모델이 두 번 돕니다")
        self.assertIs(again, first)
        self.assertEqual(again.percent, 40, "진행률이 0 으로 되돌아가면 화면이 뒤로 갑니다")

    def test_끝난_것도_다시_열지_않는다(self) -> None:
        store = JobStore()
        store.create("audio", "EV1")
        store.finish("EV1", "faster-whisper", [{"text": "여보세요"}])

        again, opened = store.create("audio", "EV1")

        self.assertFalse(opened, "결과가 이미 있는데 다시 돌릴 이유가 없습니다")
        self.assertEqual(again.status, "done")
        self.assertEqual(again.lines, [{"text": "여보세요"}])

    def test_실패한_것은_다시_연다(self) -> None:
        """재시도 판단은 앱(`retry-checker`)이 합니다 — 여기까지 왔으면 다시 하기로 정해진 것."""
        store = JobStore()
        store.create("audio", "EV1")
        store.fail("EV1", "engine_failed")

        again, opened = store.create("audio", "EV1")

        self.assertTrue(opened, "안 열어 주면 실패한 증거를 영영 다시 못 읽습니다")
        self.assertEqual(again.status, "running")
        self.assertEqual(again.percent, 0)
        self.assertIsNone(again.reason, "지난 실패 사유가 남으면 새 시도가 실패로 보입니다")
        self.assertIsNone(again.finished_at)

    def test_번호를_안_주면_매번_새로_연다(self) -> None:
        store = JobStore()
        one, opened_one = store.create("image")
        two, opened_two = store.create("image")
        self.assertTrue(opened_one)
        self.assertTrue(opened_two)
        self.assertNotEqual(one.job_id, two.job_id)

    def test_동시에_와도_하나만_열린다(self) -> None:
        """**밖에서 `get` 으로 미리 보면 못 막는 자리입니다.**

        두 요청이 나란히 「없다」를 보고 둘 다 돌립니다. 그래서 「열렸는가」를
        `create` 가 잠금 안에서 답합니다.
        """
        store = JobStore()
        opened_flags: list[bool] = []
        lock = threading.Lock()
        start = threading.Barrier(8)

        def submit() -> None:
            start.wait()
            _, opened = store.create("audio", "EV1")
            with lock:
                opened_flags.append(opened)

        threads = [threading.Thread(target=submit) for _ in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        self.assertEqual(
            opened_flags.count(True), 1, f"하나만 열려야 합니다 — 실제: {opened_flags}"
        )


if __name__ == "__main__":
    unittest.main()
