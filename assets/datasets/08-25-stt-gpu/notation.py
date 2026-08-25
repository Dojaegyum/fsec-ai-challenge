#!/usr/bin/env python3
"""전사문의 값을 「보존 · 자리표기 변형 · 소실」 셋으로 가른다.

## 왜 셋으로 가르나

「값이 살아남았나」만 세면 **위험의 크기가 안 보입니다.** 틀리는 방향이 서로 다른
사고를 냅니다 — 09 §2.2 가 누출·과차단·전사손상을 가른 것과 같은 이유입니다.

    보존        전사문에 그대로 있음. 탐지기가 볼 수 있는 상태
    자리표기 변형  값이 살아 있는데 **모양이 바뀜** — 가장 위험합니다
    소실        전사문에 없음. 사용자가 confirm 화면에서 고칩니다 (ADR-038)

**「자리표기 변형」이 왜 제일 위험한가.** 소실은 화면에서 빈칸으로 보이니 사용자가
고칩니다. 변형은 **그럴듯한 텍스트로 남아 있어** 아무도 이상함을 못 느끼는데,
탐지기의 정규식·LLM 은 날짜로 읽고 지나칠 수 있습니다. 그러면 원문 계좌번호가
그대로 경계를 넘습니다 — 불변 규칙 2 위반입니다.

## 무엇을 되돌리나

whisper 가 하이픈 낀 숫자를 **날짜로 정규화**합니다. 그것만 되돌립니다.

    3333-01-2345678  ->  "3333년 1월 23일 45678"
    880312-2345678   ->  "88만 312-2345678"
    3333-05-1122334  ->  "3333년 5월 11일 이만 2334"

⚠️ **되돌리기는 멀쩡한 값을 깨뜨릴 수도 있습니다.** 그래서 둘을 따로 셉니다.

    보존/변형/소실   **원본 전사문**의 상태입니다. 위험이 어디 있는지 보려는 것
    되돌린 뒤        되돌리기를 **전체에 적용하고 처음부터 다시** 센 것.
                    깨뜨린 것까지 반영된 실제 값입니다 — 이쪽이 붙였을 때의 결과입니다

⚠️ **이건 분석 도구이지 붙일 코드가 아닙니다.** 토큰화 앞에 되돌리기를 두지
않습니다 — `pii-tokenizer/transcript-digits.ts` 가 **가리는 쪽을 기본값으로** 두어
같은 문제를 더 안전하게 답니다(ADR-011). 되돌리기는 「알아본 것만 가린다」로
되돌아가는 셈입니다 → ADR-052 「탈락시킨 것」.

**여기서 되돌리기를 하는 이유는 하나뿐입니다** — 「값이 살아 있는데 모양만
바뀐 것」과 「아예 없는 것」을 **가르기 위해서**입니다. 그 구분이 위험의 크기를
가릅니다.

    python notation.py <results.json> [...]  # 결과 파일 여럿을 한꺼번에
"""

from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path

EVAL = Path(__file__).resolve().parents[1] / "08-21-local-llm-pii" / "eval-set.json"

# 한글 수사 — 「이만 2334」의 「이」
SINO = {"영": 0, "일": 1, "이": 2, "삼": 3, "사": 4, "오": 5, "육": 6, "칠": 7, "팔": 8, "구": 9}

YMD = re.compile(r"(\d+)\s*년\s*(\d+)\s*월(?:\s*(\d+)\s*일)?")
MAN = re.compile(r"([\d영일이삼사오육칠팔구]+)\s*만\s*(\d+)")

# ⚠️ **자리쉼표를 먼저 뗍니다.** 「56만 7,890」의 쉼표를 두면 만 뒤가 「7」로 잘려
#    567890 이 560007890 이 됩니다 — 되돌리기가 멀쩡한 값을 깨뜨리는 자리입니다.
COMMA = re.compile(r"(?<=\d),(?=\d)")

DIGITS = re.compile(r"\d+")

# 숫자로 이루어진 값은 자리표기가 달라져도 같은 값으로 봅니다 (bench_stt.py 와 같은 규칙)
NUMERIC_KINDS = {"계좌", "전화", "주민번호", "카드", "대표번호"}


def undate(text: str) -> str:
    """날짜로 읽힌 숫자를 자리표기로 되돌린다."""
    text = COMMA.sub("", text)
    text = YMD.sub(
        lambda m: m.group(1) + f"{int(m.group(2)):02d}"
        + (f"{int(m.group(3)):02d}" if m.group(3) else ""),
        text,
    )

    def man(m: re.Match) -> str:
        head = m.group(1)
        if not head.isdigit():
            head = "".join(str(SINO[c]) for c in head)
        # 「만」 뒤는 네 자리입니다 — 88만 312 는 880312
        return head + m.group(2).zfill(4)

    return MAN.sub(man, text)


def digits_of(s: str) -> str:
    return "".join(DIGITS.findall(s))


def found(value: str, kind: str, text: str) -> bool:
    if kind in NUMERIC_KINDS:
        d = digits_of(value)
        return bool(d) and (d in digits_of(text) or value in text)
    return value in text


def classify(run: dict, items: dict) -> tuple[Counter, list[dict], list[dict]]:
    counts: Counter = Counter()
    mangled: list[dict] = []
    broken: list[dict] = []          # 되돌리기가 오히려 깨뜨린 것
    for it in run["items"]:
        raw, fixed = it["text"], undate(it["text"])
        for p in items[it["id"]]["pii"]:
            in_raw = found(p["text"], p["kind"], raw)
            in_fixed = found(p["text"], p["kind"], fixed)
            if in_raw:
                counts["보존"] += 1
                if not in_fixed:
                    counts["되돌려서_깨짐"] += 1
                    broken.append({"id": it["id"], "kind": p["kind"], "value": p["text"]})
            elif in_fixed:
                counts["변형"] += 1
                mangled.append({"id": it["id"], "kind": p["kind"], "value": p["text"]})
            else:
                counts["소실"] += 1
            if in_fixed:
                counts["되돌린_뒤"] += 1
    return counts, mangled, broken


def main() -> int:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    items = {i["id"]: i for i in json.loads(EVAL.read_text(encoding="utf-8"))["items"]}

    out = []
    head = ("     모델              보존   변형   소실  |  되돌린 뒤   (깨뜨린 것)")
    print(head)
    for path in sys.argv[1:]:
        d = json.loads(Path(path).read_text(encoding="utf-8"))
        for run in d["runs"]:
            counts, mangled, broken = classify(run, items)
            model = run.get("model") or d.get("model", "medium")
            total = counts["보존"] + counts["변형"] + counts["소실"]
            after = counts["되돌린_뒤"]
            row = {"key": run["key"], "device": run.get("device", "cpu"), "model": model,
                   "preserved": counts["보존"], "mangled": counts["변형"],
                   "lost": counts["소실"], "total": total,
                   "after_undate": after, "broken_by_undate": counts["되돌려서_깨짐"],
                   "mangled_values": mangled, "broken_values": broken}
            out.append(row)
            print(f" {run['key']}  {model:<17}{counts['보존']:>4}   {counts['변형']:>3}   "
                  f"{counts['소실']:>3}  |  {after:>2}/{total} ({after / total:>5.1%})"
                  f"   {counts['되돌려서_깨짐']:>2}건")

    Path("results-notation.json").write_text(
        json.dumps({"note": "보존/변형/소실은 원본 전사문의 상태. "
                            "after_undate 는 되돌리기를 전체 적용하고 다시 센 값",
                    "runs": out},
                   ensure_ascii=False, indent=2),
        encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
