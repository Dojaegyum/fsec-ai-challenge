"""무엇을 쓸지 고르는 자리 — **여기 한 곳만 보면 무엇이 붙어 있는지 압니다.**

앱 쪽 `src/lib/container.ts` 가 하는 일과 같습니다. 조립을 한 곳에 모으는 이유도
같습니다 — 흩어지면 **무엇이 안 붙었는지 한눈에 볼 자리가 사라집니다.**

## 무거운 것은 늦게 불러옵니다

`echo` 로 돌 때는 faster-whisper 도 EasyOCR 도 필요 없습니다. 맨 위에서 import 하면
설치 안 된 환경에서 서비스가 아예 안 뜹니다. **모델을 안 쓰는 개발 흐름을 막지 않으려고**
쓸 때 불러옵니다.
"""

from __future__ import annotations

from ..config import Config
from .base import OcrEngine, SttEngine
from .echo import EchoOcr, EchoStt


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


__all__ = ["OcrEngine", "SttEngine", "build_ocr", "build_stt"]
