"""시연용 Mock 부산물 — 접수증·접수 문자·공고 통지문. **전부 합성입니다.**

`make_mock.py` 가 만드는 셋(통화·문자·이체)은 **사건이 시작될 때** 올리는 증거이고,
여기서 만드는 셋은 **절차가 남기는 부산물**입니다 — 단계를 「증빙 파일로 완료」하거나
(completion-checker L2), 통지문에서 공고일을 뽑는(slot-extractor · ADR-071) 자리에 씁니다.

    receipt-relief.png   피해구제 신청 접수증        → 「신청서류를 금융회사에 제출합니다」 · 「이의제기 접수증」
    receipt-112.png      112 신고 접수 안내 문자     → 「112에 신고합니다」 (공공기관 이름 + 사건접수번호)
    notice-freeze.png    채권소멸절차 개시 공고 통지 → 「공고합니다」 단계 · 통장묶기 트랙의 공고일(notice_started_at)

판정기가 보는 것은 spec/backend 의 completion-checker 규칙 그대로입니다 — 판독 글에
「접수번호」 자리 뒤의 번호(또는 가린 이름표)가 있거나, `org_public` 의 공공기관 이름이
있으면 통과. 그래서 세 장 모두 **「…번호」 낱말 + 번호**를 크게 적습니다.

값은 `make_mock.py` 의 사건과 같은 값입니다 — 계좌 110-234-567890 · 국민은행 · 김민수.
주민등록번호는 넣지 않습니다. 날짜·번호·지점명은 전부 임의입니다. 문서 모양은 어느 기관의
실제 서식도 흉내 내지 않았고, 아래에 「시연용 예시」 줄이 박혀 있습니다.

`make_mock.py` 를 import 하지 않는 이유: 그 파일은 첫 줄에서 edge-tts 를 부르므로 음성
환경이 없는 곳에서는 못 엽니다. 폰트·줄바꿈 헬퍼는 같은 규칙으로 여기 다시 적었습니다.

    python make_mock_receipts.py            # 이 폴더에 씁니다
    python make_mock_receipts.py ../../../src/public/demo   # 앱이 서빙하는 사본에 바로
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent

FONT_CANDIDATES = {
    "regular": [
        "/mnt/c/Windows/Fonts/malgun.ttf",
        "C:/Windows/Fonts/malgun.ttf",
        "/usr/share/fonts/truetype/nanum/NanumGothic.ttf",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    ],
    "bold": [
        "/mnt/c/Windows/Fonts/malgunbd.ttf",
        "C:/Windows/Fonts/malgunbd.ttf",
        "/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    ],
}


def font(weight: str, size: int) -> ImageFont.FreeTypeFont:
    for path in FONT_CANDIDATES[weight]:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    raise SystemExit("한글 폰트를 못 찾았습니다 — FONT_CANDIDATES 에 경로를 더하세요")


WIDTH = 900
INK = (26, 28, 33)
DIM = (120, 126, 138)
BG = (235, 237, 241)
THEIRS = (255, 255, 255)
PAPER = (255, 255, 255)
RULE = (228, 231, 236)
HEAD = (247, 248, 250)


def wrap(draw: ImageDraw.ImageDraw, text: str, f: ImageFont.FreeTypeFont, limit: int) -> list[str]:
    """글자 폭으로 줄을 나눕니다 — 한국어는 공백이 드물어 글자 단위로 봅니다."""
    out: list[str] = []
    for para in text.split("\n"):
        line = ""
        for ch in para:
            if draw.textlength(line + ch, font=f) > limit and line:
                out.append(line)
                line = ch
            else:
                line += ch
        out.append(line)
    return out


def make_sms(spec: dict, out: Path) -> None:
    """기관이 보낸 안내 문자 한 화면 — 말풍선 하나 이상. 판독기가 읽기 쉽게 글자를 큼직하게."""
    f_head = font("bold", 26)
    f_time = font("regular", 18)
    f_body = font("regular", 26)

    pad, gap, bubble_max = 28, 14, 640
    probe = ImageDraw.Draw(Image.new("RGB", (1, 1)))

    blocks = []
    height = 96 + pad
    for line in spec["lines"]:
        rows = wrap(probe, line["text"], f_body, bubble_max - 32)
        box_h = 24 + len(rows) * 37
        blocks.append((line, rows, box_h))
        height += box_h + gap

    img = Image.new("RGB", (WIDTH, height + pad + 30), BG)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, WIDTH, 76], fill=HEAD)
    d.text((pad, 24), spec["peer"], font=f_head, fill=INK)
    d.line([(0, 76), (WIDTH, 76)], fill=(219, 222, 228), width=1)

    y = 96
    for line, rows, box_h in blocks:
        width_px = min(max(probe.textlength(r, font=f_body) for r in rows) + 32, bubble_max)
        x = pad
        d.rounded_rectangle([x, y, x + width_px, y + box_h], radius=14, fill=THEIRS, outline=(224, 227, 233))
        for i, row in enumerate(rows):
            d.text((x + 16, y + 12 + i * 37), row, font=f_body, fill=INK)
        d.text((x + width_px + 8, y + box_h - 26), line["time"], font=f_time, fill=DIM)
        y += box_h + gap

    d.text((pad, y + 6), spec["foot"], font=f_time, fill=DIM)
    img.save(out)


def make_document(spec: dict, out: Path) -> None:
    """기관이 발급한 서류 한 장 — 제목 · 표 · 본문 · 발급 기관. 어느 실제 서식도 흉내 내지 않습니다."""
    f_issuer = font("bold", 24)
    f_title = font("bold", 36)
    f_sub = font("regular", 21)
    f_label = font("regular", 23)
    f_value = font("bold", 25)
    f_body = font("regular", 22)
    f_foot = font("regular", 19)

    pad = 44
    probe = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    body_rows = [r for para in spec["body"] for r in wrap(probe, para, f_body, WIDTH - pad * 2)]
    height = 84 + 56 + 62 + 40 + 36 + len(spec["rows"]) * 54 + 30 + len(body_rows) * 34 + 30 + 70 + 60

    img = Image.new("RGB", (WIDTH, height), PAPER)
    d = ImageDraw.Draw(img)

    d.rectangle([0, 0, WIDTH, 84], fill=HEAD)
    d.text((pad, 28), spec["issuer"], font=f_issuer, fill=INK)

    y = 84 + 56
    d.text((pad, y), spec["title"], font=f_title, fill=INK)
    y += 62
    d.text((pad, y), spec["subtitle"], font=f_sub, fill=DIM)
    y += 40
    d.line([(pad, y), (WIDTH - pad, y)], fill=RULE, width=1)
    y += 24

    for label, value in spec["rows"]:
        d.text((pad, y), label, font=f_label, fill=DIM)
        w = d.textlength(value, font=f_value)
        d.text((WIDTH - pad - w, y - 2), value, font=f_value, fill=INK)
        y += 54

    d.line([(pad, y + 6), (WIDTH - pad, y + 6)], fill=RULE, width=1)
    y += 30
    for row in body_rows:
        d.text((pad, y), row, font=f_body, fill=INK)
        y += 34

    y += 30
    d.text((pad, y), spec["signature"], font=f_value, fill=INK)
    y += 44
    d.text((pad, y), spec["foot"], font=f_foot, fill=DIM)

    img.save(out)


def main() -> int:
    out_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE
    out_dir.mkdir(parents=True, exist_ok=True)
    script = json.loads((HERE / "script.json").read_text(encoding="utf-8"))

    jobs = (
        ("receipt-relief.png", make_document, script["receipt_relief"]),
        ("receipt-112.png", make_sms, script["receipt_112"]),
        ("notice-freeze.png", make_document, script["notice_freeze"]),
    )
    for name, fn, spec in jobs:
        path = out_dir / name
        fn(spec, path)
        print(f"{name:20s} {Image.open(path).size}  {path.stat().st_size / 1024:6.0f}KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
