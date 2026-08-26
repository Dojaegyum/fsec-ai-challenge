"""무엇을 쓸지 고르는 자리 — **여기 한 곳만 보면 무엇이 붙어 있는지 압니다.**

앱 쪽 `src/lib/container.ts` 가 하는 일과 같습니다. 조립을 한 곳에 모으는 이유도
같습니다 — 흩어지면 **무엇이 안 붙었는지 한눈에 볼 자리가 사라집니다.**

## 무거운 것은 늦게 불러옵니다

`echo` 로 돌 때는 faster-whisper 도 EasyOCR 도 필요 없습니다. 맨 위에서 import 하면
설치 안 된 환경에서 서비스가 아예 안 뜹니다. **모델을 안 쓰는 개발 흐름을 막지 않으려고**
쓸 때 불러옵니다.
"""

from __future__ import annotations

from typing import Any, Callable

from ..config import Config
from .base import NerEngine, OcrEngine, SttEngine
from .echo import EchoNer, EchoOcr, EchoStt

# 「엔진을 내주는 것」. 앱이 한 번 만들고 계속 쥐고 있으므로 함수로 받습니다
Getter = Callable[[], Any]


def build_stt(cfg: Config) -> SttEngine:
    if cfg.is_echo:
        return EchoStt()
    from .faster_whisper_stt import FasterWhisperStt

    return FasterWhisperStt(
        model=cfg.stt_model, device=cfg.device, compute_type=cfg.compute_type
    )


def build_ocr(cfg: Config) -> OcrEngine:
    if cfg.is_echo:
        return EchoOcr()
    from .easyocr_reader import EasyOcrReader

    return EasyOcrReader(device=cfg.device)


def build_ner(cfg: Config) -> NerEngine:
    """이름을 찾는 엔진.

    **`FINALLY_ENGINE` 하나로 셋이 같이 갈립니다.** 전사만 진짜고 탐지는 대역인
    상태를 만들지 않으려는 것입니다 — 그러면 `engine` 칸만 보고는 무엇이 진짜인지
    알 수 없어집니다.
    """
    if cfg.is_echo:
        return EchoNer()
    from .ollama_ner import OllamaNer

    return OllamaNer(
        base_url=cfg.ollama_url,
        model=cfg.ner_model,
        keep_alive=cfg.ner_keep_alive,
    )


def warm_all(cfg: Config, *, stt: Getter, ocr: Getter, ner: Getter) -> None:
    """뜰 때 셋을 다 올린다 — **하나라도 빠지면 그것만 첫 사용자가 맞습니다.**

    ⛔ **이 함수가 `app.py` 가 아니라 여기 있는 이유**는 조립표와 같은 자리에
    둬야 **빠진 것이 보이기** 때문입니다. 실제로 한 번 빠졌습니다 — 이름 찾기는
    *"모델이 Ollama 안에 있으니 올릴 것이 없다"* 는 (틀린) 이유로 빠져 있었고,
    RTX 4090 에서 **첫 요청이 60초를 넘겨 통째로 실패**했습니다(2026-08-27).

    올릴 것이 없는 엔진은 스스로 아무것도 안 합니다 — 여기서 가리지 않습니다.
    """
    if not cfg.is_echo:
        # 이 둘은 우리 프로세스 안으로 들어옵니다. 만드는 것이 곧 올리는 것입니다
        stt()
        ocr()
    # 이쪽 모델은 Ollama 안에 있어 만드는 것으로는 안 올라옵니다 → `warm()`
    ner().warm()


__all__ = [
    "NerEngine",
    "OcrEngine",
    "SttEngine",
    "build_ner",
    "build_ocr",
    "build_stt",
    "warm_all",
]
