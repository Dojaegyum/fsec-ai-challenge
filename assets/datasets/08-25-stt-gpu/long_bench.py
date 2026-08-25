#!/usr/bin/env python3
"""긴 녹음 하나에서 배치가 실제로 얼마를 버는지 잰다.

⚠️ **왜 따로 재나.** 평가셋은 10초짜리 40개라 파일 하나가 whisper 창(30초)도 못
채웁니다. faster-whisper 의 배치 파이프라인은 그럴 때 **덩어리 하나로 처리**하고
끝냅니다(transcribe.py: "run the audio if it is less than 30 sec even without
clip_timestamps"). 즉 `batch_size=16` 을 줘도 배치가 아닙니다. 실제 통화는 긴 녹음
하나라 창이 수십 개 나오고, 거기서야 배치가 실력을 냅니다.

⚠️ **배치에는 VAD 가 필수입니다.** 무엇을 묶을지 정하는 게 VAD 라, `vad_filter=False`
로 긴 파일을 주면 파이프라인이 RuntimeError 로 거절합니다. 「배치는 켜고 VAD 는 끈다」
는 선택지가 아예 없습니다.

40개를 이어붙인 6.8분짜리 하나로 잽니다. 채점은 이어붙인 전사문 전체에 평가셋 값이
남아 있는지로 봅니다 — 조건 간 비교용입니다(발화별 채점보다 후하니 §14 표와 나란히
놓지 마세요).
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

from faster_whisper import BatchedInferencePipeline, WhisperModel

sys.path.insert(0, "/poc")
from bench_stt import score  # 같은 채점 규칙을 씁니다

WAV = "/poc/long.wav"
AUDIO = 405.7

# (이름, 배치, vad, 낱말시각)
CASES = (
    ("L1 기준 = 지금 서비스가 하는 것", 1, False, True),
    ("L2 낱말시각만 끔", 1, False, False),
    ("L3 VAD 켬", 1, True, False),
    ("L4 배치 8", 8, True, False),
    ("L5 배치 16", 16, True, False),
    ("L6 배치 32", 32, True, False),
)


def main() -> int:
    items = json.loads(Path("/poc/eval-set.json").read_text(encoding="utf-8"))["items"]
    merged = {"pii": [p for i in items for p in i["pii"]],
              "keep": [k for i in items for k in i["keep"]]}

    out = []
    for model_name in ("large-v3", "large-v3-turbo"):
        base = WhisperModel(model_name, device="cuda", compute_type="float16")
        for label, batch, vad, word_ts in CASES:
            runner = BatchedInferencePipeline(model=base) if batch > 1 else base
            kw = dict(language="ko", beam_size=5, vad_filter=vad)
            t0 = time.monotonic()
            if batch > 1:
                segs, _ = runner.transcribe(WAV, batch_size=batch, **kw)
            else:
                segs, _ = runner.transcribe(WAV, word_timestamps=word_ts, **kw)
            text = " ".join(s.text for s in segs)
            took = time.monotonic() - t0

            s = score(merged, text)
            row = {"model": model_name, "label": label, "batch": batch, "vad": vad,
                   "word_timestamps": word_ts, "wall_seconds": round(took, 1),
                   "realtime_factor": round(took / AUDIO, 4), "chars": len(text),
                   "pii_lost": len(s["pii_lost"]), "pii_total": s["pii_total"],
                   "keep_lost": len(s["keep_lost"]), "keep_total": s["keep_total"]}
            out.append(row)
            print(f"{model_name:<15} {label:<28} {took:6.1f}초  실시간 {took / AUDIO:.4f}배  "
                  f"PII {row['pii_lost']:>2}/{row['pii_total']}  keep {row['keep_lost']:>2}/{row['keep_total']}",
                  flush=True)
            Path("/poc/results-long.json").write_text(
                json.dumps({"audio_seconds": AUDIO, "runs": out}, ensure_ascii=False, indent=2),
                encoding="utf-8")
        del base
    return 0


if __name__ == "__main__":
    sys.exit(main())
