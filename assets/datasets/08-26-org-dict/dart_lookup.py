#!/usr/bin/env python3
"""DART 전자공시로 법인의 **실재·홈페이지·업종**을 확인한다.

    python dart_lookup.py                 # 초안 전체를 대 본다
    python dart_lookup.py 코빗 스트리미     # 이름으로 기업개황을 본다

`DART_API_KEY` 를 `src/.env.local` 에서 읽습니다. 발급은 https://opendart.fss.or.kr/ (무료).
**런타임 코드는 이 키를 안 씁니다** — 사전을 채울 때만 쓰는 조사 도구입니다.

## 왜 이게 필요했나

업권 등록부가 하나도 안 열립니다 — 금융투자협회 회원사 목록 본문 83자, KTOA 38자,
FIU 2KB 껍데기. 전부 자바스크립트로 그립니다. 한국거래소 상장법인 목록으로 아홉을
채웠지만 **비상장은 거기 없습니다.**

DART 는 **공시대상 법인 11만 곳**을 냅니다(비상장 포함). 그리고 기업개황 한 장에
셋이 함께 있습니다.

    공시회사명   이 이름의 법인이 실재하는가
    홈페이지     그게 우리가 아는 그 브랜드인가      <- 이게 결정적입니다
    업종명       업종이 우리가 붙인 유형과 맞는가    <- 이걸 주는 출처는 여기가 처음

**홈페이지 필드가 「법인 ↔ 브랜드」를 이어 줍니다.** 그래서 추측하지 않고 가릅니다 —
「해피머니아이엔씨」는 홈페이지가 `happymoney.co.kr` 이라 해피머니가 맞고,
「스트리미」는 `streami.co` 라 **고팍스와 이어지지 않습니다.**

## ⚠️ 이름만 같은 것을 조심하세요

11만 곳이라 같은 이름이 여럿입니다. 「컬쳐랜드」라는 법인이 DART 에 있지만
업종이 **비주거용 건물 임대업**입니다 — 문화상품권 발행사가 아닐 수 있습니다.
**업종과 홈페이지를 같이 보고 판단하세요.**
"""

from __future__ import annotations

import io
import json
import re
import subprocess
import sys
import unicodedata
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
ENV = ROOT / "src/.env.local"
CACHE = HERE / ".dart-corp.zip"          # .gitignore 대상 — 11MB 이고 매일 바뀝니다
POPUP = "https://dart.fss.or.kr/dsae001/selectPopup.ax?selectKey={}"
FIELDS = ("회사이름", "공시회사명", "홈페이지", "업종명", "설립일")


def api_key() -> str:
    if not ENV.exists():
        raise SystemExit(f"{ENV} 가 없습니다")
    for line in ENV.read_text(encoding="utf-8", errors="replace").splitlines():
        if line.startswith("DART_API_KEY"):
            v = line.split("=", 1)[1].strip().strip('"').strip("'")
            if v:
                return v
    raise SystemExit("DART_API_KEY 가 비어 있습니다 — https://opendart.fss.or.kr/ 에서 발급")


def get(url: str, timeout: int = 120) -> bytes:
    return subprocess.run(
        ["curl", "-sS", "-L", "--compressed", "--max-time", str(timeout),
         "-A", "Mozilla/5.0", url],
        capture_output=True, check=True).stdout


def corp_index() -> dict[str, str]:
    """`공시회사명 -> corp_code`. 전체 파일은 한 번만 받아 캐시합니다."""
    if not CACHE.exists():
        raw = get(f"https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key={api_key()}")
        if raw[:2] != b"PK":
            raise SystemExit("ZIP 이 아닙니다 — " + raw[:200].decode("utf-8", "replace"))
        CACHE.write_bytes(raw)
    with zipfile.ZipFile(io.BytesIO(CACHE.read_bytes())) as z:
        root = ET.fromstring(z.read(z.namelist()[0]))
    out: dict[str, str] = {}
    for it in root.iter("list"):
        n = unicodedata.normalize("NFC", (it.findtext("corp_name") or "").strip())
        if n:
            out.setdefault(n.replace(" ", ""), it.findtext("corp_code") or "")
    return out


def profile(code: str) -> dict[str, str]:
    """기업개황 팝업을 읽는다. **서버가 그려 주는 페이지**라 그대로 파싱됩니다."""
    raw = get(POPUP.format(code), timeout=30)
    best, bs = "", -1
    for enc in ("utf-8", "cp949", "euc-kr"):
        t = raw.decode(enc, errors="replace")
        sc = sum(1 for c in t if "가" <= c <= "힣") - t.count("�") * 3
        if sc > bs:
            best, bs = t, sc
    best = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", best)
    lines = [unicodedata.normalize("NFC", x.strip())
             for x in re.sub(r"(?s)<[^>]+>", "\n", best).split("\n")]
    lines = [x for x in lines if x]
    out = {}
    for i, ln in enumerate(lines):
        if ln in FIELDS and i + 1 < len(lines) and lines[i + 1] not in FIELDS:
            out.setdefault(ln, lines[i + 1])
    return out


def show(label: str, index: dict[str, str]) -> None:
    code = index.get(unicodedata.normalize("NFC", label).replace(" ", ""))
    if not code:
        print(f"  없음  {label}")
        return
    p = profile(code)
    print(f"  찾음  {label}   {POPUP.format(code)}")
    for f in FIELDS:
        if p.get(f):
            print(f"          {f:<7} {p[f]}")


def main() -> int:
    index = corp_index()
    print(f"DART 공시대상 법인 {len(index):,}곳\n")

    if len(sys.argv) > 1:
        for label in sys.argv[1:]:
            show(label, index)
        return 0

    draft = json.loads((HERE / "org-draft.json").read_text(encoding="utf-8"))["orgs"]
    for o in draft:
        forms = [o["name"], *o.get("aliases", [])]
        hit = next((f for f in forms
                    if unicodedata.normalize("NFC", f).replace(" ", "") in index), None)
        if hit:
            show(hit, index)
        else:
            print(f"  없음  {o['name']}")
    print("\n⚠️ 홈페이지·업종이 우리가 아는 그 브랜드와 맞는지 **눈으로 확인**하세요.")
    print("   이름만 같은 다른 법인이 있습니다 — 위 독스트링 참조.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
