# -*- coding: utf-8 -*-
"""**기관명을 사람 이름으로 보나** — 문장 모양을 바꿔 가며 잽니다.

    NER_URL=http://127.0.0.1:8917 NER_TOKEN=... python org_falsepos.py

## 왜 이 도구가 있나

`ner_battery.py` 가 「보이스피싱 지킴이」 한 건에서 걸렸을 때, **한 건인지 전부인지**
알 방법이 없었습니다. 기관명이 사람 이름으로 걸리면 `"카카오페이로 300만원"` 이
`"[이름-1]로 300만원"` 이 되어 **경유 서비스를 못 고르고 에러 없이 엉뚱한 매뉴얼이
나갑니다**(`tokenize.ts` 의 `isAllowed` 주석 · [17](../../../docs/research/17-기관명-사전-실측.md) 머리말).

**문장 모양을 바꿔 가며 재는 것이 핵심입니다.** 슬롯은 낱말 하나로 들어오지만
전사문·챗은 **문장**으로 들어옵니다 — 실측에서 그 둘이 5% 와 70% 로 갈렸습니다.

측정값은 [research/09 §7.2](../../../docs/research/09-로컬모델-PII인식-실측.md).

⛔ 기관명은 공개된 상호라 개인정보가 아니지만, **문장에 실제 값을 넣지 마세요** —
이 파일은 빌린 GPU 로 올라갑니다 ([ADR-043](../../../decisions/043-gpu-hosting.md)).
"""

from __future__ import annotations

import json
import os
import urllib.request

URL = os.environ.get("NER_URL", "http://127.0.0.1:8917").rstrip("/") + "/ner"
TOKEN = os.environ.get("NER_TOKEN", "")

# 8유형이 고루 들어가게. 뒤 셋은 `org` 표에 못 들어가는 공공기관입니다 →
# 04 §8 이 「3순위 공통 KB 항목」으로 갈라 둔 자리
ORGS = [
    "카카오페이", "국민은행", "농협은행", "신한카드", "토스뱅크", "케이뱅크",
    "미래에셋증권", "NH투자증권", "빗썸", "업비트", "SK텔레콤", "컬처랜드",
    "해피머니", "금융감독원", "보이스피싱 지킴이", "서울중앙지검", "서초경찰서",
]

# **같은 기관, 다른 문장.** 이 축이 없으면 「한 건 걸렸다」로 끝나고
# 전사문에서 무슨 일이 나는지 모릅니다
SHAPES = [
    ("낱말만", "{}"),
    ("~에 전화", "{}에 전화해서 물어봤는데 안 된다고 합니다"),
    ("고객센터", "{} 고객센터에 전화했더니 지급정지가 됐다고 합니다"),
    ("~에서 이체", "{}에서 300만원이 빠져나갔어요"),
    ("앱으로", "어제 {} 앱으로 이체했습니다"),
]


def ask(text: str) -> list[str]:
    # ⚠️ **UA 를 안 바꾸면 RunPod 프록시가 403 입니다** — Cloudflare 가
    # `Python-urllib` 을 봇으로 막습니다(`error code: 1010`). 앱은 통과하는데
    # 이 스크립트만 막혀서, 서비스가 죽은 줄 알고 한참 헤맵니다
    headers = {"content-type": "application/json", "user-agent": "finally-qa/1.0"}
    if TOKEN:
        headers["x-finally-token"] = TOKEN
    req = urllib.request.Request(
        URL, data=json.dumps({"text": text}).encode("utf-8"), headers=headers
    )
    with urllib.request.urlopen(req, timeout=300) as res:
        return [one["value"] for one in json.loads(res.read().decode("utf-8"))["spans"]]


def main() -> None:
    hits: dict[str, list[str]] = {name: [] for name, _ in SHAPES}

    print(f"{'기관명':16}" + "".join(f"{name:>10}" for name, _ in SHAPES))
    print("─" * 68)
    for org in ORGS:
        row = ""
        for name, shape in SHAPES:
            got = ask(shape.format(org))
            if got:
                hits[name].append(org)
            row += f"{'⛔':>10}" if got else f"{'·':>10}"
        print(f"{org:16}{row}")

    print("─" * 68)
    total = len(ORGS)
    for name, _ in SHAPES:
        found = hits[name]
        print(f"{name:10} {len(found):2}/{total}  ({len(found) * 100 // total:2}%)  "
              f"{found if found else ''}")

    every = sum(len(v) for v in hits.values())
    print(f"\n전체 {every}/{total * len(SHAPES)} "
          f"({every * 100 // (total * len(SHAPES))}%) 가 사람 이름으로 걸립니다")
    print("→ 허용 목록(`allowedTerms`) 없이 NER 을 켜면 이만큼이 가려집니다")


if __name__ == "__main__":
    main()
