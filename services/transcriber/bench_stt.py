#!/usr/bin/env python3
"""전사 설정을 바꿔 가며 속도와 전사 품질을 잰다.

정본: docs/research/10-PII인식-실측-방법론.md (같은 음성·같은 조건이어야 비교됩니다)

## 무엇을 재나

**「청크로 쪼개 배치로 돌린다」는 CPU 에서 이득이 없습니다** — 코어가 2개뿐이고
whisper 는 이미 30초 창으로 순차 처리합니다. 그래서 쪼개는 대신 **버리는** 쪽
(무음 건너뛰기)과 **덜 뒤지는** 쪽(빔 폭)을 잽니다.

    A  vad=off beam=5   지난 실측과 같은 조건 — 비교 기준점
    B  vad=on  beam=5   무음을 건너뛰면 얼마나 빨라지나
    C  vad=off beam=1   탐색을 줄이면 얼마나 빨라지나
    D  vad=on  beam=1   둘을 겹치면

**모델은 한 번만 올립니다.** `vad_filter`·`beam_size` 는 호출 인자라 모델을 다시
만들 필요가 없고, 다시 만들면 적재 시간이 조건마다 섞여 들어갑니다.

## 품질은 「값이 살아남았나」로 봅니다

탐지기 성능이 아니라 **STT 책임**만 봅니다 → 방법론의 「전사손상」. 평가셋의
`pii`·`keep` 값이 전사문에 남아 있는지 셉니다. 숫자는 whisper 가 자리표기를
바꾸므로(하이픈·공백·`010`↔`공일공`) **숫자만 뽑아 비교**합니다.

    python bench_stt.py <audio폴더> <eval-set.json> <결과.json> [조건키]

조건키를 주면 그것만 돕니다 — `A,B` 처럼 쉼표로. 무음을 넣은 음성에서 VAD 만
확인할 때처럼, 물음과 무관한 조건에 시간을 쓰지 않으려는 것입니다.
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
from pathlib import Path

from faster_whisper import WhisperModel

CONDITIONS = (
    {"key": "A", "vad": False, "beam": 5},
    {"key": "B", "vad": True, "beam": 5},
    {"key": "C", "vad": False, "beam": 1},
    {"key": "D", "vad": True, "beam": 1},
)

# 숫자로 이루어진 값은 자리표기가 달라져도 같은 값으로 봅니다
NUMERIC_KINDS = {"계좌", "전화", "주민번호", "카드", "대표번호"}

DIGITS = re.compile(r"\d+")


def digits_of(s: str) -> str:
    return "".join(DIGITS.findall(s))


def survived(value: str, kind: str, text: str) -> bool:
    """이 값이 전사문에 남아 있나."""
    if kind in NUMERIC_KINDS:
        d = digits_of(value)
        # 숫자가 짧으면(112·114) 우연히 맞을 수 있어 그대로도 한 번 봅니다
        return bool(d) and (d in digits_of(text) or value in text)
    return value in text


def score(item: dict, text: str) -> dict:
    out = {"pii_total": len(item["pii"]), "keep_total": len(item["keep"]),
           "pii_lost": [], "keep_lost": []}
    for p in item["pii"]:
        if not survived(p["text"], p["kind"], text):
            out["pii_lost"].append(f'{p["kind"]}:{p["text"]}')
    for k in item["keep"]:
        if not survived(k["text"], k["kind"], text):
            out["keep_lost"].append(f'{k["kind"]}:{k["text"]}')
    return out


def main() -> int:
    if len(sys.argv) not in (4, 5):
        sys.exit(__doc__)
    audio_dir, eval_path, out_path = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    want = set(sys.argv[4].split(",")) if len(sys.argv) == 5 else None
    conditions = [c for c in CONDITIONS if want is None or c["key"] in want]
    if not conditions:
        sys.exit(f"그런 조건이 없습니다: {sys.argv[4]}")

    manifest = json.loads((audio_dir / "manifest.json").read_text(encoding="utf-8"))
    items = {i["id"]: i for i in json.loads(eval_path.read_text(encoding="utf-8"))["items"]}

    model_name = os.environ.get("FINALLY_STT", "medium")
    compute = os.environ.get("FINALLY_COMPUTE", "int8")
    print(f"모델 {model_name} · {compute} · 코어 {os.cpu_count()}", flush=True)

    t0 = time.monotonic()
    model = WhisperModel(model_name, device="cpu", compute_type=compute)
    print(f"모델 적재 {time.monotonic() - t0:.1f}초\n", flush=True)

    results = {"model": model_name, "compute": compute,
               "audio_seconds": manifest["total_seconds"],
               "condition": manifest["condition"],
               "silence_ratio": manifest.get("silence_ratio", 0.0), "runs": []}

    for cond in conditions:
        print(f"── {cond['key']}  vad={'on ' if cond['vad'] else 'off'} beam={cond['beam']}", flush=True)
        run = {**cond, "items": [], "wall_seconds": 0.0,
               "pii_lost": 0, "keep_lost": 0, "pii_total": 0, "keep_total": 0}
        for m in manifest["items"]:
            wav = audio_dir / m["file"]
            start = time.monotonic()
            segments, _ = model.transcribe(
                str(wav), language="ko", beam_size=cond["beam"],
                word_timestamps=True, vad_filter=cond["vad"],
            )
            text = " ".join(s.text for s in segments)   # 여기서 실제로 계산됩니다
            took = time.monotonic() - start

            s = score(items[m["id"]], text)
            run["wall_seconds"] += took
            run["pii_lost"] += len(s["pii_lost"])
            run["keep_lost"] += len(s["keep_lost"])
            run["pii_total"] += s["pii_total"]
            run["keep_total"] += s["keep_total"]
            run["items"].append({"id": m["id"], "seconds": round(took, 2),
                                 "audio_seconds": m["seconds"], "text": text.strip(),
                                 "pii_lost": s["pii_lost"], "keep_lost": s["keep_lost"]})
            print(f"   {m['id']}  {took:6.1f}초  ({took / m['seconds']:.2f}배)", flush=True)

        run["realtime_factor"] = round(run["wall_seconds"] / manifest["total_seconds"], 3)
        run["wall_seconds"] = round(run["wall_seconds"], 1)
        results["runs"].append(run)
        print(f"   합계 {run['wall_seconds']}초 · 실시간 {run['realtime_factor']}배 · "
              f"PII 손상 {run['pii_lost']}/{run['pii_total']} · "
              f"keep 손상 {run['keep_lost']}/{run['keep_total']}\n", flush=True)
        out_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")

    print("조건 | 실시간배수 | PII손상 | keep손상")
    for r in results["runs"]:
        print(f"  {r['key']}  |  {r['realtime_factor']:.2f}배  | "
              f"{r['pii_lost']}/{r['pii_total']} | {r['keep_lost']}/{r['keep_total']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
