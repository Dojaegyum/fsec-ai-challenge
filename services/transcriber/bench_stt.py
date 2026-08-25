#!/usr/bin/env python3
"""전사 설정을 바꿔 가며 속도와 전사 품질을 잰다.

정본: docs/research/10-PII인식-실측-방법론.md (같은 음성·같은 조건이어야 비교됩니다)
결과: docs/research/14-STT-전처리-실측.md

## 무엇을 재나

**CPU 와 GPU 에서 답이 갈립니다.**

CPU 에서는 「청크로 쪼개 배치로 돌린다」가 이득이 없습니다 — 코어가 2개뿐이고
whisper 는 이미 30초 창으로 순차 처리합니다. 그래서 CPU 조건은 **버리는** 쪽
(무음 건너뛰기)과 **덜 뒤지는** 쪽(빔 폭)만 봅니다.

GPU 에서는 뒤집힙니다. 유휴 연산 유닛이 남아 있어 청크를 한꺼번에 밀어 넣으면
처리량이 오르고, `BatchedInferencePipeline` 이 그 일을 대신 해 줍니다 — **우리가
직접 쪼개고 합칠 필요가 없습니다.** 경계에서 문맥·단어·화자가 깨지는 문제도
라이브러리 쪽에서 다룹니다.

    A  cpu  medium          beam=5 vad=off  batch=1    지난 실측과 같은 조건 — 기준점
    B  cpu  medium          beam=5 vad=on   batch=1
    C  cpu  medium          beam=1 vad=off  batch=1
    D  cpu  medium          beam=1 vad=on   batch=1
    E  gpu  medium          beam=5 vad=off  batch=1    A 와 같은 것을 GPU 에서
    F  gpu  medium          beam=5 vad=off  batch=16   배치 효과만 분리
    G  gpu  large-v3-turbo  beam=5 vad=off  batch=16   1순위 후보
    H  gpu  large-v3        beam=5 vad=off  batch=16   정확도 상한

**모델은 (이름·장치·정밀도)마다 한 번만 올립니다.** 조건마다 다시 만들면 적재
시간이 측정에 섞여 들어갑니다.

## 품질은 「값이 살아남았나」로 봅니다

탐지기 성능이 아니라 **STT 책임**만 봅니다 → 방법론의 「전사손상」. 평가셋의
`pii`·`keep` 값이 전사문에 남아 있는지 셉니다. 숫자는 whisper 가 자리표기를
바꾸므로(하이픈·공백) **숫자만 뽑아 비교**합니다.

⚠️ **평균 WER 이 좋아도 우리 지표는 나빠질 수 있습니다.** `large-v3-turbo` 는
디코더를 32층에서 4층으로 줄인 모델이라, 계좌번호처럼 긴 숫자열에서 문맥 유지가
약할 수 있습니다. 벤치마크 숫자가 아니라 **이 채점으로** 골라야 하는 이유입니다.

    python bench_stt.py <audio폴더> <eval-set.json> <결과.json> [조건키]

조건키를 주면 그것만 돕니다 — `A,B` 처럼 쉼표로. 무음을 넣은 음성에서 VAD 만
확인할 때처럼, 물음과 무관한 조건에 시간을 쓰지 않으려는 것입니다.
GPU 가 없는 곳에서 `E`~`H` 를 부르면 **돌리지 않고 건너뜁니다** — 같은 명령을
어디서든 부를 수 있게 하려는 것입니다.
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
from pathlib import Path

from faster_whisper import WhisperModel

try:  # faster-whisper >= 1.1
    from faster_whisper import BatchedInferencePipeline
except ImportError:  # pragma: no cover - 구 버전
    BatchedInferencePipeline = None

CPU_MODEL = os.environ.get("FINALLY_STT", "medium")
CPU_COMPUTE = os.environ.get("FINALLY_COMPUTE", "int8")

# GPU 는 float16 이 기본입니다 — int8 은 CPU 에서 메모리를 아끼려던 선택이라
# 연산이 남아도는 GPU 에서 굳이 정확도를 깎을 이유가 없습니다.
GPU_COMPUTE = os.environ.get("FINALLY_GPU_COMPUTE", "float16")

CONDITIONS = (
    {"key": "A", "device": "cpu", "model": CPU_MODEL, "compute": CPU_COMPUTE,
     "vad": False, "beam": 5, "batch": 1},
    {"key": "B", "device": "cpu", "model": CPU_MODEL, "compute": CPU_COMPUTE,
     "vad": True, "beam": 5, "batch": 1},
    {"key": "C", "device": "cpu", "model": CPU_MODEL, "compute": CPU_COMPUTE,
     "vad": False, "beam": 1, "batch": 1},
    {"key": "D", "device": "cpu", "model": CPU_MODEL, "compute": CPU_COMPUTE,
     "vad": True, "beam": 1, "batch": 1},
    {"key": "E", "device": "cuda", "model": CPU_MODEL, "compute": GPU_COMPUTE,
     "vad": False, "beam": 5, "batch": 1},
    {"key": "F", "device": "cuda", "model": CPU_MODEL, "compute": GPU_COMPUTE,
     "vad": False, "beam": 5, "batch": 16},
    {"key": "G", "device": "cuda", "model": "large-v3-turbo", "compute": GPU_COMPUTE,
     "vad": False, "beam": 5, "batch": 16},
    {"key": "H", "device": "cuda", "model": "large-v3", "compute": GPU_COMPUTE,
     "vad": False, "beam": 5, "batch": 16},
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


def have_cuda() -> bool:
    """GPU 가 실제로 쓸 수 있는 상태인가.

    ⚠️ **드라이버만 보고 판단하지 않습니다.** `nvidia-smi` 가 있어도 CTranslate2
    가 CUDA 를 못 잡는 경우가 있어(라이브러리 없음·버전 불일치) 그때 조건마다
    같은 예외로 죽습니다. 여기서 한 번 확인하고 없으면 **건너뜁니다.**
    """
    try:
        import ctranslate2

        return ctranslate2.get_cuda_device_count() > 0
    except Exception:
        return False


class Models:
    """(이름·장치·정밀도)마다 한 번만 올린다."""

    def __init__(self) -> None:
        self._cache: dict[tuple[str, str, str], object] = {}

    def get(self, model: str, device: str, compute: str, batch: int):
        key = (model, device, compute)
        if key not in self._cache:
            t0 = time.monotonic()
            m = WhisperModel(model, device=device, compute_type=compute)
            print(f"   모델 적재 {model}/{device}/{compute} — {time.monotonic() - t0:.1f}초",
                  flush=True)
            self._cache[key] = m
        base = self._cache[key]
        if batch > 1:
            if BatchedInferencePipeline is None:
                raise RuntimeError("배치에는 faster-whisper>=1.1 이 필요합니다")
            # 파이프라인은 감싸기만 하는 것이라 모델을 다시 올리지 않습니다
            return BatchedInferencePipeline(model=base)
        return base


def transcribe(runner, wav: str, cond: dict) -> str:
    # ⚠️ `vad_filter` 를 **항상 명시**합니다. 배치 파이프라인은 기본값이 켬이라,
    #    빼면 F·G·H 만 몰래 VAD 가 켜져 E 와 비교가 안 됩니다.
    kwargs = dict(language="ko", beam_size=cond["beam"], vad_filter=cond["vad"])
    if cond["batch"] > 1:
        # ⚠️ 배치에서는 낱말 시각을 끕니다 — 파이프라인이 지원하지 않는 판이 있고,
        #    여기서 재는 것은 속도와 값 보존이지 정렬이 아닙니다. 실제 서비스에
        #    붙일 때는 낱말 시각이 나오는지 따로 확인해야 합니다(모듈 계약의 `pieces`).
        segments, _ = runner.transcribe(wav, batch_size=cond["batch"], **kwargs)
    else:
        segments, _ = runner.transcribe(wav, word_timestamps=True, **kwargs)
    return " ".join(s.text for s in segments)   # 여기서 실제로 계산됩니다


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

    cuda = have_cuda()
    print(f"코어 {os.cpu_count()} · CUDA {'있음' if cuda else '없음'}\n", flush=True)

    results = {"audio_seconds": manifest["total_seconds"],
               "condition": manifest["condition"],
               "silence_ratio": manifest.get("silence_ratio", 0.0), "runs": []}
    models = Models()

    for cond in conditions:
        head = (f"── {cond['key']}  {cond['device']} {cond['model']}/{cond['compute']} "
                f"beam={cond['beam']} vad={'on' if cond['vad'] else 'off'} batch={cond['batch']}")
        if cond["device"] == "cuda" and not cuda:
            print(f"{head}\n   CUDA 가 없어 건너뜁니다\n", flush=True)
            continue
        print(head, flush=True)

        runner = models.get(cond["model"], cond["device"], cond["compute"], cond["batch"])
        run = {**cond, "items": [], "wall_seconds": 0.0,
               "pii_lost": 0, "keep_lost": 0, "pii_total": 0, "keep_total": 0}
        for m in manifest["items"]:
            start = time.monotonic()
            text = transcribe(runner, str(audio_dir / m["file"]), cond)
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

    if not results["runs"]:
        print("돌린 조건이 없습니다.")
        return 1

    print("조건 | 장치 | 모델 | 배치 | 실시간배수 | PII손상 | keep손상")
    for r in results["runs"]:
        print(f"  {r['key']}  | {r['device']:<4} | {r['model']:<14} | {r['batch']:>2} | "
              f"{r['realtime_factor']:>6.2f}배 | {r['pii_lost']:>2}/{r['pii_total']} | "
              f"{r['keep_lost']:>2}/{r['keep_total']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
