"""작업 하나의 수명 — 접수하고, 돌리고, 물어보면 알려준다.

정본: spec/common/08-14-api.md §3.2 3단계(`202 · processing`) · §3.3(폴링)

## 왜 기다리게 하지 않나

전사는 몇 분 걸립니다. 그리고 앱은 Vercel 함수 위에서 도는데 그렇게 오래 못 삽니다.
**계약이 이미 폴링입니다** — 업로드 완료에 `202 처리 중` 을 돌려주고 화면이 다시 물어봅니다.
그 모양을 여기서도 씁니다.

## 왜 콜백이 아닌가

셋입니다. **①** 폴링은 이미 계약에 있고 콜백은 새로 만들어야 합니다.
**②** 콜백이면 밖에서 앱을 부르는 구멍을 뚫고 거기에 인증을 걸어야 합니다 —
지금은 **들어오는 구멍이 없습니다.**
**③** 요청이 올 때만 켜지는 방식(ADR-043)이면 서비스가 죽었다 살아나는데,
그 사이 콜백은 유실됩니다. 폴링은 살아난 뒤 다시 물어보면 됩니다.

## 작업은 메모리에만 있습니다

⬜ **다시 뜨면 사라집니다.** 지금은 그래도 됩니다 — 앱이 `evidence.ingest_status`
를 들고 있어서, 작업이 사라지면 다시 접수시키면 됩니다. 사건 상태가 정본이고
여기는 사본입니다. 오래 걸리는 작업이 잦아지면 다시 봐야 합니다.
"""

from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

# 끝난 작업을 언제까지 들고 있나. 화면이 폴링해 가져갈 시간은 줘야 합니다
KEEP_DONE_SECONDS = 30 * 60


@dataclass
class Job:
    job_id: str
    kind: str
    status: str = "running"  # running | done | failed
    percent: int = 0
    engine: str | None = None
    lines: list[dict[str, Any]] = field(default_factory=list)
    # ⚠️ 실패 사유에 **원문을 담지 않습니다.** 이 값은 앱의 감사 기록으로 갑니다
    # → spec/common/08-14-pii-boundary.md · src/lib/errors.ts
    reason: str | None = None
    finished_at: float | None = None


class JobStore:
    """작업을 들고 있는 자리. 스레드 하나가 돌리고 다른 스레드가 물어봅니다."""

    def __init__(self) -> None:
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()

    def create(self, kind: str, job_id: str | None = None) -> Job:
        """작업 하나를 연다.

        **부르는 쪽이 번호를 정할 수 있습니다.** 앱이 증거 번호를 그대로 넘기면,
        앱은 그 번호를 어디에도 저장하지 않고 나중에 다시 물어볼 수 있습니다 —
        번호를 유도할 수 있으니까요.

        같은 번호로 다시 열면 **앞의 작업을 그대로 돌려줍니다.** 재시도가
        진행 중인 전사를 처음부터 다시 돌리면 안 됩니다.
        """
        with self._lock:
            self._sweep()
            if job_id is not None:
                existing = self._jobs.get(job_id)
                if existing is not None:
                    return existing
            job = Job(job_id=job_id or uuid.uuid4().hex, kind=kind)
            self._jobs[job.job_id] = job
        return job

    def get(self, job_id: str) -> Job | None:
        with self._lock:
            return self._jobs.get(job_id)

    def progress(self, job_id: str, percent: int) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job and job.status == "running":
                # 뒤로 가지 않게 합니다 — 화면의 진행률이 줄어들면 고장으로 보입니다
                job.percent = max(job.percent, min(99, percent))

    def finish(self, job_id: str, engine: str | None, lines: list[dict[str, Any]]) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return
            job.status = "done"
            job.percent = 100
            job.engine = engine
            job.lines = lines
            job.finished_at = time.monotonic()

    def fail(self, job_id: str, reason: str) -> None:
        """**사유는 짧은 표시값입니다.** 예외 문구를 그대로 담지 않습니다 —
        판독기 오류 본문에 파일 내용이 섞여 올 수 있습니다."""
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return
            job.status = "failed"
            job.reason = reason
            job.finished_at = time.monotonic()

    def _sweep(self) -> None:
        now = time.monotonic()
        stale = [
            k
            for k, j in self._jobs.items()
            if j.finished_at is not None and now - j.finished_at > KEEP_DONE_SECONDS
        ]
        for k in stale:
            del self._jobs[k]
