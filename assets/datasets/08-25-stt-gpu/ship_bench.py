#!/usr/bin/env python3
"""실제로 붙일 조합을 잰다 — 배치에 낱말 시각을 얹으면 얼마인가.

배치 파이프라인도 `word_timestamps` 를 받습니다(기본값은 끔). 모듈 계약의 `pieces`
가 낱말 시각을 요구하므로, **켠 채로도 배치 이득이 남는지**가 실제 물음입니다.
"""
from __future__ import annotations

import json, sys, time
from pathlib import Path
from faster_whisper import BatchedInferencePipeline, WhisperModel

sys.path.insert(0, "/poc")
from bench_stt import score

WAV, AUDIO, N = "/poc/long.wav", 405.7, 3
items = json.loads(Path("/poc/eval-set.json").read_text(encoding="utf-8"))["items"]
merged = {"pii": [p for i in items for p in i["pii"]],
          "keep": [k for i in items for k in i["keep"]]}

base = WhisperModel("large-v3", device="cuda", compute_type="float16")
pipe = BatchedInferencePipeline(model=base)
out = []
for label, word_ts in (("배치16 · 낱말시각 끔", False), ("배치16 · 낱말시각 켬", True)):
    took, text = [], ""
    for _ in range(N):
        t0 = time.monotonic()
        segs, _ = pipe.transcribe(WAV, batch_size=16, language="ko", beam_size=5,
                                  vad_filter=True, word_timestamps=word_ts)
        text = " ".join(s.text for s in segs)
        took.append(round(time.monotonic() - t0, 1))
    s = score(merged, text)
    out.append({"label": label, "word_timestamps": word_ts, "seconds": took,
                "mean": round(sum(took) / N, 1), "chars": len(text),
                "pii_lost": len(s["pii_lost"]), "keep_lost": len(s["keep_lost"])})
    print(f"{label:<22} {took}  평균 {sum(took)/N:5.1f}초  "
          f"PII {len(s['pii_lost']):>2}/33  keep {len(s['keep_lost']):>2}/80  글자 {len(text)}", flush=True)
Path("/poc/results-ship.json").write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
