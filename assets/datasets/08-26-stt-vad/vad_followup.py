#!/usr/bin/env python3
"""1차 결과의 두 구멍을 메운다.

1차에서 vad=off 가 시간·품질 둘 다 재현되지 않았다(1353자 vs 1617자). 그런데
vad=on 은 한 번밖에 안 돌려서 **그쪽이 안정적인지 모른다.** 안정성을 비교하려면
양쪽 다 여러 번 돌려야 한다.

그리고 붕괴의 기계적 원인 후보 하나를 시험한다 — condition_on_previous_text.
기본값 True 라 앞 창의 결과가 뒤 창의 문맥으로 들어간다. 침묵 구간에서 한 번
무너지면 그 오염이 뒤로 번지는지, False 로 두면 멎는지 본다.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, "/home/kth9245/stt-vad-cpu")
from bench_stt import score

from faster_whisper import WhisperModel

W = Path("/home/kth9245/stt-vad-cpu")
EVAL = "/mnt/c/Users/TaeHyounKim/Documents/HACKERTON/finance2026/fsec-ai-challenge/assets/datasets/08-21-local-llm-pii/eval-set.json"
OUT = W / "results-vad-followup.json"
SECS = 645.7

# (표시, vad, condition_on_previous_text)
RUNS = (
    ("vad=on R2",              True,  True),
    ("vad=on R3",              True,  True),
    ("vad=off · 문맥이어받기 끔", False, False),
    ("vad=off R3",             False, True),
)


def main() -> int:
    items = json.loads(Path(EVAL).read_text(encoding="utf-8"))["items"]
    merged = {"pii": [p for i in items for p in i["pii"]],
              "keep": [k for i in items for k in i["keep"]]}

    model = WhisperModel("medium", device="cpu", compute_type="int8")
    wav = str(W / "audio-gap.wav")

    out = []
    for label, vad, cond_prev in RUNS:
        t = time.monotonic()
        segs, _ = model.transcribe(
            wav, language="ko", beam_size=5, word_timestamps=True,
            vad_filter=vad, condition_on_previous_text=cond_prev,
        )
        text = " ".join(s.text for s in segs)
        took = time.monotonic() - t
        s = score(merged, text)
        row = {"label": label, "vad": vad, "condition_on_previous_text": cond_prev,
               "wall_seconds": round(took, 1), "realtime_factor": round(took / SECS, 4),
               "chars": len(text), "pii_lost": len(s["pii_lost"]), "pii_total": s["pii_total"],
               "keep_lost": len(s["keep_lost"]), "keep_total": s["keep_total"],
               "pii_lost_list": s["pii_lost"]}
        out.append(row)
        print(f"{label:<26} {took:6.1f}초  글자 {row['chars']:5d}  "
              f"PII손상 {row['pii_lost']:2d}/33  keep손상 {row['keep_lost']:2d}/80", flush=True)
        OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
