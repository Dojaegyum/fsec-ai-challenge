"""감시자의 판단 시험 — ADR-092 C. 세지 않고, 싼 조치부터, 비싼 조치는 확인된 사실 뒤에만."""
import dataclasses
import importlib.util
import json
import pathlib
import sys
import tempfile
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


class _Patch:
    """w 의 모듈 속성 여러 개를 바꿨다가 끝나면 되돌리는 컨텍스트 매니저 — 시험마다
    try/finally 를 반복하지 않게 (Fix round 1 시험들이 공유해서 쓴다)."""

    def __init__(self, **attrs):
        self.attrs = attrs
        self.orig = {}

    def __enter__(self):
        for k, v in self.attrs.items():
            self.orig[k] = getattr(w, k)
            setattr(w, k, v)
        return self

    def __exit__(self, *exc):
        for k, v in self.orig.items():
            setattr(w, k, v)
        return False


def make_fake_pod(**overrides):
    """runpod-pod.py 를 흉내내는 가짜 모듈 — 필요한 함수만 overrides 로 갈아 끼운다.
    PodError 는 진짜 것을 그대로 물려줘 tick()/do_recreate() 의 except pod.PodError 가 맞게 잡는다."""
    real_pod = w.pod
    defaults = {
        "find_pods": lambda name: [],
        "health_once": lambda pod_id, timeout=10: None,
        "create_pod": lambda name: {"id": "new1"},
        "provision": lambda pod_id: None,
        "wait_ready": lambda pod_id, minutes=15: True,
        "proxy_url": lambda pod_id: f"https://{pod_id}-8917.proxy.runpod.net",
        "terminate": lambda pod_id: None,
    }
    defaults.update(overrides)
    attrs = {"PodError": real_pod.PodError}
    attrs.update({k: staticmethod(v) for k, v in defaults.items()})
    return type("FakePod", (), attrs)


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

    def test_dry_run_leaves_state_completely_untouched(self):
        # 컨트롤러 판단 2 — check_balance 를 무해하게 막아 두면, dry-run 은 State 를
        # 필드 하나도 안 바꿔야 한다(파일 쓰기는 main() 이 --dry-run 이면 아예 안 함).
        st = w.State()
        before = dataclasses.asdict(st)
        FakePod = make_fake_pod(
            find_pods=lambda name: [{"id": "p1", "name": name, "desiredStatus": "RUNNING"}],
            health_once=lambda pod_id, timeout=10: {"ready": False},
        )
        with _Patch(pod=FakePod, check_balance=lambda *a, **k: None, state_dir=lambda: HERE):
            w.tick(st, 1000.0, dry_run=True)
        self.assertEqual(dataclasses.asdict(st), before)


class DoRecreateSaves(unittest.TestCase):
    """감시자가 팟을 만드는 도중 죽어도 watch.json 에 흔적이 남아야 한다 (검토 반영 1)."""

    def test_creating_saved_immediately_and_cleared_on_success(self):
        st = w.State()
        saved = []
        FakePod = make_fake_pod()
        with _Patch(pod=FakePod, switch_backend=lambda url: True,
                    call_resubmit=lambda: None, send_mail=lambda *a, **k: None):
            new_id = w.do_recreate(st, None, 1000.0, save=lambda s: saved.append(dataclasses.asdict(s)))
        self.assertEqual(new_id, "new1")
        self.assertGreaterEqual(len(saved), 2)
        self.assertEqual(saved[0]["creating"], {"pod_id": "new1", "since": 1000.0})
        self.assertIsNone(saved[-1]["creating"])


class DoRecreateOldPod(unittest.TestCase):
    """주소 교체가 안 됐으면 옛 팟을 지우면 안 된다 (검토 반영 3)."""

    def _run(self, switched):
        st = w.State()
        terminated = []
        mails = []
        FakePod = make_fake_pod(terminate=lambda pod_id: terminated.append(pod_id))
        with _Patch(pod=FakePod, switch_backend=lambda url: switched,
                    call_resubmit=lambda: None, send_mail=lambda *a, **k: mails.append(a)):
            w.do_recreate(st, "old1", 1000.0)
        return terminated, mails

    def test_old_pod_terminated_when_switch_succeeds(self):
        terminated, _ = self._run(True)
        self.assertIn("old1", terminated)

    def test_old_pod_kept_when_switch_fails(self):
        terminated, mails = self._run(False)
        self.assertNotIn("old1", terminated)
        self.assertTrue(any("옛 팟 old1 은 남겨 두었습니다" in text for _, text in mails))


class AdoptLeftoverPod(unittest.TestCase):
    """만들다 죽었는데 그 팟이 준비돼 있으면 **이어받아야** 한다 (검토 반영 I1).

    안 그러면 st.pod_id 는 여전히 옛 팟이라 decide 가 그 팟을 고르고, 그 팟이 죽어 있으면
    recreate 로 **세 번째** 팟을 만든다 — 준비된 유료 팟 하나가 고아로 계속 돈다."""

    def _tick(self, switched, tmp):
        st = w.State(pod_id="X", creating={"pod_id": "Y", "since": 900.0})
        terminated, mails = [], []
        FakePod = make_fake_pod(
            find_pods=lambda name: [running("X"), running("Y")],
            health_once=lambda pod_id, timeout=10: {"ready": pod_id == "Y"},
            create_pod=lambda name: self.fail("새 팟을 만들면 안 된다 — 이어받아야 한다"),
            terminate=lambda pod_id: terminated.append(pod_id),
        )
        with _Patch(pod=FakePod, switch_backend=lambda url: switched,
                    call_resubmit=lambda: None, send_mail=lambda *a, **k: mails.append(a),
                    check_balance=lambda *a, **k: None, state_dir=lambda: tmp):
            action = w.tick(st, 1000.0)
        return action, st, terminated, mails

    def test_ready_leftover_is_adopted_and_old_pod_terminated_when_switched(self):
        with tempfile.TemporaryDirectory() as d:
            action, st, terminated, mails = self._tick(True, pathlib.Path(d))
        self.assertEqual(action, "adopted")
        self.assertEqual(st.pod_id, "Y")
        self.assertIsNone(st.creating)
        self.assertEqual(terminated, ["X"])  # 이어받은 Y 는 절대 지우지 않는다
        self.assertTrue(any("새로 세웠습니다" in subject for subject, _ in mails))

    def test_old_pod_kept_when_address_switch_failed(self):
        with tempfile.TemporaryDirectory() as d:
            action, st, terminated, mails = self._tick(False, pathlib.Path(d))
        self.assertEqual(action, "adopted")
        self.assertEqual(st.pod_id, "Y")
        self.assertEqual(terminated, [])
        self.assertTrue(any("옛 팟 X 은 남겨 두었습니다" in text for _, text in mails))


class ExtraPodsBackstop(unittest.TestCase):
    """ok 회차에도 같은 이름의 팟이 둘 이상이면 사람에게 알린다 — 과금이 두 배 (검토 반영 I1)."""

    def _ok_tick(self, st, now, mails, tmp):
        FakePod = make_fake_pod(
            find_pods=lambda name: [running("p1"), running("p2")],
            health_once=lambda pod_id, timeout=10: {"ready": True},
        )
        with _Patch(pod=FakePod, send_mail=lambda *a, **k: mails.append(a),
                    check_balance=lambda *a, **k: None, state_dir=lambda: tmp):
            return w.tick(st, now)

    def test_mails_once_and_not_again_within_six_hours(self):
        st = w.State()
        mails = []
        with tempfile.TemporaryDirectory() as d:
            tmp = pathlib.Path(d)
            self.assertEqual(self._ok_tick(st, 1000.0, mails, tmp), "ok")
            self.assertEqual(len(mails), 1)
            self.assertIn("둘 이상", mails[0][0])
            self.assertIn("p2", mails[0][1])
            self.assertEqual(self._ok_tick(st, 1000.0 + 6 * 3600 - 1, mails, tmp), "ok")
        self.assertEqual(len(mails), 1)


class ShadowStateFile(unittest.TestCase):
    """손으로 도는 --shadow 는 데몬의 watch.json 을 건드리면 안 된다 (검토 반영 I3)."""

    def test_shadow_uses_its_own_file(self):
        with tempfile.TemporaryDirectory() as d:
            with _Patch(state_dir=lambda: pathlib.Path(d)):
                self.assertEqual(w.state_path().name, "watch.json")
                self.assertEqual(w.state_path(True).name, "watch-shadow.json")


class CreateFailureTimestamp(unittest.TestCase):
    """create_failures 는 tick 의 now 가 아니라 실패한 실제 시각을 적어야 한다 —
    do_recreate 가 수십 분 걸릴 수 있어 now 를 쓰면 creation_paused() 가 실제보다
    훨씬 느리게 찬다 (검토 반영 5)."""

    def test_uses_real_clock_not_ticks_now(self):
        st = w.State()
        real_pod = w.pod

        class FailingPod:
            PodError = real_pod.PodError

            @staticmethod
            def create_pod(name):
                raise FailingPod.PodError("boom")

        real_time_time = w.time.time
        fixed = 5000.0
        w.pod = FailingPod
        w.time.time = lambda: fixed  # 실제 time 모듈의 time 을 바꾼다 — 반드시 되돌린다
        try:
            result = w.do_recreate(st, None, 1000.0)
        finally:
            w.pod = real_pod
            w.time.time = real_time_time
        self.assertIsNone(result)
        self.assertEqual(st.create_failures[-1], fixed)


class RestartFailureMail(unittest.TestCase):
    """ssh 로 restart.sh 를 못 걸었으면 메일이 "걸었다"고 하면 안 된다 (검토 반영 · 사소 1)."""

    def test_mail_reports_failure_when_do_restart_raises(self):
        st = w.State()
        mails = []
        FakePod = make_fake_pod(
            find_pods=lambda name: [{"id": "p1", "name": name, "desiredStatus": "RUNNING"}],
            health_once=lambda pod_id, timeout=10: {"ready": False},
        )

        def failing_restart(pod_obj):
            raise w.pod.PodError("ssh 안 됨")

        with _Patch(pod=FakePod, do_restart=failing_restart,
                    send_mail=lambda *a, **k: mails.append(a),
                    check_balance=lambda *a, **k: None, state_dir=lambda: HERE):
            action = w.tick(st, 1000.0)
        self.assertEqual(action, "restart")
        self.assertEqual(len(mails), 1)
        _, text = mails[0]
        self.assertIn("ssh 로 restart.sh 를 걸지 못했습니다 — ssh 안 됨", text)

    def test_subject_and_first_line_do_not_claim_it_was_issued(self):
        st = w.State()
        mails = []
        FakePod = make_fake_pod(
            find_pods=lambda name: [{"id": "p1", "name": name, "desiredStatus": "RUNNING"}],
            health_once=lambda pod_id, timeout=10: {"ready": False},
        )

        def failing_restart(pod_obj):
            raise w.pod.PodError("ssh 안 됨")

        with _Patch(pod=FakePod, do_restart=failing_restart,
                    send_mail=lambda *a, **k: mails.append(a),
                    check_balance=lambda *a, **k: None, state_dir=lambda: HERE):
            w.tick(st, 1000.0)
        self.assertEqual(len(mails), 1)
        subject, text = mails[0]
        self.assertEqual(subject, "[FinAlly] 추론 팟 재시작을 걸지 못했습니다")
        self.assertEqual(
            text.splitlines()[0],
            "팟은 RUNNING 인데 /health 가 안 되고, ssh 로 restart.sh 를 걸지 못했습니다.",
        )


class BalanceDryRun(unittest.TestCase):
    """--dry-run 은 잔액을 읽고 로그는 남기되, 쿨다운 타임스탬프도 메일도 남기면 안 된다
    (컨트롤러 판단 1 · 검토 반영 2)."""

    def test_dry_run_reads_but_does_not_persist_or_mail(self):
        st = w.State()
        mails = []

        class FakeResp:
            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def read(self):
                return json.dumps({"data": {"myself": {"clientBalance": 1.0, "currentSpendPerHr": 10.0}}}).encode()

        with _Patch(http=lambda *a, **k: FakeResp(), send_mail=lambda *a, **k: mails.append(a)):
            w.check_balance(st, 1000.0, dry_run=True)
        self.assertEqual(st.balance_checked_at, 0.0)
        self.assertEqual(mails, [])


class BalanceBadResponse(unittest.TestCase):
    """GraphQL 이 200 을 주면서 myself: null 을 돌려줘도 TypeError 로 새 나가면 안 된다
    (검토 반영 · 사소 2)."""

    def test_none_myself_does_not_raise(self):
        st = w.State()

        class FakeResp:
            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def read(self):
                return b'{"data": {"myself": null}}'

        with _Patch(http=lambda *a, **k: FakeResp()):
            w.check_balance(st, 1000.0)  # 예외 없이 끝나면 통과


if __name__ == "__main__":
    unittest.main()
