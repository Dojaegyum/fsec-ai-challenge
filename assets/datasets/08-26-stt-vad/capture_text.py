#!/usr/bin/env python3
"""전사문 원문을 저장해 「어떻게 무너지는가」를 눈으로 본다.

앞선 두 실행은 점수만 남기고 글을 안 남겨서, 글자 수가 왜 줄었는지 —
말을 통째로 놓친 것인지, 반복에 빠진 것인지, 엉뚱한 말을 지어낸 것인지 —
확인할 수 없었다. 세그먼트 단위로 시각까지 남긴다.
"""
from __future__ import annotations

import json, sys, time
from pathlib import Path
from faster_whisper import WhisperModel

W = Path("/home/kth9245/stt-vad-cpu")
model = WhisperModel("medium", device="cpu", compute_type="int8")

out = {}
for label, vad in (("vad_off", False), ("vad_on", True)):
    t = time.monotonic()
    segs, info = model.transcribe(str(W / "audio-gap.wav"), language="ko",
                                  beam_size=5, word_timestamps=True, vad_filter=vad)
    rows = [{"start": round(s.start, 1), "end": round(s.end, 1),
             "text": s.text.strip(),
             "avg_logprob": round(getattr(s, "avg_logprob", 0), 3),
             "no_speech_prob": round(getattr(s, "no_speech_prob", 0), 3),
             "compression_ratio": round(getattr(s, "compression_ratio", 0), 2)}
            for s in segs]
    out[label] = {"wall": round(time.monotonic() - t, 1), "segments": rows,
                  "chars": sum(len(r["text"]) for r in rows), "n_segments": len(rows)}
    print(f"{label}  {out[label]['wall']}초  세그먼트 {len(rows)}개  글자 {out[label]['chars']}", flush=True)

(W / "transcripts-vad.json").write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
