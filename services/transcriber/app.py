"""전사·판독 서비스 — 작업을 받고, 돌리고, 물어보면 알려준다.

정본: spec/common/08-14-api.md §3.2 §3.3 · src/modules/transcriber/types.ts
근거: ADR-028(모델은 앱 밖) · ADR-043(GPU 배치) · ADR-026(서버에 닿는 파일의 상태)

## 이 서비스가 무엇이 아닌지

**도메인 판단을 하지 않습니다.** 화자를 A·B 로 붙이는 것, 말풍선 좌·우를 가르는 것,
못 한 것을 밝히는 것은 전부 앱의 `transcriber` 모듈이 합니다. 여기는 **모델을
돌려서 읽은 것을 그대로 내놓는 데까지**입니다.

가르는 기준은 「제품을 바꾸면 바뀌는가」입니다. 모델을 갈아끼우면 이 서비스는
바뀌지만 앱은 안 바뀝니다 — 그래서 판단이 앱에 있어야 합니다.

**토큰화도 여기서 하지 않습니다.** 경계는 `pii-tokenizer` 하나이고, 여기가 두 번째
경계가 되면 우회할 자리가 둘이 됩니다 → spec/common/08-14-pii-boundary.md.

## 파일은 우리가 직접 내려받습니다

앱이 파일을 중계하지 않습니다. 녹음이 수십 MB 라 서버 함수 본문 한계에 걸립니다 —
업로드가 이미 그 이유로 브라우저에서 저장소로 직행합니다(§3.2). 그래서 앱은
**읽기용 임시 주소만** 넘기고, 내려받는 것은 이쪽입니다.
"""

from __future__ import annotations

import logging
import os
import threading
import urllib.request
from typing import Any

from fastapi import BackgroundTasks, FastAPI, Header, HTTPException
from pydantic import BaseModel

from .config import load
from .engines import build_ocr, build_stt
from .jobs import JobStore

log = logging.getLogger("transcriber")

cfg = load()
jobs = JobStore()
app = FastAPI(title="FinAlly transcriber", version="0.1.0")

# 모델은 무겁습니다. 처음 쓸 때 한 번 올리고 계속 씁니다 —
# 요청마다 올리면 몇 분이 매번 붙습니다
_lock = threading.Lock()
_stt = None
_ocr = None


def stt():
    global _stt
    with _lock:
        if _stt is None:
            _stt = build_stt(cfg)
        return _stt


def ocr():
    global _ocr
    with _lock:
        if _ocr is None:
            _ocr = build_ocr(cfg)
        return _ocr


class JobRequest(BaseModel):
    """앱이 보내는 것. **파일이 아니라 파일을 가리키는 주소입니다.**"""

    kind: str  # audio | image
    url: str
    mime_type: str | None = None
    # 나올 법한 낱말 — 기관명 사전 등. ⬜ 효과가 아직 검증되지 않았습니다
    # → docs/research/09 §5.6 (기관명 36건 중 10건이 전사에서 손상)
    vocabulary: list[str] | None = None


def _guard(token: str | None) -> None:
    """앱만 부를 수 있게 합니다.

    ⬜ **비밀값이 없으면 검사하지 않습니다.** 개발 중에 막히지 않으려는 것인데,
    **밖에 열어 둘 때는 반드시 `FINALLY_TOKEN` 을 채워야 합니다** —
    이 서비스는 임의의 주소를 내려받으므로 열어 두면 남의 심부름을 하게 됩니다.
    """
    if cfg.token and token != cfg.token:
        raise HTTPException(status_code=401, detail="unauthorized")


def _download(url: str, dest: str) -> None:
    """읽기용 주소에서 파일을 가져옵니다.

    **크기를 재면서 받습니다.** 상한을 넘으면 중간에 끊습니다 — 한 번에 다 읽으면
    큰 파일이 메모리를 통째로 먹습니다.
    """
    if not url.startswith(("http://", "https://")):
        raise ValueError("unsupported_scheme")
    with urllib.request.urlopen(url, timeout=60) as res:  # noqa: S310 — 위에서 검사함
        got = 0
        with open(dest, "wb") as f:
            while True:
                chunk = res.read(1 << 20)
                if not chunk:
                    break
                got += len(chunk)
                if got > cfg.max_bytes:
                    raise ValueError("too_large")
                f.write(chunk)


def _run(job_id: str, req: JobRequest) -> None:
    """실제로 읽는 자리. **실패해도 서비스는 안 죽습니다.**"""
    os.makedirs(cfg.workdir, exist_ok=True)
    path = os.path.join(cfg.workdir, job_id)
    try:
        jobs.progress(job_id, 5)
        _download(req.url, path)
        jobs.progress(job_id, 20)

        def on_progress(pct: int) -> None:
            # 내려받기가 20% 를 차지하므로 나머지 80% 에 얹습니다
            jobs.progress(job_id, 20 + int(pct * 0.8))

        if req.kind == "audio":
            out = stt().transcribe(
                path, vocabulary=req.vocabulary, on_progress=on_progress
            )
        elif req.kind == "image":
            out = ocr().read(path, on_progress=on_progress)
        else:
            jobs.fail(job_id, "unsupported_kind")
            return

        jobs.finish(job_id, out.get("engine"), out.get("lines", []))
    except Exception as exc:  # noqa: BLE001 — 어떤 실패든 작업만 실패시킵니다
        # **예외 문구를 담지 않습니다.** 파일 내용이 섞여 올 수 있고 이 값은
        # 앱의 감사 기록으로 갑니다. 자세한 것은 서비스 로그에만 남깁니다
        log.exception("job %s failed", job_id)
        reason = str(exc) if isinstance(exc, ValueError) else "engine_failed"
        jobs.fail(job_id, reason)
    finally:
        # ⚠️ **원본을 남기지 않습니다.** 이 서비스는 파일을 보관하는 자리가
        # 아닙니다 — 보관은 객체 저장소가 하고 파기는 사건과 함께 일어납니다
        # → ADR-016 「세 층이 같은 날 함께 사라진다」
        try:
            os.remove(path)
        except OSError:
            pass


@app.get("/health")
def health() -> dict[str, Any]:
    """무엇이 붙어 있는지 한 줄로. **대역으로 돌고 있으면 그렇다고 말합니다.**"""
    return {
        "ok": True,
        "engine": cfg.engine,
        "device": cfg.device,
        "stt_model": cfg.stt_model,
        "compute_type": cfg.compute_type,
        "echo": cfg.is_echo,
        "authenticated": cfg.token is not None,
    }


@app.post("/jobs", status_code=202)
def submit(
    req: JobRequest,
    tasks: BackgroundTasks,
    x_finally_token: str | None = Header(default=None),
) -> dict[str, str]:
    """작업을 접수한다. **기다리지 않습니다** — 계약이 `202 처리 중` 입니다."""
    _guard(x_finally_token)
    if req.kind not in ("audio", "image"):
        raise HTTPException(status_code=400, detail="unsupported_kind")
    job = jobs.create(req.kind)
    tasks.add_task(_run, job.job_id, req)
    return {"job_id": job.job_id}


@app.get("/jobs/{job_id}")
def status(
    job_id: str, x_finally_token: str | None = Header(default=None)
) -> dict[str, Any]:
    """물어보면 알려준다. 끝났으면 읽은 것을 함께 낸다."""
    _guard(x_finally_token)
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="no_such_job")
    body: dict[str, Any] = {
        "job_id": job.job_id,
        "status": job.status,
        "percent": job.percent,
    }
    if job.status == "done":
        body["engine"] = job.engine
        body["lines"] = job.lines
    if job.status == "failed":
        body["reason"] = job.reason
    return body
