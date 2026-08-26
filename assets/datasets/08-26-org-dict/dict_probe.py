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
    # ADR-055 로 선 아홉째. 근거법이 여신전문금융업법이라 별개 유형입니다
    "CH-card": "카드",
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


def load_dict(with_draft: bool = False) -> tuple[list[dict], dict[str, str]]:
    """사전을 읽는다. `with_draft` 면 아직 적재 안 된 초안까지 합쳐 본다.

    **초안은 `src/kb/org.json` 이 아닙니다.** `source_url`·`verified_at` 이 비어
    있어 `kb-load.ts` 가 적재를 거부합니다. 그래도 여기서 합쳐 보는 이유는
    **출처를 채우면 얼마나 나아지는지**를 미리 알아야 채울 값이 있는지 알기
    때문입니다 — 넓혀도 안 오르면 다른 데를 봐야 합니다.
    """
    orgs = json.loads((ROOT / "src/kb/org.json").read_text(encoding="utf-8"))["orgs"]
    if with_draft:
        orgs = orgs + json.loads((HERE / "org-draft.json").read_text(encoding="utf-8"))["orgs"]
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


def find(text: str, forms: dict[str, str], cap: int, fuzzy_from: int = 0) -> set[str]:
    """글에서 사전의 기관을 찾는다.

    **공백을 떼고 봅니다** — OCR 은 「케 이 뱅 크」로 흩고 전사는 띄어쓰기를 흔듭니다.
    `cap` 글자까지 틀려도 같은 것으로 봅니다.

    `fuzzy_from` 은 **거리를 허용할 최소 길이**입니다. 0 이면 모든 표기에 `cap` 을
    씁니다. 세 글자에 거리 1 을 허용하면 **두 글자만 맞아도 걸려** 「카페이」가
    엉뚱한 자리에서 카카오페이를 만들어 냅니다 — 실측 17 §2 의 오탐 넷이 전부
    그것이었습니다. 짧은 표기만 정확일치로 묶으면 그게 사라지는지 보려고 둡니다.
    """
    flat = text.replace(" ", "")
    hits: set[str] = set()
    for form, canon in forms.items():
        if len(form) < MIN_FORM:
            continue
        if cap == 0 or len(form) < fuzzy_from:
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
    with_draft = "--with-draft" in sys.argv
    orgs, forms = load_dict(with_draft)
    have = {o["channel_id"] for o in orgs}
    out: dict = {"draft": with_draft, "orgs": len(orgs), "forms": len(forms),
                 "channels": {}, "coverage": {}, "sweep": []}

    where = "org.json + org-draft.json" if with_draft else "org.json"
    print(f"사전: 기관 {len(orgs)}곳 · 표기 {len(forms)}가지  ({where})\n")
    print("9유형 중 사전이 있는 곳")
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
        # `(거리, 거리를 허용할 최소 표기 길이)`. 마지막 둘이 **길이별 규칙**입니다 —
        # 세 글자에 거리 1 을 주면 두 글자만 맞아도 걸립니다 → 17 §2
        for cap, fuzzy_from in ((0, 0), (1, 0), (2, 0), (1, 4), (1, 5)):
            need = got = false = 0
            for it in run["items"]:
                spec = items[it["id"]]
                hits = find(it["text"], forms, cap, fuzzy_from)
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
            out["sweep"].append({"case": label, "cap": cap, "fuzzy_from": fuzzy_from,
                                 "recovered": got, "recoverable": need, "false": false})
            rule = f"{cap}" + (f" (≥{fuzzy_from}자만)" if fuzzy_from else "")
            print(f"{label if (cap, fuzzy_from) == (0, 0) else '':16}{rule:>12}  {got:>4}/{need:<4}  {false:>6}")
        print()

    name = "results-dict-draft.json" if with_draft else "results-dict.json"
    (HERE / name).write_text(
        json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
