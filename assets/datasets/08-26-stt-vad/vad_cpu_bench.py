#!/usr/bin/env python3
"""CPU·medium 에서 무음 건너뛰기(VAD)가 실제 통화 길이에서 얼마를 버는지 잰다.

지금까지 CPU 측정(docs/research/14)은 전부 10초짜리 40개였다 — whisper 30초 창
하나 안이라 창을 넘겨 다니는 실제 통화의 모양이 아니었다. 여기서는 이어붙인
긴 녹음 하나로 잰다.

**VAD 만 다르다.** 배치는 둘 다 1, 낱말 시각은 둘 다 True — 서비스가 실제로 쓰는
조건(engines/faster_whisper_stt.py)에서 vad_filter 만 뒤집는다. 기존 long_bench.py
의 L2·L3 은 낱말 시각을 끈 채로 VAD 를 갈라 서비스 조건이 아니다.

⚠️ 이 기계는 6코어 x86 노트북이고 운영 서버는 ARM 2코어다. **절대 초를 14 §1 표와
나란히 놓지 마라.** 옮길 수 있는 것은 vad on/off 의 비(比) 하나뿐이다.

⚠️ 같은 조건을 앞뒤로 두 번 돌린다(R1·R2). 도는 컨테이너와의 경합·열 클럭 저하가
있으면 그 두 값이 벌어져 드러난다.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, "/home/kth9245/stt-vad-cpu")
from bench_stt import score  # 14·15 와 같은 채점 규칙

from faster_whisper import WhisperModel

W = Path("/home/kth9245/stt-vad-cpu")
EVAL = "/mnt/c/Users/TaeHyounKim/Documents/HACKERTON/finance2026/fsec-ai-challenge/assets/datasets/08-21-local-llm-pii/eval-set.json"
OUT = W / "results-vad-cpu.json"

# (오디오, 초, vad, 되풀이표시)  — 판단에 중요한 침묵 조건을 먼저 돌린다
RUNS = (
    ("audio-gap",   645.7, False, "R1"),
    ("audio-gap",   645.7, True,  "R1"),
    ("audio-gap",   645.7, False, "R2"),
    ("audio-nogap", 405.7, False, "R1"),
    ("audio-nogap", 405.7, True,  "R1"),
)


def main() -> int:
    items = json.loads(Path(EVAL).read_text(encoding="utf-8"))["items"]
    merged = {"pii": [p for i in items for p in i["pii"]],
              "keep": [k for i in items for k in i["keep"]]}

    t0 = time.monotonic()
    model = WhisperModel("medium", device="cpu", compute_type="int8")
    print(f"모델 적재 {time.monotonic() - t0:.1f}초", flush=True)

    out = []
    for audio, secs, vad, rep in RUNS:
        wav = str(W / f"{audio}.wav")
        t = time.monotonic()
        segs, _ = model.transcribe(
            wav, language="ko", beam_size=5, word_timestamps=True, vad_filter=vad
        )
        text = " ".join(s.text for s in segs)
        took = time.monotonic() - t

        s = score(merged, text)
        row = {
            "audio": audio, "audio_seconds": secs, "vad": vad, "repeat": rep,
            "wall_seconds": round(took, 1),
            "realtime_factor": round(took / secs, 4),
            "chars": len(text),
            "pii_lost": len(s["pii_lost"]), "pii_total": s["pii_total"],
            "keep_lost": len(s["keep_lost"]), "keep_total": s["keep_total"],
            "pii_lost_list": s["pii_lost"],
        }
        out.append(row)
        print(f"{audio:<12} vad={str(vad):<5} {rep}  {took:6.1f}초  "
              f"실시간 {took/secs:.3f}배  PII 손상 {row['pii_lost']}/{row['pii_total']}  "
              f"keep 손상 {row['keep_lost']}/{row['keep_total']}", flush=True)
        # 중간에 끊겨도 여기까지는 남는다
        OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

    return 0


if __name__ == "__main__":
    sys.exit(main())
