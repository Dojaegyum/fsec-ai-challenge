#!/usr/bin/env python3
"""같은 조건을 세 번씩 돌려 흔들림 폭을 본다.

`L1`(낱말시각 켬)이 `L2`(끔)보다 **빨랐던 것**이 측정 오차인지 실제인지 가르려는
것입니다. 배치 효과(6배)는 오차로 설명될 크기가 아니라 대상이 아닙니다.
"""
from __future__ import annotations

import json, time
from pathlib import Path
from faster_whisper import BatchedInferencePipeline, WhisperModel

WAV, AUDIO, N = "/poc/long.wav", 405.7, 3
CASES = (("L1 낱말시각 켬", 1, False, True),
         ("L2 낱말시각 끔", 1, False, False),
         ("L5 배치 16", 16, True, False))

base = WhisperModel("large-v3", device="cuda", compute_type="float16")
out = []
for label, batch, vad, word_ts in CASES:
    runner = BatchedInferencePipeline(model=base) if batch > 1 else base
    kw = dict(language="ko", beam_size=5, vad_filter=vad)
    took = []
    for _ in range(N):
        t0 = time.monotonic()
        if batch > 1:
            segs, _ = runner.transcribe(WAV, batch_size=batch, **kw)
        else:
            segs, _ = runner.transcribe(WAV, word_timestamps=word_ts, **kw)
        n = len(" ".join(s.text for s in segs))
        took.append(round(time.monotonic() - t0, 1))
    out.append({"label": label, "seconds": took, "chars": n})
    print(f"{label:<16} {took}  평균 {sum(took)/N:.1f}초  폭 {max(took)-min(took):.1f}초", flush=True)
Path("/poc/results-repeat.json").write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
