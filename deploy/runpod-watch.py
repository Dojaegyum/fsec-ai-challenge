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

멈추려면(손으로 down 할 때 등): touch /var/lib/finally/watch.paused
환경변수(/etc/finally/watch.env): RUNPOD_API_KEY · TRANSCRIBER_TOKEN · POD_SSH_KEY · GITHUB_TOKEN ·
GITHUB_REPO · APP_ORIGIN · CRON_SECRET · MAILER_API_KEY · MAILER_FROM · NOTIFY_TO · STATE_DIR
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

GRACE_SEC = 180
LOOP_SEC = 30
LOW_BALANCE_HOURS = 12
NOTIFY_EVERY_SEC = 6 * 3600
BALANCE_EVERY_SEC = 10 * 60
CREATE_FAILURES_MAX = 3
CREATE_PAUSE_SEC = 3600
POD_NAME = pod.POD_NAME


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
