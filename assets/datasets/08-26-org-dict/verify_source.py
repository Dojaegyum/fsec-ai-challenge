#!/usr/bin/env python3
"""등록부 원문에 초안의 기관명이 **그대로 있는지** 대조한다 — 요약시키지 않고.

    python verify_source.py <URL> CH-card [CH-carrier ...]

## 왜 이렇게 하나

`src/kb/org.json` 의 `_note` 가 사고를 기록해 두었습니다 — 은행연합회 페이지를
**자동 요약**했더니 「한국산업은행」이 「국민은행」으로, 「신한은행」이 「우리은행」으로
밀렸습니다.

**위험한 것은 「자동으로 읽는 것」이 아니라 「요약시키는 것」입니다.** 모델에게
*"이름을 뽑아 줘"* 라고 하면 없는 이름이 만들어질 수 있습니다. 방향을 뒤집어
**우리가 이미 아는 이름이 원문에 있는지**만 보면 만들어질 이름도, 밀릴 이름도
없습니다.

이 스크립트가 그 방향입니다. 전부 찾히면 그 URL 을 `source_url` 로 쓰고,
하나라도 없으면 넣지 않습니다.

## 걸렸던 것 둘

**① 압축.** `--compressed` 없이 받으면 압축본이 와서 어떤 인코딩으로도 안 풀립니다.
**② 인코딩.** 「먼저 성공한 것」을 고르면 안 됩니다 — 은행연합회 페이지는 meta 가
UTF-8 인데 실제로는 cp949 이고, 셋 다 엄격 디코드에 실패합니다. utf-8/replace 로
떨어지면 한글이 57자만 남습니다. **한글이 가장 많이 나오는 것**을 고릅니다.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

HERE = Path(__file__).resolve().parent
DRAFT = HERE / "org-draft.json"
ORG = HERE.parents[2] / "src/kb/org.json"

ENCODINGS = ("utf-8", "cp949", "euc-kr", "utf-16")


def fetch(url: str) -> bytes:
    """원문을 그대로 받는다. **`--compressed` 를 빼지 마세요** — 위 ① 참조."""
    out = subprocess.run(
        ["curl", "-sS", "-L", "--compressed", "--max-time", "40",
         "-A", "Mozilla/5.0", url],
        capture_output=True, check=True,
    )
    return out.stdout


def decode(raw: bytes) -> tuple[str, str]:
    """한글이 가장 많이 나오는 인코딩을 고른다 — 위 ② 참조."""
    best, best_enc, best_score = "", "?", -1
    for enc in ENCODINGS:
        try:
            text = raw.decode(enc, errors="replace")
        except (LookupError, UnicodeError):
            continue
        score = sum(1 for ch in text if "가" <= ch <= "힣") - text.count("�") * 3
        if score > best_score:
            best, best_enc, best_score = text, enc, score
    return best, best_enc


def page_text(raw: bytes) -> tuple[str, str]:
    text, enc = decode(raw)
    text = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", text)
    text = re.sub(r"(?s)<[^>]+>", " ", text)
    text = text.replace("&nbsp;", " ").replace("&amp;", "&")
    return unicodedata.normalize("NFC", re.sub(r"\s+", " ", text)), enc


def flat(s: str) -> str:
    """공백을 뗍니다 — 표에서 「비 씨 카 드」로 흩어지는 경우가 있습니다."""
    return unicodedata.normalize("NFC", s).replace(" ", "")


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__.split("## 왜")[0].strip())
        return 2

    url, channels = sys.argv[1], set(sys.argv[2:])

    pool = json.loads(DRAFT.read_text(encoding="utf-8"))["orgs"]
    pool += json.loads(ORG.read_text(encoding="utf-8"))["orgs"]
    orgs = [o for o in pool if o["channel_id"] in channels]
    if not orgs:
        print(f"대조할 기관이 없습니다 — {', '.join(sorted(channels))}")
        return 1

    text, enc = page_text(fetch(url))
    body = flat(text)
    print(f"{url}\n  {enc} · 본문 {len(text):,}자 · 대조 대상 {len(orgs)}곳\n")

    missing = []
    for o in orgs:
        hit = next((f for f in [o["name"], *o.get("aliases", [])] if flat(f) in body), None)
        extra = "" if hit in (None, o["name"]) else f"  (별칭 「{hit}」로 걸림)"
        print(f"  {'찾음' if hit else '없음'}  {o['name']}{extra}")
        if not hit:
            missing.append(o["name"])

    print(f"\n{len(orgs) - len(missing)}/{len(orgs)} 확인")
    if missing:
        print("\n⚠️ 하나라도 없으면 이 URL 을 source_url 로 쓰지 않습니다.")
        print("   못 찾은 것: " + ", ".join(missing))
        return 1
    print("\n이 URL 을 해당 유형의 source_url 로 써도 됩니다.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
