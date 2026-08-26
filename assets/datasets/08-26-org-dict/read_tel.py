#!/usr/bin/env python3
"""등록부 원문에서 **회사명과 번호가 같은 행에 있는지** 그대로 꺼내 본다.

    python read_tel.py <URL>                    표의 각 행에서 첫 칸 + 번호가 든 칸
    python read_tel.py <URL> --window           표가 아니면: 번호 주변 본문을 그대로
    python read_tel.py <URL> --window --width 320   창을 넓혀서 (기본 60)
    python read_tel.py <URL1> <URL2> ...        주소 여럿을 한 번에

## ⚠️ 창이 좁으면 짝이 어긋납니다 (2026-08-26에 두 번 겪음)

기본 60자는 **번호가 하나뿐인 꼬리말에만 안전합니다.** 실제로 이런 일이 났습니다.

    다날    60자로 보면 「직계약 문의·호스팅업체·가맹점관리사이트」만 보여
            **가맹점 전용 페이지로 단정**하고 번호를 거절했습니다. 380자로 넓히니
            같은 페이지에 `[개인고객] 휴대폰결제를 했습니다. 환불/취소하여 주십시오.`
            가 있었습니다 — 판단이 뒤집혔습니다.

    빗썸    꼬리말에 운영시간이 **두 개**입니다. 좁게 보면 「평일 9:00~19:00」이
            전화번호에 붙어 보이는데, 그건 **서초 사무실 방문 시간**이고 전화는
            「365일 24시간」입니다. 320자로 넓혀서야 갈렸습니다.

**성격을 판단하려면 넓게 보세요.** 번호만 옮겨 적을 때와 다릅니다.

## ⚠️ 오류 페이지를 정상 페이지로 착각하기 쉽습니다

많은 사이트가 **오류 안내에도 정상 꼬리말을 붙입니다.** 라벨 붙은 번호가 거기서만
나오면 사실상 출처가 하나라, 이 저장소 기준을 못 넘습니다(04 §9 의 증권 셋·KT).
그래서 아래 출력이 **한글 자 수와 「오류 문구 있음」**을 함께 찍습니다 — 본문이
100자 언저리면 거의 오류 페이지입니다.

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


def health(text: str) -> str:
    """본문이 살아 있는가 — 오류 페이지를 정상으로 착각하지 않으려는 것입니다."""
    hangul = sum(1 for ch in text if "가" <= ch <= "힣")
    bad = [w for w in ("오류", "죄송", "준비중", "찾을 수 없") if w in text]
    note = f"  ⚠️ 오류 문구 있음({'·'.join(bad)})" if bad else ""
    thin = "  ⚠️ 본문이 얇습니다 — 오류 페이지일 수 있습니다" if hangul < 200 else ""
    return f"한글 {hangul:,}자{note}{thin}"


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        print(__doc__.split("## ⚠️")[0].strip())
        return 2

    width = 60
    if "--width" in sys.argv:
        width = int(sys.argv[sys.argv.index("--width") + 1])
        args = [a for a in args if a != str(width)]

    for url in args:
        one(url, width)
    return 0


def one(url: str, width: int) -> int:
    raw = fetch(url)
    html, enc = decode(raw)
    plain = clean(re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", html))
    print(f"{url}\n  {enc} · {len(html):,}바이트 · {health(plain)}\n")

    if "--window" not in sys.argv:
        found = rows(html)
        if found:
            print(f"표에서 번호가 든 행 {len(found)}개 — 「첫 칸 | 번호 칸」\n")
            for first, tels in found:
                print(f"  {first[:34].ljust(34)} | {' / '.join(t[:60] for t in tels)}")
            return 0
        print("표에서 못 찾았습니다. 본문 주변으로 봅니다.\n")

    found = windows(plain, width)
    print(f"번호 {len(found)}개 — 앞뒤 {width}자 그대로\n")
    for line in found:
        print(f"  … {line} …")
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
