"""감시자의 판단 시험 — ADR-092 C. 세지 않고, 싼 조치부터, 비싼 조치는 확인된 사실 뒤에만."""
import importlib.util
import pathlib
import sys
import unittest

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("runpod_watch", HERE / "runpod-watch.py")
w = importlib.util.module_from_spec(spec)
# Python 3.12 의 dataclass 는 `from __future__ import annotations` 로 문자열이 된 타입을
# sys.modules[cls.__module__] 에서 찾는다 — 등록 없이 exec_module 만 하면 State 정의에서 죽는다.
sys.modules[spec.name] = w
spec.loader.exec_module(w)


def running(pod_id="p1"):
    return {"id": pod_id, "name": "finally-demo", "desiredStatus": "RUNNING"}


class Decide(unittest.TestCase):
    def test_no_pod_means_recreate_now(self):
        self.assertEqual(w.decide(w.State(), 1000.0, [], None), ("recreate", None))

    def test_exited_pod_counts_as_none(self):
        pods = [{"id": "p1", "name": "finally-demo", "desiredStatus": "EXITED"}]
        self.assertEqual(w.decide(w.State(), 1000.0, pods, None), ("recreate", "p1"))

    def test_running_and_healthy_is_ok(self):
        self.assertEqual(w.decide(w.State(), 1000.0, [running()], True), ("ok", "p1"))

    def test_running_unhealthy_without_recent_action_restarts_immediately(self):
        # 한 번의 실패에 바로 — 세지 않는다. 대가는 워밍업 1~2분뿐
        self.assertEqual(w.decide(w.State(), 1000.0, [running()], False), ("restart", "p1"))

    def test_within_grace_after_restart_waits(self):
        st = w.State(restart_pod="p1", restart_at=1000.0)
        self.assertEqual(w.decide(st, 1000.0 + 179, [running()], False), ("wait", "warming"))

    def test_after_grace_still_unhealthy_recreates(self):
        st = w.State(restart_pod="p1", restart_at=1000.0)
        self.assertEqual(w.decide(st, 1000.0 + 180, [running()], False), ("recreate", "p1"))

    def test_restart_record_of_another_pod_does_not_count(self):
        # 옛 팟에 건 재시작은 새 팟의 판단에 안 끼어든다
        st = w.State(restart_pod="old", restart_at=1000.0)
        self.assertEqual(w.decide(st, 1000.0 + 10, [running("p2")], False), ("restart", "p2"))

    def test_healthy_clears_restart_record(self):
        st = w.State(restart_pod="p1", restart_at=1000.0)
        w.apply_ok(st, "p1", 1100.0)
        self.assertIsNone(st.restart_pod)
        self.assertEqual(st.pod_id, "p1")

    def test_two_running_pods_prefer_the_known_one(self):
        st = w.State(pod_id="p2")
        self.assertEqual(w.decide(st, 1000.0, [running("p1"), running("p2")], True), ("ok", "p2"))


class Notify(unittest.TestCase):
    def test_same_kind_at_most_once_per_six_hours(self):
        st = w.State()
        self.assertTrue(w.should_notify(st, "low_balance", 1000.0))
        w.mark_notified(st, "low_balance", 1000.0)
        self.assertFalse(w.should_notify(st, "low_balance", 1000.0 + 6 * 3600 - 1))
        self.assertTrue(w.should_notify(st, "low_balance", 1000.0 + 6 * 3600))


class Balance(unittest.TestCase):
    def test_hours_left(self):
        self.assertAlmostEqual(w.hours_left(29.76, 0.748), 39.786, places=2)
        self.assertEqual(w.hours_left(10.0, 0.0), float("inf"))


class CreateBackoff(unittest.TestCase):
    def test_three_failures_in_an_hour_pause_creation(self):
        st = w.State(create_failures=[100.0, 200.0, 300.0])
        self.assertTrue(w.creation_paused(st, 400.0))
        self.assertFalse(w.creation_paused(st, 300.0 + 3600))


class GithubRuns(unittest.TestCase):
    def test_pick_first_run_created_after_dispatch(self):
        runs = [
            {"id": 3, "created_at": "2026-09-07T01:00:30Z", "status": "queued"},
            {"id": 2, "created_at": "2026-09-07T00:59:00Z", "status": "completed"},
        ]
        self.assertEqual(w.pick_run_after(runs, "2026-09-07T01:00:00Z")["id"], 3)
        self.assertIsNone(w.pick_run_after(runs, "2026-09-07T01:01:00Z"))


class Mail(unittest.TestCase):
    def test_body_has_pod_and_url_but_no_secret(self):
        text = w.mail_text("new_pod", pod_id="abc", url="https://abc-8917.proxy.runpod.net", extra="ok")
        self.assertIn("abc", text)
        self.assertIn("https://abc-8917.proxy.runpod.net", text)
        self.assertNotIn("Bearer", text)


class DryRun(unittest.TestCase):
    """--dry-run: decide() 는 정상대로 돌지만 조치는 하나도 안 나간다 (컨트롤러 판단 1)."""

    def test_running_unhealthy_skips_restart(self):
        st = w.State()
        real_pod = w.pod
        calls = []

        class FakePod:
            PodError = real_pod.PodError

            @staticmethod
            def find_pods(name):
                return [{"id": "p1", "name": name, "desiredStatus": "RUNNING"}]

            @staticmethod
            def health_once(pod_id, timeout=10):
                return {"ready": False}

        orig_pod, orig_restart, orig_balance, orig_state_dir = (
            w.pod, w.do_restart, w.check_balance, w.state_dir,
        )
        w.pod = FakePod
        w.do_restart = lambda *a, **k: calls.append(a)
        w.check_balance = lambda *a, **k: None  # 잔액 조회는 네트워크가 필요해 이 시험에서는 막는다
        w.state_dir = lambda: HERE  # watch.paused 가 없는 자리
        try:
            action = w.tick(st, 1000.0, dry_run=True)
        finally:
            w.pod, w.do_restart, w.check_balance, w.state_dir = (
                orig_pod, orig_restart, orig_balance, orig_state_dir,
            )
        self.assertEqual(action, "restart")
        self.assertEqual(calls, [])


if __name__ == "__main__":
    unittest.main()
