#!/usr/bin/env python3
"""기관명 사전이 잃은 것을 얼마나 회수하나 — 저장된 전사문·판독문으로, GPU 없이.

결과: docs/research/17-기관명-사전-실측.md

## 왜 쟀나

두 실측이 **같은 자리에서** 샜습니다.

    전사 [15]  기관 손상 19%
    화면 [16]  기관 손상 35%   (26건 중 9건)

기관명은 [8유형 분기](../../../spec/backend/08-14-channel-matrix.md)의 입력이라,
사라지면 **에러 없이 엉뚱한 매뉴얼이 나갑니다.** `src/kb/org.json` 에 사전이 있으니
**그걸 대면 회수되는지**를 봅니다.

## 셋을 봅니다

    커버리지  평가셋의 기관이 사전에 있나  — 없으면 사전을 넓혀야 합니다
    회수      잃은 기관을 사전으로 되찾나
    오탐      **없는 기관을 만들어내지 않나**  <- 이게 임계값을 정합니다

**오탐을 같이 안 보면 임계값을 못 정합니다.** 거리를 넓힐수록 회수는 늘지만
없는 기관이 딸려 옵니다. 기관을 잘못 넣는 것은 잘못된 매뉴얼로 이어지므로
**회수보다 오탐이 비쌉니다.**

    python dict_probe.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]

CHANNELS = {
    "CH-bank": "시중은행", "CH-neobank": "인터넷은행", "CH-securities": "증권사",
    "CH-easypay": "간편송금", "CH-crypto": "가상자산", "CH-facetoface": "대면편취",
    "CH-giftcard": "상품권", "CH-carrier": "소액결제",
}
ORG_KINDS = ("기관", "상품권사", "통신사")

# 표기가 짧으면 편집거리 매칭이 아무 데나 걸립니다 — 「KB」·「국민」 같은 두 글자.
MIN_FORM = 3

CASES = [
    ("전사 large-v3", "assets/datasets/08-25-stt-gpu/results-gpu.json",
     "assets/datasets/08-21-local-llm-pii/eval-set.json", "H"),
    ("화면 GPU", "assets/datasets/08-26-ocr-gpu/results-ocr.json",
     "assets/datasets/08-21-local-ocr-pii/eval-set.json", "G1"),
]


def load_dict() -> tuple[list[dict], dict[str, str]]:
    orgs = json.loads((ROOT / "src/kb/org.json").read_text(encoding="utf-8"))["orgs"]
    forms: dict[str, str] = {}
    for o in orgs:
        for f in [o["name"], *o.get("aliases", [])]:
            forms[f.replace(" ", "")] = o["name"]
    return orgs, forms


def dist(a: str, b: str, cap: int) -> int:
    """편집거리. `cap` 을 넘으면 일찍 접습니다 — 창을 수없이 대므로."""
    if abs(len(a) - len(b)) > cap:
        return cap + 1
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        if min(cur) > cap:
            return cap + 1
        prev = cur
    return prev[-1]


def find(text: str, forms: dict[str, str], cap: int) -> set[str]:
    """글에서 사전의 기관을 찾는다.

    **공백을 떼고 봅니다** — OCR 은 「케 이 뱅 크」로 흩고 전사는 띄어쓰기를 흔듭니다.
    `cap` 글자까지 틀려도 같은 것으로 봅니다.
    """
    flat = text.replace(" ", "")
    hits: set[str] = set()
    for form, canon in forms.items():
        if len(form) < MIN_FORM:
            continue
        if cap == 0:
            if form in flat:
                hits.add(canon)
            continue
        n = len(form)
        for w in range(max(1, n - cap), n + cap + 1):
            if any(dist(flat[i:i + w], form, cap) <= cap for i in range(len(flat) - w + 1)):
                hits.add(canon)
                break
    return hits


def main() -> int:
    orgs, forms = load_dict()
    have = {o["channel_id"] for o in orgs}
    out: dict = {"orgs": len(orgs), "forms": len(forms), "channels": {}, "coverage": {}, "sweep": []}

    print(f"사전: 기관 {len(orgs)}곳 · 표기 {len(forms)}가지\n")
    print("8유형 중 사전이 있는 곳")
    for ch, ko in CHANNELS.items():
        n = sum(1 for o in orgs if o["channel_id"] == ch)
        out["channels"][ch] = n
        print(f"   {'있음' if ch in have else '없음 '}  {ch:<15} {ko:<6} {n or ''}")

    print("\n── 평가셋의 기관을 사전이 덮는가\n")
    for label, _res, eval_path, _key in CASES:
        items = json.loads((ROOT / eval_path).read_text(encoding="utf-8"))["items"]
        seen: dict[str, set[str]] = {}
        for it in items:
            for k in it["keep"]:
                if k["kind"] in ORG_KINDS:
                    seen.setdefault(k["kind"], set()).add(k["text"])
        cov = {}
        print(f"{label}")
        for kind, vals in sorted(seen.items()):
            miss = sorted(v for v in vals if v.replace(" ", "") not in forms)
            cov[kind] = {"total": len(vals), "missing": miss}
            print(f"   {kind:<6} {len(vals) - len(miss):>2}/{len(vals):<2} 덮음"
                  + (f"   빠진 것: {', '.join(miss)}" if miss else ""))
        out["coverage"][label] = cov
        print()

    print("── 거리를 넓히면 회수와 오탐이 어떻게 되나\n")
    print(f"{'':16}{'거리':>4}  {'회수':>9}  {'오탐':>6}")
    for label, res_path, eval_path, key in CASES:
        items = {i["id"]: i for i in json.loads((ROOT / eval_path).read_text(encoding="utf-8"))["items"]}
        run = next(r for r in json.loads((ROOT / res_path).read_text(encoding="utf-8"))["runs"]
                   if r["key"] == key)
        for cap in (0, 1, 2):
            need = got = false = 0
            for it in run["items"]:
                spec = items[it["id"]]
                hits = find(it["text"], forms, cap)
                truth = {forms[k["text"].replace(" ", "")] for k in spec["keep"]
                         if k["kind"] in ORG_KINDS and k["text"].replace(" ", "") in forms}
                for k in spec["keep"]:
                    if k["kind"] not in ORG_KINDS:
                        continue
                    canon = forms.get(k["text"].replace(" ", ""))
                    if canon is None or k["text"] in it["text"]:
                        continue          # 사전에 없거나, 애초에 안 잃은 것
                    need += 1
                    got += canon in hits
                false += len(hits - truth)
            out["sweep"].append({"case": label, "cap": cap,
                                 "recovered": got, "recoverable": need, "false": false})
            print(f"{label if cap == 0 else '':16}{cap:>4}  {got:>4}/{need:<4}  {false:>6}")
        print()

    (HERE / "results-dict.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
