#!/usr/bin/env python3
"""증거 화면 OCR 의 속도와 값 보존을 잰다 — `bench_stt.py` 의 짝.

정본: docs/research/12-OCR-실측-방법론.md (같은 화면·같은 조건이어야 비교됩니다)
결과: docs/research/16-OCR-GPU-실측.md

## 무엇을 재나

[ADR-043](../../decisions/043-gpu-hosting.md) 이 GPU 를 쓰기로 하며 잡은 값은
**OCR 장당 87초**(CPU)였습니다. 전사는 [15](../../docs/research/15-STT-GPU-실측.md) 에서
GPU 로 22배가 나왔는데 **OCR 은 그 짝이 비어 있습니다.**

    C1  cpu   clean    기준선 — 11 의 조건
    G1  cuda  clean    C1 과 장치만 다름  <- 여기가 GPU 의 몫
    G2  cuda  lowres   열화가 속도에 영향을 주나
    G3  cuda  photo    가장 나쁜 조건

**엔진은 `EasyOcrReader` 를 그대로 씁니다.** 벤치용으로 따로 부르면 좌표 행 복원이
빠져 실제로 쓸 것과 다른 걸 재게 됩니다 → 11 R-2·R-3.

## 품질은 「값이 살아남았나」로 봅니다

`bench_stt.py` 와 같은 규칙입니다 — 평가셋의 `pii`·`keep` 값이 읽어낸 글에 남아
있는지 셉니다. 숫자는 자리표기가 달라질 수 있어 **숫자만 뽑아 비교**합니다.

⚠️ **11 의 절대값과 나란히 놓지 마세요.** 11 은 짝짓기·자형 혼동까지 따로 쟀고,
화면도 [make_screens.py](../../assets/datasets/08-21-local-ocr-pii/make_screens.py) 로
다시 그린 것입니다. **이 표 안에서 조건끼리** 비교하세요.

⚠️ **모듈로 부릅니다.** `engines` 가 `..config` 를 참조하는 패키지라 파일로 직접
실행하면 상대 임포트가 깨집니다 — 저장소 뿌리에서 부르세요.

    python -m services.transcriber.bench_ocr <screens폴더> <eval-set.json> <결과.json> [조건키]
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
from pathlib import Path

from .engines.easyocr_reader import EasyOcrReader

CONDITIONS = (
    {"key": "C1", "device": "cpu", "degrade": "clean", "ext": "png"},
    {"key": "G1", "device": "cuda", "degrade": "clean", "ext": "png"},
    {"key": "G2", "device": "cuda", "degrade": "lowres", "ext": "jpg"},
    {"key": "G3", "device": "cuda", "degrade": "photo", "ext": "jpg"},
)

NUMERIC_KINDS = {"계좌", "전화", "주민번호", "카드", "대표번호", "금액", "일시"}
DIGITS = re.compile(r"\d+")


def digits_of(s: str) -> str:
    return "".join(DIGITS.findall(s))


def survived(value: str, kind: str, text: str) -> bool:
    if kind in NUMERIC_KINDS:
        d = digits_of(value)
        return bool(d) and (d in digits_of(text) or value in text)
    return value in text


def have_cuda() -> bool:
    """⚠️ 드라이버가 아니라 **torch 가 CUDA 를 잡는지**를 봅니다 — EasyOCR 이 torch 를 씁니다."""
    try:
        import torch

        return bool(torch.cuda.is_available())
    except Exception:
        return False


def main() -> int:
    if len(sys.argv) not in (4, 5):
        sys.exit(__doc__)
    screens, eval_path, out_path = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    want = set(sys.argv[4].split(",")) if len(sys.argv) == 5 else None
    conditions = [c for c in CONDITIONS if want is None or c["key"] in want]
    if not conditions:
        sys.exit(f"그런 조건이 없습니다: {sys.argv[4]}")

    items = {i["id"]: i for i in json.loads(eval_path.read_text(encoding="utf-8"))["items"]}
    cuda = have_cuda()
    print(f"화면 {len(items)}장 · 코어 {os.cpu_count()} · CUDA {'있음' if cuda else '없음'}\n", flush=True)

    results = {"screens": len(items), "runs": []}
    readers: dict[str, EasyOcrReader] = {}

    for cond in conditions:
        head = f"── {cond['key']}  {cond['device']} · {cond['degrade']}"
        if cond["device"] == "cuda" and not cuda:
            print(f"{head}\n   CUDA 가 없어 건너뜁니다\n", flush=True)
            continue
        print(head, flush=True)

        if cond["device"] not in readers:
            t0 = time.monotonic()
            readers[cond["device"]] = EasyOcrReader(device=cond["device"])
            print(f"   모델 적재 {cond['device']} — {time.monotonic() - t0:.1f}초", flush=True)
        reader = readers[cond["device"]]

        run = {**cond, "items": [], "wall_seconds": 0.0,
               "pii_lost": 0, "keep_lost": 0, "pii_total": 0, "keep_total": 0}
        for i, (sid, spec) in enumerate(sorted(items.items()), 1):
            path = screens / cond["degrade"] / f"{sid}.{cond['ext']}"
            if not path.exists():
                sys.exit(f"화면이 없습니다: {path}\n먼저 make_screens.py 를 돌리세요.")
            start = time.monotonic()
            out = reader.read(str(path))
            took = time.monotonic() - start
            text = " ".join(line["text"] for line in out["lines"])

            lost_p = [f'{p["kind"]}:{p["text"]}' for p in spec["pii"]
                      if not survived(p["text"], p["kind"], text)]
            lost_k = [f'{k["kind"]}:{k["text"]}' for k in spec["keep"]
                      if not survived(k["text"], k["kind"], text)]
            run["wall_seconds"] += took
            run["pii_lost"] += len(lost_p)
            run["keep_lost"] += len(lost_k)
            run["pii_total"] += len(spec["pii"])
            run["keep_total"] += len(spec["keep"])
            run["items"].append({"id": sid, "seconds": round(took, 2), "text": text,
                                 "lines": len(out["lines"]),
                                 "pii_lost": lost_p, "keep_lost": lost_k})
            print(f"   {sid}  {took:6.1f}초  줄 {len(out['lines']):>2}", flush=True)

        n = len(run["items"])
        run["per_image"] = round(run["wall_seconds"] / n, 2) if n else 0.0
        run["wall_seconds"] = round(run["wall_seconds"], 1)
        results["runs"].append(run)
        print(f"   합계 {run['wall_seconds']}초 · 장당 {run['per_image']}초 · "
              f"PII 손상 {run['pii_lost']}/{run['pii_total']} · "
              f"keep 손상 {run['keep_lost']}/{run['keep_total']}\n", flush=True)
        out_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")

    if not results["runs"]:
        print("돌린 조건이 없습니다.")
        return 1

    print("조건 | 장치 | 열화   | 장당 | PII손상 | keep손상")
    for r in results["runs"]:
        print(f"  {r['key']} | {r['device']:<4} | {r['degrade']:<6} | {r['per_image']:>6.2f}초 | "
              f"{r['pii_lost']:>2}/{r['pii_total']} | {r['keep_lost']:>2}/{r['keep_total']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
