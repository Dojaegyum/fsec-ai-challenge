#!/usr/bin/env python3
"""GPU 에서 「침묵이 만드는 반복 붕괴」가 재현되는지, 그리고 배치가 그걸 없애는지 잰다.

노트북(CPU·medium)에서 이런 것이 나왔다 — 침묵 37% 를 넣은 10.8분 녹음 하나에서
vad_filter=False 면 whisper 가 같은 문장을 17번 반복하며 6분치 발화를 통째로 먹고,
그 결과가 실행마다 달라진다(글자 944~2101). vad_filter=True 면 세 번이 동일하다.

여기서 답할 것 셋:
  ① 이게 GPU 에서도 일어나나 (하드웨어와 무관한 성질이어야 맞다)
  ② large-v3 에서도 일어나나 — ADR-052 가 채택한 모델이다
  ③ 배치를 켜면 저절로 없어지나 — 배치는 VAD 가 전제 조건이라 자동으로 켜진다

세그먼트 중복 수를 직접 세서 반복 루프를 눈으로 잡는다.
"""
from __future__ import annotations

import json, sys, time
from pathlib import Path

sys.path.insert(0, "/root")
from bench_stt import score

from faster_whisper import BatchedInferencePipeline, WhisperModel

OUT = Path("/root/results-gpu-vad.json")
AUDIO = {"gap": ("/root/audio-gap.wav", 645.7), "nogap": ("/root/audio-nogap.wav", 405.7)}

# (표시, 오디오, 모델, vad, batch)
RUNS = (
    ("M off #1",      "gap",   "medium",   False, 1),
    ("M off #2",      "gap",   "medium",   False, 1),
    ("M off #3",      "gap",   "medium",   False, 1),
    ("M on  #1",      "gap",   "medium",   True,  1),
    ("M on  #2",      "gap",   "medium",   True,  1),
    ("L off #1",      "gap",   "large-v3", False, 1),
    ("L off #2",      "gap",   "large-v3", False, 1),
    ("L off #3",      "gap",   "large-v3", False, 1),
    ("L on  #1",      "gap",   "large-v3", True,  1),
    ("L on  #2",      "gap",   "large-v3", True,  1),
    ("L batch16 #1",  "gap",   "large-v3", True,  16),
    ("L batch16 #2",  "gap",   "large-v3", True,  16),
    ("M off nogap",   "nogap", "medium",   False, 1),
    ("L off nogap",   "nogap", "large-v3", False, 1),
)


def main() -> int:
    items = json.loads(Path("/root/eval-set.json").read_text(encoding="utf-8"))["items"]
    merged = {"pii": [p for i in items for p in i["pii"]],
              "keep": [k for i in items for k in i["keep"]]}

    cache: dict[str, WhisperModel] = {}
    out = []
    for label, akey, model_name, vad, batch in RUNS:
        if model_name not in cache:
            t = time.monotonic()
            cache[model_name] = WhisperModel(model_name, device="cuda", compute_type="float16")
            print("  (%s 적재 %.1f초)" % (model_name, time.monotonic() - t), flush=True)
        base = cache[model_name]
        runner = BatchedInferencePipeline(model=base) if batch > 1 else base
        wav, secs = AUDIO[akey]

        kw = dict(language="ko", beam_size=5, vad_filter=vad, word_timestamps=True)
        t = time.monotonic()
        if batch > 1:
            segs, _ = runner.transcribe(wav, batch_size=batch, **kw)
        else:
            segs, _ = runner.transcribe(wav, **kw)
        rows = [s.text.strip() for s in segs]
        text = " ".join(rows)
        took = time.monotonic() - t

        s = score(merged, text)
        uniq = len(set(rows))
        dup = len(rows) - uniq
        row = {"label": label, "audio": akey, "model": model_name, "vad": vad, "batch": batch,
               "wall_seconds": round(took, 1), "realtime_factor": round(took / secs, 4),
               "chars": len(text), "n_segments": len(rows), "n_unique": uniq, "n_dup": dup,
               "pii_lost": len(s["pii_lost"]), "pii_total": s["pii_total"],
               "keep_lost": len(s["keep_lost"]), "keep_total": s["keep_total"],
               "pii_lost_list": s["pii_lost"]}
        out.append(row)
        print("%-14s %-6s %8.1f초 실시간%.4f배 글자%5d 세그%3d(중복%3d) PII손상%2d/33 keep손상%2d/80"
              % (label, akey, took, took / secs, len(text), len(rows), dup,
                 row["pii_lost"], row["keep_lost"]), flush=True)
        OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
