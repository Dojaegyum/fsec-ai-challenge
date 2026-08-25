"""음성을 글로 — faster-whisper.

근거: docs/research/09-로컬모델-PII인식-실측.md
      R-5 *"STT 는 medium 이상을 쓴다. base 는 리터럴 생존 5~10% 로 파이프라인이 무너진다"*

## 낱말 단위를 반드시 켭니다

`word_timestamps=True` 가 없으면 낱말마다 시각과 확률이 안 나옵니다.
그러면 **ADR-038 의 확인 화면이 줄 단위로만 열립니다** — 그 결정이 고칠 수 있는 것을
「명사와 숫자뿐」으로 정했으므로 그 단위가 필요합니다.

## 어휘 힌트

`initial_prompt` 로 나올 법한 낱말을 미리 알려 주면 모델이 그쪽으로 기웁니다.
실측 §5.6 이 **기관명 36건 중 10건이 전사에서 손상**되는 것을 확인했습니다
("신한은행"→"시나는행", "토스"→"포스").

⬜ **다만 어휘 목록을 넣어 본 적은 없습니다.** 실측이 시험한 것은 일반 지시문
한 줄이었고 효과가 없었습니다(§5.2). 어휘 목록은 성질이 다르지만 **검증 전입니다.**
"""

from __future__ import annotations

import os
from typing import Any

from .base import Progress


class FasterWhisperStt:
    def __init__(self, *, model: str, device: str, compute_type: str) -> None:
        from faster_whisper import WhisperModel

        self.name = f"faster-whisper {model} ({device}/{compute_type})"
        self._model = WhisperModel(model, device=device, compute_type=compute_type)
        # **속도로는 켤 이유가 없습니다** — 침묵 37% 짜리로 재도 0.4% 입니다
        # (docs/research/14-STT-전처리-실측.md §2). whisper 가 말 없는 창에서
        # 디코딩을 일찍 접어 **침묵은 VAD 없이도 이미 거의 공짜**입니다.
        #
        # 다만 **품질에서는 이득이 있었습니다** — 같은 측정에서 침묵 구간의 환각이
        # 줄어 `keep` 손상이 24 → 19 로 나아졌습니다. 켠다면 그 이유입니다.
        # 기본은 끔으로 둡니다 — 09 실측과 같은 조건에서 시작하려는 것입니다
        self._vad = os.environ.get("FINALLY_VAD", "0") == "1"

    def transcribe(
        self,
        path: str,
        *,
        vocabulary: list[str] | None = None,
        on_progress: Progress | None = None,
    ) -> dict[str, Any]:
        prompt = " ".join(vocabulary) if vocabulary else None
        segments, info = self._model.transcribe(
            path,
            language="ko",
            beam_size=5,
            word_timestamps=True,
            vad_filter=self._vad,
            initial_prompt=prompt,
        )

        total = getattr(info, "duration", 0) or 0
        lines: list[dict[str, Any]] = []

        for seg in segments:
            text = (seg.text or "").strip()
            if not text:
                continue
            line: dict[str, Any] = {
                "text": text,
                "startMs": int(seg.start * 1000),
                "endMs": int(seg.end * 1000),
            }
            # 세그먼트 평균 로그확률을 0~1 로 옮깁니다.
            # ⬜ **보정된 값이 아닙니다** — 「낮으면 의심스럽다」의 순서만 믿을 수 있습니다
            avg = getattr(seg, "avg_logprob", None)
            if avg is not None:
                line["confidence"] = max(0.0, min(1.0, 2.718281828**avg))

            pieces = []
            for w in getattr(seg, "words", None) or []:
                wt = (w.word or "").strip()
                if not wt:
                    continue
                pieces.append(
                    {
                        "text": wt,
                        "startMs": int(w.start * 1000),
                        "endMs": int(w.end * 1000),
                        "confidence": getattr(w, "probability", None),
                    }
                )
            if pieces:
                line["pieces"] = pieces

            lines.append(line)

            if on_progress and total:
                on_progress(int(min(99, seg.end / total * 100)))

        if on_progress:
            on_progress(100)

        # ⬜ **화자 분리가 안 붙어 있습니다.** 두 실측 어디에도 없어 후보가
        # 정해지지 않았습니다. 그래서 `speaker` 를 아예 안 채웁니다 —
        # 앱이 그 사실을 `no_speakers` 로 실어 냅니다
        return {"engine": self.name, "lines": lines}
