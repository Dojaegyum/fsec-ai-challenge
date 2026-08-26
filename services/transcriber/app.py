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
from .engines import build_ner, build_ocr, build_stt, warm_all
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
_ner = None

# 미리 올리기가 끝났나. 배포에서 「받을 준비가 됐나」를 이걸로 봅니다
_ready = False


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


def ner():
    """이름을 찾는 엔진.

    여기서 만드는 것은 주소를 든 객체뿐입니다 — 모델은 이 프로세스가 아니라
    Ollama 안에 있습니다.

    ⚠️ **그렇다고 미리 올릴 것이 없는 게 아닙니다.** 한때 이 자리에 *"올릴 것이
    없다"* 라고 적혀 있었는데, **모델을 GPU 로 올리는 일은 Ollama 쪽에서 여전히
    일어납니다.** 처음 한 번이 60초를 넘겨 첫 요청이 통째로 타임아웃하는 것을
    2026-08-27 RTX 4090 에서 실제로 봤습니다 → `_warm` · `OllamaNer.warm`.
    """
    global _ner
    with _lock:
        if _ner is None:
            _ner = build_ner(cfg)
        return _ner


def _warm() -> None:
    """모델을 미리 올려 둡니다.

    **첫 사용자가 첫 적재를 안 맞게 하려는 것입니다** → `FINALLY_WARMUP`.
    게으르게 올려도 결과는 같지만, 기다리는 사람이 달라집니다.

    ⛔ **이름 찾기는 「같다」가 아닙니다.** 2026-08-27 RTX 4090 에서 처음 한 번이
    60초를 넘겨 **첫 요청이 통째로 실패**했습니다(두 번째부터 5.5초 · 따뜻하면
    0.3초). 이름 찾기가 죽으면 앱은 슬롯 저장을 503 으로 막습니다 — 경계라서
    못 가리면 안 내보냅니다. 그러니 여기서 미리 올리는 것이 **가장 중요한 하나**입니다.
    """
    global _ready
    try:
        # 무엇을 올릴지는 조립표 옆에 있습니다 — 빠진 것이 거기서 보이도록
        warm_all(cfg, stt=stt, ocr=ocr, ner=ner)
        _ready = True
        log.info("모델 적재 완료")
    except Exception:
        # ⚠️ **여기서 죽이지 않습니다.** 미리 올리기가 실패해도 요청이 오면
        # 다시 시도합니다. 시작을 못 하게 만들 이유가 없습니다
        log.exception("미리 올리기 실패 — 요청이 오면 다시 시도합니다")


@app.on_event("startup")
def _on_startup() -> None:
    if os.environ.get("FINALLY_WARMUP") == "1":
        threading.Thread(target=_warm, name="warmup", daemon=True).start()
    else:
        global _ready
        _ready = True


class JobRequest(BaseModel):
    """앱이 보내는 것. **파일이 아니라 파일을 가리키는 주소입니다.**"""

    kind: str  # audio | image
    url: str
    mime_type: str | None = None
    # 나올 법한 낱말 — 기관명 사전 등. ⬜ 효과가 아직 검증되지 않았습니다
    # → docs/research/09 §5.6 (기관명 36건 중 10건이 전사에서 손상)
    vocabulary: list[str] | None = None
    # 앱이 번호를 정할 수 있습니다. 넘기면 그 번호로 열고, 같은 번호로 다시
    # 오면 앞의 작업을 그대로 돌려줍니다 — 앱이 번호를 저장하지 않아도 됩니다
    job_id: str | None = None


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
        "ner_model": cfg.ner_model,
        "echo": cfg.is_echo,
        "authenticated": cfg.token is not None,
        # 미리 올리기를 켰으면 끝나야 True. 배포 상태검사가 이걸 기다립니다
        "ready": _ready,
    }


class NerRequest(BaseModel):
    """앱이 보내는 것 — **글 자체입니다.** 파일이 아니라서 주소가 아닙니다."""

    text: str
    # 앱이 어느 모델을 쓰라고 말할 수 있습니다. 안 오면 서비스 기본값입니다.
    # ⬜ **아직 여기서 갈아끼우지 않습니다** — 요청마다 모델을 바꾸면 같은 사건이
    #    두 모델을 지나 가린 자리가 달라집니다. 받아만 두고 `/health` 로 답합니다
    model: str | None = None


@app.post("/ner")
def ner_find(
    req: NerRequest, x_finally_token: str | None = Header(default=None)
) -> dict[str, Any]:
    """글에서 사람 이름을 찾는다. **여기는 기다립니다** — 전사와 다릅니다.

    정본: spec/common/08-14-api.md §1.2 의 `/ner` · src/lib/ner.ts

    발화 한 토막이라 GPU 에서 1초 안팎입니다. 전사처럼 맡기고 물어볼 이유가 없습니다.
    **CPU 에서는 15~39초**라(09 §6.2) 그쪽으로는 이 경로를 쓰지 마세요.

    ## 못 하면 500 입니다 — 빈 목록이 아닙니다

    앱이 빈 목록을 받으면 **「이름은 없었다」로 읽습니다.** 모델이 안 돌아서 못 찾은
    것과 정말 없는 것은 다른 일이고, 둘을 같게 만들면 **토큰화 없이 LLM 을 부르는
    우회 경로**가 생깁니다 → CLAUDE.md 불변 규칙 2.

    ⚠️ **오류 본문에 원문을 담지 않습니다.** 이 자리로 진술이 그대로 지나갑니다.
    """
    _guard(x_finally_token)
    try:
        return ner().find(req.text)
    except Exception as error:  # noqa: BLE001 — 이유만 남기고 본문은 안 담습니다
        log.warning("이름 찾기 실패: %s", type(error).__name__)
        raise HTTPException(status_code=500, detail=_reason(error)) from None


# 밖으로 내보내도 되는 이유들. **여기 없는 것은 통째로 가립니다** —
# 예외 메시지에 원문 조각이 섞여 나가는 경로를 남기지 않습니다
_REASONS = frozenset(
    {
        "ner_unreachable",
        "ner_no_response",
        "ner_bad_json",
        "ner_bad_shape",
    }
)


def _reason(error: Exception) -> str:
    text = str(error)
    if text in _REASONS:
        return text
    # `ner_http_503` 처럼 뒤가 숫자일 때만. 「로 시작한다」로 두면 뒤에 무엇이든
    # 붙여 내보낼 수 있는 자리가 됩니다
    head, _, tail = text.partition("ner_http_")
    if head == "" and tail.isdigit():
        return text
    return "ner_failed"


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
    job, opened = jobs.create(req.kind, req.job_id)
    # ⚠️ **이미 돌고 있으면 다시 걸지 않습니다.** 접수는 멱등이어야 합니다 → ADR-051.
    # 앱이 같은 증거 번호로 다시 부르는 경로가 열려 있고(§3.2 3단계), 여기서
    # 무조건 걸면 같은 파일을 두 번 내려받아 모델을 두 번 돌립니다. 진행률도
    # 서로 덮어씁니다. 「열렸는가」는 `JobStore` 가 잠금 안에서 답합니다
    if opened:
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
