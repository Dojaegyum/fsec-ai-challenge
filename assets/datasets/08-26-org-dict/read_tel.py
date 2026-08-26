#!/usr/bin/env python3
"""등록부 원문에서 **회사명과 번호가 같은 행에 있는지** 그대로 꺼내 본다.

    python read_tel.py <URL>              표의 각 행에서 첫 칸 + 번호가 든 칸
    python read_tel.py <URL> --window     표가 아니면: 번호 주변 본문을 그대로

## 왜 이 스크립트가 따로 있나

[verify_source.py](verify_source.py) 는 **이름**이 원문에 있는지를 봅니다. 번호는
그것만으로 부족합니다 — 이름도 있고 번호도 있는데 **짝이 어긋날 수** 있기 때문입니다.
`org.json` 의 `_note` 가 기록한 사고가 정확히 그것이었습니다: 「한국산업은행」에
국민은행 번호가, 「신한은행」에 우리은행 번호가 붙었습니다.

**그래서 행을 통째로 꺼냅니다.** 요약하지 않고, 첫 칸(회사명)과 번호가 든 칸을
**같은 줄에 붙여** 그대로 찍습니다. 짝이 어긋나면 눈에 보입니다.

⚠️ **이 스크립트는 값을 고르지 않습니다.** 원문을 보기 좋게 늘어놓을 뿐이고,
`org.json` 에 옮겨 적는 것은 사람이 합니다 → docs/research/04-기관정보.md §8.1.

압축·인코딩 처리는 verify_source.py 와 같습니다 — 그쪽 주석을 보세요.
"""

from __future__ import annotations

import re
import subprocess
import sys
import unicodedata

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ENCODINGS = ("utf-8", "cp949", "euc-kr", "utf-16")

# 1588-1234 · 02-123-4567 · 1670-1382 꼴. 하이픈 없는 대표번호(112)는 안 잡습니다 —
# 그냥 숫자와 구분할 방법이 없어서입니다 (§11.4.1 의 같은 이유)
TEL = re.compile(r"\b\d{2,4}-\d{3,4}(?:-\d{4})?\b")


def fetch(url: str) -> bytes:
    out = subprocess.run(
        ["curl", "-sS", "-L", "--compressed", "--max-time", "40",
         "-A", "Mozilla/5.0", url],
        capture_output=True, check=True,
    )
    return out.stdout


def decode(raw: bytes) -> tuple[str, str]:
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


def clean(fragment: str) -> str:
    text = re.sub(r"(?s)<[^>]+>", " ", fragment)
    text = text.replace("&nbsp;", " ").replace("&amp;", "&")
    return unicodedata.normalize("NFC", re.sub(r"\s+", " ", text)).strip()


def rows(html: str) -> list[tuple[str, list[str]]]:
    """`<tr>` 마다 (첫 칸, 번호가 든 칸들) — **행을 깨지 않습니다.**"""
    out = []
    for row in re.findall(r"(?is)<tr[^>]*>(.*?)</tr>", html):
        cells = [clean(c) for c in re.findall(r"(?is)<t[dh][^>]*>(.*?)</t[dh]>", row)]
        if not cells:
            continue
        tels = [c for c in cells if TEL.search(c)]
        if tels:
            out.append((cells[0], tels))
    return out


def windows(text: str, width: int = 60) -> list[str]:
    """표가 아닐 때 — 번호 주변 본문을 그대로."""
    seen, out = set(), []
    for m in TEL.finditer(text):
        if m.group() in seen:
            continue
        seen.add(m.group())
        out.append(text[max(0, m.start() - width):m.end() + width])
    return out


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__.split("## 왜")[0].strip())
        return 2

    url = sys.argv[1]
    raw = fetch(url)
    html, enc = decode(raw)
    print(f"{url}\n  {enc} · {len(html):,}바이트\n")

    if "--window" not in sys.argv:
        found = rows(html)
        if found:
            print(f"표에서 번호가 든 행 {len(found)}개 — 「첫 칸 | 번호 칸」\n")
            for first, tels in found:
                print(f"  {first[:34].ljust(34)} | {' / '.join(t[:60] for t in tels)}")
            return 0
        print("표에서 못 찾았습니다. 본문 주변으로 봅니다.\n")

    text = clean(re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", html))
    found = windows(text)
    print(f"번호 {len(found)}개 — 앞뒤 본문 그대로\n")
    for line in found:
        print(f"  … {line} …")
    return 0


if __name__ == "__main__":
    sys.exit(main())
