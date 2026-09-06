#!/usr/bin/env python3
"""추론 팟 감시자 — 상시 서버(OCI)에서 systemd 로 돈다. 세지 않고, 싼 조치부터.

정본: decisions/092-pod-self-heal-and-watcher.md (C · D · E · F)
설치: deploy/runpod-watch-install.sh · 운영: deploy/README.md 「팟이 죽으면」

## 매 회(30초) 하는 일 — 순서가 곧 정책입니다

1. RunPod API 로 이름이 finally-demo 인 팟을 본다. RUNNING 이 없으면 → 새 팟.
2. 있으면 /health 한 번. ready 면 끝.
3. 아니면: 재시작 건 지 180초 안이면 기다림 · 아니면 ssh 로 restart.sh.
4. 재시작 뒤 180초 지나도 안 되면 → 그 팟 terminate + 새 팟.

「연속 N회 실패」 조건이 없습니다. 재시작 직후 모델을 올리는 20~40초는 「조치 뒤 유예」로,
잠깐의 흔들림에 비싼 조치를 하는 것은 「싼 조치부터」로 막습니다.

## 쓰는 법

    python3 deploy/runpod-watch.py            # 계속 돈다 (systemd 가 이렇게 띄운다)
    python3 deploy/runpod-watch.py --once     # 한 회만 — 손으로 확인할 때
    python3 deploy/runpod-watch.py --once --shadow   # 새 팟 경로를 시험 — 만들고 채우고 health 까지, 주소 교체 없이 terminate
    python3 deploy/runpod-watch.py --once --dry-run  # 판단만 보고 조치는 안 함 — 운영 팟을 상대로 안전하게 확인할 때(잔액 조회는 함)

멈추려면(손으로 down 할 때 등): touch /var/lib/finally/watch.paused
환경변수(/etc/finally/watch.env): RUNPOD_API_KEY · TRANSCRIBER_TOKEN · POD_SSH_KEY · GITHUB_TOKEN ·
GITHUB_REPO · APP_ORIGIN · CRON_SECRET · MAILER_API_KEY · MAILER_FROM · NOTIFY_TO · STATE_DIR ·
WATCH_POD_NAME(시험용 — 이름을 바꿔 진짜 finally-demo 팟과 분리 · shadow 는 여기에 -shadow 를 더 붙임) ·
WATCH_NO_SWITCH=1(주소 교체를 건너뛰고 로그만 남김 — 던져 쓰는 시험 팟 드릴용)
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass, field
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("runpod_pod", HERE / "runpod-pod.py")
pod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pod)


def env(name: str, default: str | None = None) -> str | None:
    return os.environ.get(name) or default


GRACE_SEC = 180
LOOP_SEC = 30
LOW_BALANCE_HOURS = 12
NOTIFY_EVERY_SEC = 6 * 3600
BALANCE_EVERY_SEC = 10 * 60
CREATE_FAILURES_MAX = 3
CREATE_PAUSE_SEC = 3600
# WATCH_POD_NAME 은 시험용 — 진짜 finally-demo 팟을 건드리지 않고 던져 쓰는 팟으로 드릴할 때 쓴다
POD_NAME = env("WATCH_POD_NAME") or pod.POD_NAME


@dataclass
class State:
    pod_id: str | None = None
    restart_pod: str | None = None
    restart_at: float = 0.0
    creating: dict | None = None
    create_failures: list[float] = field(default_factory=list)
    notified: dict[str, float] = field(default_factory=dict)
    balance_checked_at: float = 0.0


def decide(state: State, now: float, pods: list[dict], healthy: bool | None) -> tuple:
    """판단만. 네트워크도 파일도 안 건드린다 — 시험이 표로 검다."""
    running = [p for p in pods if p.get("desiredStatus") == "RUNNING"]
    if not running:
        leftover = pods[0]["id"] if pods else None
        return ("recreate", leftover)
    chosen = next((p for p in running if p["id"] == state.pod_id), running[0])
    pid = chosen["id"]
    if healthy:
        return ("ok", pid)
    if state.restart_pod == pid and state.restart_at:
        if now - state.restart_at < GRACE_SEC:
            return ("wait", "warming")
        return ("recreate", pid)
    return ("restart", pid)


def apply_ok(state: State, pod_id: str, now: float) -> None:
    state.pod_id = pod_id
    state.restart_pod = None
    state.restart_at = 0.0


def should_notify(state: State, kind: str, now: float) -> bool:
    # 없으면(한 번도 안 보냄) 바로 보낸다 — 0.0 을 기본값으로 두면 now 가 작을 때
    # "이미 epoch 0 에 보낸 것"이 되어 첫 알림이 6시간 뒤로 밀린다.
    last = state.notified.get(kind)
    return last is None or now - last >= NOTIFY_EVERY_SEC


def mark_notified(state: State, kind: str, now: float) -> None:
    state.notified[kind] = now


def hours_left(balance: float, per_hour: float) -> float:
    return float("inf") if per_hour <= 0 else balance / per_hour


def creation_paused(state: State, now: float) -> bool:
    recent = [t for t in state.create_failures if now - t < CREATE_PAUSE_SEC]
    return len(recent) >= CREATE_FAILURES_MAX


# ── 환경 · 상태 ─────────────────────────────────────────────────────────


def state_dir() -> Path:
    return Path(env("STATE_DIR", "/var/lib/finally"))


def load_state(path: Path) -> State:
    if not path.exists():
        return State()
    try:
        return State(**json.loads(path.read_text()))
    except (ValueError, TypeError):
        return State()


def save_state(path: Path, st: State) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(asdict(st)))


def log(msg: str) -> None:
    print(f"{time.strftime('%Y-%m-%dT%H:%M:%S%z')} {msg}", flush=True)


def http(req_or_url, *, data=None, method=None, headers=None, timeout=30):
    """이 파일이 거는 모든 바깥 요청에 User-Agent 를 붙인다 — GitHub API 는 UA 없는 요청을
    거절하고, RunPod 프록시는 Cloudflare 뒤에 있어 기본 urllib UA 에 403 을 돌려준다."""
    hdrs = {"User-Agent": "finally-runpod-watch/1", **(headers or {})}
    if isinstance(req_or_url, urllib.request.Request):
        for k, v in hdrs.items():
            req_or_url.add_header(k, v)
        req = req_or_url
    else:
        req = urllib.request.Request(req_or_url, data=data, method=method, headers=hdrs)
    return urllib.request.urlopen(req, timeout=timeout)


# ── 조치 ────────────────────────────────────────────────────────────────


def do_restart(pod_obj: dict) -> None:
    target = pod.ssh_target(pod_obj)
    if not target:
        raise pod.PodError("ssh 포트가 안 열려 있어 재시작을 못 겁니다")
    ip, port = target
    subprocess.run(pod.ssh_base(ip, port) + ["setsid /opt/finally/restart.sh < /dev/null"], check=True, timeout=60)


def do_recreate(st: State, old_pod_id: str | None, now: float, shadow: bool = False, save=None) -> str | None:
    """새 팟 — 손 절차 그대로. 실패하면 create_failures 에 적고 None.

    `save` 는 상태를 즉시 디스크에 적는 콜백(tick 이 넘겨줌). 이 함수는 모델 내려받기·
    vercel-env 대기로 수십 분이 걸릴 수 있어, st.creating 을 세팅한 직후 저장해 두지 않으면
    그 사이 감시자가 죽었을 때 watch.json 에는 여전히 creating: null 이 남아 유료 팟이
    고아로 남는다 — 그래서 세팅 직후와, 다 끝나 지운 직후 두 번 부른다(검토 반영 1).
    """
    if creation_paused(st, now):
        log("새 팟 만들기를 쉽니다 — 한 시간에 세 번 실패했습니다")
        return None
    name = f"{POD_NAME}-shadow" if shadow else POD_NAME
    new_id = None
    try:
        for attempt in range(3):
            created = pod.create_pod(name)
            new_id = created["id"]
            st.creating = {"pod_id": new_id, "since": now}
            if save:
                save(st)
            log(f"팟 생성 {new_id} (시도 {attempt + 1})")
            try:
                pod.provision(new_id)
                break
            except pod.PodError as e:
                # runpod-bench.md 의 두 함정(CUDA · 22/tcp) — down 뒤 다시 up
                log(f"채우기 실패 {new_id}: {e} → terminate 후 다시")
                pod.terminate(new_id)
                new_id = None
        if not new_id:
            raise pod.PodError("세 번 만들어도 채우지 못했습니다")
        if not pod.wait_ready(new_id, minutes=15):
            raise pod.PodError(f"{new_id} 가 15분이 지나도 ready 가 아닙니다")
        url = pod.proxy_url(new_id)
        if shadow:
            log(f"shadow — {url} ready 확인. 주소 교체 없이 terminate")
            pod.terminate(new_id)
            st.creating = None
            if save:
                save(st)
            return new_id
        switched = switch_backend(url)
        # 주소 교체가 안 됐는데 옛 팟을 지우면, 실서비스는 여전히 그 주소를 보는 채로
        # 팟만 없어진다 — 교체가 확인된 뒤에만 지운다(검토 반영 3)
        if old_pod_id and old_pod_id != new_id and switched:
            try:
                pod.terminate(old_pod_id)
            except pod.PodError as e:
                log(f"옛 팟 {old_pod_id} terminate 실패: {e}")
        resub = call_resubmit() if switched else None
        extra = f"switched={switched} resubmit={resub}"
        if not switched and old_pod_id and old_pod_id != new_id:
            extra += (
                f"\n옛 팟 {old_pod_id} 은 남겨 두었습니다 — 주소 교체가 안 됐습니다. "
                "vercel-env 로 새 주소를 넣은 뒤 옛 팟을 손으로 지우세요"
            )
        send_mail(
            "[FinAlly] 추론 팟을 새로 세웠습니다" + ("" if switched else " — 주소 교체는 손으로"),
            mail_text("new_pod", pod_id=new_id, url=url, extra=extra),
        )
        st.creating = None
        st.create_failures = []
        if save:
            save(st)
        return new_id
    except (pod.PodError, subprocess.SubprocessError, OSError) as e:
        # now 는 tick 이 회차를 시작한 시각 — 이 함수가 수십 분 걸릴 수 있어 실패 시각으로
        # 쓰면 creation_paused() 의 "한 시간에 세 번" 판정이 실제보다 훨씬 느리게 찬다.
        # 진짜 지금 시각을 적는다(검토 반영 5).
        st.create_failures.append(time.time())
        st.creating = None
        if new_id:
            try:
                pod.terminate(new_id)
            except pod.PodError:
                pass
        log(f"새 팟 실패: {e}")
        if should_notify(st, "create_failed", now):
            send_mail("[FinAlly] 추론 팟을 새로 세우지 못했습니다", mail_text("create_failed", extra=str(e)))
            mark_notified(st, "create_failed", now)
        return None


# ── GitHub — vercel-env 워크플로로 주소 교체 (ADR-092 D-④) ─────────────────


def gh(method: str, path: str, body: dict | None = None) -> dict | list | None:
    token = env("GITHUB_TOKEN")
    if not token:
        raise pod.PodError("GITHUB_TOKEN 이 없습니다")
    with http(
        f"https://api.github.com{path}",
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
        },
        timeout=60,
    ) as res:
        raw = res.read()
        return json.loads(raw) if raw else None


def pick_run_after(runs: list[dict], since_iso: str) -> dict | None:
    later = [r for r in runs if r.get("created_at", "") >= since_iso]
    return min(later, key=lambda r: r["created_at"]) if later else None


def switch_backend(url: str) -> bool:
    """vercel-env 를 걸고 끝나기를 기다린다. 토큰이 없거나 실패하면 False — 메일로 사람에게.
    WATCH_NO_SWITCH=1 이면 GitHub 를 아예 부르지 않는다 — 던져 쓰는 시험 팟 드릴용(컨트롤러 판단 2)."""
    if env("WATCH_NO_SWITCH") == "1":
        log("주소 교체 금지(WATCH_NO_SWITCH) — 건너뜀")
        return False
    repo = env("GITHUB_REPO", "Dojaegyum/fsec-ai-challenge")
    if not env("GITHUB_TOKEN"):
        log("GITHUB_TOKEN 이 없어 주소 교체를 건너뜁니다 — 손으로 vercel-env")
        return False
    since = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - 5))
    try:
        gh("POST", f"/repos/{repo}/actions/workflows/vercel-env.yml/dispatches", {
            "ref": "main",
            "inputs": {"transcriber_url": url, "ner_url": url, "set_ner_token": "true", "redeploy": "true"},
        })
        run = None
        for _ in range(24):
            time.sleep(5)
            got = gh("GET", f"/repos/{repo}/actions/workflows/vercel-env.yml/runs?event=workflow_dispatch&per_page=5")
            run = pick_run_after((got or {}).get("workflow_runs", []), since)
            if run:
                break
        if not run:
            log("vercel-env 실행을 못 찾았습니다")
            return False
        for _ in range(60):  # 최대 30분 — 워크플로 자체가 deploy 를 기다립니다
            time.sleep(30)
            cur = gh("GET", f"/repos/{repo}/actions/runs/{run['id']}")
            if cur and cur.get("status") == "completed":
                ok = cur.get("conclusion") == "success"
                log(f"vercel-env {run['id']} → {cur.get('conclusion')}")
                return ok
        log("vercel-env 가 30분 안에 안 끝났습니다")
        return False
    except (urllib.error.URLError, urllib.error.HTTPError, pod.PodError, ValueError) as e:
        log(f"주소 교체 실패: {e}")
        return False


# ── 앱 — 다시 맡기기 (ADR-091 §5) ─────────────────────────────────────────


def call_resubmit() -> dict | None:
    origin, secret = env("APP_ORIGIN"), env("CRON_SECRET")
    if not origin or not secret:
        return None
    try:
        with http(
            f"{origin.rstrip('/')}/api/cron/evidence-resubmit",
            method="POST",
            headers={"Authorization": f"Bearer {secret}"},
            timeout=90,
        ) as res:
            return json.loads(res.read())
    except (urllib.error.URLError, urllib.error.HTTPError, ValueError) as e:
        log(f"다시 맡기기 호출 실패: {e}")
        return None


# ── 메일 (Brevo · ADR-092 F) ─────────────────────────────────────────────


def mail_text(kind: str, pod_id: str = "", url: str = "", extra: str = "") -> str:
    lines = {
        "restart": "팟은 RUNNING 인데 /health 가 안 돼 ssh 로 restart.sh 를 걸었습니다.",
        "new_pod": "팟이 없거나 재시작으로 안 살아나 새 팟을 만들고 채웠습니다.",
        "create_failed": "새 팟을 만들거나 채우지 못했습니다. RunPod 콘솔과 잔액을 보세요.",
        "low_balance": "RunPod 잔액이 12시간치 아래입니다. 충전하지 않으면 팟이 삭제됩니다.",
    }
    return "\n".join(filter(None, [
        lines.get(kind, kind),
        f"팟: {pod_id}" if pod_id else "",
        f"주소: {url}" if url else "",
        extra,
        "— finally-runpod-watch (ADR-092)",
    ]))


def send_mail(subject: str, text: str) -> None:
    key, sender, to = env("MAILER_API_KEY"), env("MAILER_FROM"), env("NOTIFY_TO")
    if not (key and sender and to):
        log(f"메일 설정이 없어 로그로만: {subject}")
        return
    body = {"sender": {"email": sender}, "to": [{"email": to}], "subject": subject, "textContent": text}
    try:
        http(
            "https://api.brevo.com/v3/smtp/email",
            data=json.dumps(body).encode(),
            method="POST",
            headers={"api-key": key, "Content-Type": "application/json", "Accept": "application/json"},
            timeout=30,
        ).read()
    except (urllib.error.URLError, urllib.error.HTTPError) as e:
        log(f"메일 실패: {e}")


# ── 잔액 (ADR-092 A) ────────────────────────────────────────────────────


def check_balance(st: State, now: float, dry_run: bool = False) -> None:
    if now - st.balance_checked_at < BALANCE_EVERY_SEC:
        return
    if not dry_run:
        # 실패해도 10분은 쉰다 — 다만 --dry-run 은 이 쿨다운을 안 건드린다. 건드리면 dry-run
        # 직후에 도는 진짜 회차의 첫 잔액 조회가 밀린다(검토 반영 2)
        st.balance_checked_at = now
    key = env("RUNPOD_API_KEY")
    try:
        with http(
            "https://api.runpod.io/graphql",
            data=json.dumps({"query": "{ myself { clientBalance currentSpendPerHr } }"}).encode(),
            method="POST",
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            timeout=30,
        ) as res:
            me = json.loads(res.read())["data"]["myself"]
    except (urllib.error.URLError, urllib.error.HTTPError, ValueError, KeyError) as e:
        log(f"잔액 조회 실패: {e}")
        return
    if not me or "clientBalance" not in me or "currentSpendPerHr" not in me:
        # GraphQL 이 200 을 주면서 myself: null 을 돌려주는 경우(예: 키가 무효) — try 밖에서
        # me["clientBalance"] 를 바로 쓰면 TypeError 가 새 나간다(검토 반영 · 사소 2)
        log("잔액 응답을 읽지 못했습니다")
        return
    hours = hours_left(float(me["clientBalance"]), float(me["currentSpendPerHr"]))
    log(f"잔액 ${me['clientBalance']:.2f} · 시간당 ${me['currentSpendPerHr']:.3f} · {hours:.1f}h")
    if dry_run:
        return  # 읽고 로그만 남긴다 — 메일도, 쿨다운 갱신도 안 한다(컨트롤러 판단 1 · 검토 반영 2)
    if hours < LOW_BALANCE_HOURS and should_notify(st, "low_balance", now):
        send_mail("[FinAlly] RunPod 잔액이 12시간치 아래입니다", mail_text("low_balance", extra=f"{hours:.1f}시간 남음"))
        mark_notified(st, "low_balance", now)


# ── 한 회 ───────────────────────────────────────────────────────────────


def tick(st: State, now: float, shadow: bool = False, dry_run: bool = False) -> str:
    if (state_dir() / "watch.paused").exists():
        return "paused"
    if st.creating:
        # 만드는 도중 감시자가 죽었던 흔적 — 그 팟이 ready 면 쓰고, 아니면 지웁니다.
        # --dry-run 에서는 terminate 도 조치이므로 건드리지 않고 다음(진짜) 회차로 넘긴다.
        leftover = st.creating["pod_id"]
        if dry_run:
            log(f"tick(dry-run) → 만드는 도중 남은 팟 {leftover} 정리는 건너뜁니다")
        else:
            st.creating = None
            if not (pod.health_once(leftover) or {}).get("ready"):
                try:
                    pod.terminate(leftover)
                except pod.PodError:
                    pass
    try:
        pods = pod.find_pods(POD_NAME)
        running = [p for p in pods if p.get("desiredStatus") == "RUNNING"]
        healthy = None
        if running:
            chosen = next((p for p in running if p["id"] == st.pod_id), running[0])
            healthy = bool((pod.health_once(chosen["id"]) or {}).get("ready"))
    except pod.PodError as e:
        # RunPod API 호출 한 번이 실패했다고 감시자가 죽으면 안 된다 — 이번 회차만 건너뛴다
        log(f"팟 상태를 못 가져왔습니다: {e}")
        return "error"
    action, arg = decide(st, now, pods, healthy)
    if dry_run:
        log(f"tick(dry-run) → {action} {arg}")
        check_balance(st, now, dry_run=True)
        return action

    def save_now(s: State) -> None:
        save_state(state_dir() / "watch.json", s)

    if shadow:
        do_recreate(st, None, now, shadow=True, save=save_now)
        return "shadow"
    if action == "ok":
        apply_ok(st, arg, now)
    elif action == "wait":
        pass
    elif action == "restart":
        target = next(p for p in running if p["id"] == arg)
        log(f"{arg} 가 RUNNING 인데 health 실패 → restart.sh")
        restart_error = None
        try:
            do_restart(target)
        except (pod.PodError, subprocess.SubprocessError) as e:
            restart_error = str(e)
            log(f"재시작 못 걸음: {e}")
        st.restart_pod, st.restart_at = arg, now
        if should_notify(st, "restart", now):
            # restart.sh 를 못 걸었으면 메일이 "걸었다"고 하면 안 된다 — 실패 사실을 적는다(검토 반영 · 사소 1)
            extra = f"ssh 로 restart.sh 를 걸지 못했습니다 — {restart_error}" if restart_error else ""
            send_mail("[FinAlly] 추론 팟을 재시작했습니다", mail_text("restart", pod_id=arg, extra=extra))
            mark_notified(st, "restart", now)
    elif action == "recreate":
        log(f"새 팟 — 이유: {'팟 없음' if arg is None or not running else '재시작 뒤에도 안 살아남'}")
        new_id = do_recreate(st, arg, now, save=save_now)
        if new_id:
            apply_ok(st, new_id, time.time())
    check_balance(st, now)
    return action


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--shadow", action="store_true", help="새 팟 경로만 시험 — 주소 교체 없이 terminate")
    ap.add_argument("--dry-run", action="store_true", help="판단만 하고 조치는 하지 않음 — 운영 팟 검증용")
    args = ap.parse_args()
    path = state_dir() / "watch.json"
    while True:
        st = load_state(path)
        try:
            action = tick(st, time.time(), shadow=args.shadow, dry_run=args.dry_run)
            log(f"tick → {action}")
        except Exception as e:  # noqa: BLE001 — 감시자는 어떤 예외에도 죽지 않고 다음 회차로
            log(f"tick 예외: {e!r}")
        if not args.dry_run:
            # --dry-run 은 아무것도 안 쓴다 — OCI 박스에서 손으로 돌리는 dry-run 이 진짜 데몬과
            # 같은 STATE_DIR 을 볼 때, 이 줄이 있으면 last-writer-wins 으로 진짜 상태
            # (restart_pod·restart_at 등)를 지울 수 있다(검토 반영 2)
            save_state(path, st)
        if args.once:
            return
        time.sleep(LOOP_SEC)


if __name__ == "__main__":
    main()
