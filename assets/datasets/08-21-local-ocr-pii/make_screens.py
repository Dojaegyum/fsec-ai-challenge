#!/usr/bin/env python3
"""평가셋 20장을 증거 화면 이미지로 그린다 — 열화 3단까지.

정본: docs/research/12-OCR-실측-방법론.md §1 · §1.1

## 왜 뒤늦게 만드나

12 §5 가 *"측정 하네스는 저장소에 넣지 않았습니다 — 버리는 것을 전제로 쓴 코드입니다"*
라고 적어 두었습니다. 그래서 **`ocr-text.json` 으로 탐지기·후처리는 다시 잴 수 있지만
OCR 엔진 자체는 다시 못 쟀습니다** — 이미지가 견본 두 장뿐이라서입니다.

GPU 로 옮기면 얼마나 빨라지는지를 재려면 이미지가 있어야 합니다. 그래서 12 에 적힌
절차대로 다시 그립니다. **평가셋이 라벨·값까지 다 들고 있어 기계적입니다.**

⚠️ **12 의 그 화면과 픽셀 단위로 같지는 않습니다.** 같은 절차로 다시 그린 것이라,
**엔진 간·조건 간 비교에는 쓰되 11 의 절대값과 나란히 놓지 마세요.**

⚠️ **전부 합성입니다.** 실제 은행 앱과 글꼴·자간·배경이 다릅니다 → 11 §2.4.

    python make_screens.py [출력폴더]
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).resolve().parent

WIDTH = 900
PAD = 48
ROW_H = 62
BAR_H = 96

# 12 §1 — 맑은 고딕. 없으면 그리지 않습니다(다른 글꼴로 그리면 조건이 달라집니다)
FONT_DIR = Path("C:/Windows/Fonts")
REGULAR, BOLD = FONT_DIR / "malgun.ttf", FONT_DIR / "malgunbd.ttf"

INK = (24, 26, 30)
DIM = (122, 128, 138)
BG = (255, 255, 255)
BAR = (243, 245, 248)
LINE = (228, 231, 236)


def font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(path), size)


def draw_screen(item: dict) -> Image.Image:
    fields = item["fields"]
    height = BAR_H + PAD + ROW_H * len(fields) + PAD + 56
    img = Image.new("RGB", (WIDTH, height), BG)
    d = ImageDraw.Draw(img)

    f_brand, f_title = font(BOLD, 26), font(BOLD, 30)
    f_label, f_value = font(REGULAR, 24), font(BOLD, 26)
    f_foot = font(REGULAR, 20)

    # 상단 바 — 기관명
    d.rectangle([0, 0, WIDTH, BAR_H], fill=BAR)
    d.text((PAD, 32), item["brand"], font=f_brand, fill=INK)
    d.line([0, BAR_H, WIDTH, BAR_H], fill=LINE, width=2)

    y = BAR_H + 32
    d.text((PAD, y), item["title"], font=f_title, fill=INK)
    y += 64

    # ⚠️ **라벨 왼쪽 · 값 오른쪽.** 이 배치가 「짝짓기」 지표의 전제입니다 —
    #    한 행에서 둘이 멀리 떨어져 있어야 OCR 이 짝을 흘릴 여지가 생깁니다(12 §1)
    for f in fields:
        d.text((PAD, y + 16), f["label"], font=f_label, fill=DIM)
        w = d.textlength(f["value"], font=f_value)
        d.text((WIDTH - PAD - w, y + 14), f["value"], font=f_value, fill=INK)
        d.line([PAD, y + ROW_H - 4, WIDTH - PAD, y + ROW_H - 4], fill=LINE, width=1)
        y += ROW_H

    d.text((PAD, y + 20), "본 내역은 참고용입니다.", font=f_foot, fill=DIM)
    return img


def lowres(img: Image.Image, out: Path) -> None:
    """긴 변 720px 로 축소 · JPEG q80"""
    scale = 720 / max(img.size)
    small = img.resize((int(img.width * scale), int(img.height * scale)), Image.LANCZOS)
    small.save(out, quality=80)


def photo(img: Image.Image, out: Path) -> None:
    """1100px 확대 → 2.4도 회전 → 대각선 조명 → 블러 0.7 → JPEG q62.

    조명은 좌우로 밝기가 기우는 그라데이션입니다 — 실제로 화면을 찍으면 한쪽이
    밝고 반대쪽이 어둡습니다(12 §1.1).
    """
    scale = 1100 / max(img.size)
    big = img.resize((int(img.width * scale), int(img.height * scale)), Image.LANCZOS)
    big = big.rotate(2.4, resample=Image.BICUBIC, expand=True, fillcolor=BG)

    grad = Image.new("L", big.size)
    gd = ImageDraw.Draw(grad)
    for x in range(big.width):
        gd.line([(x, 0), (x, big.height)], fill=int(150 + 105 * (x / big.width)))
    lit = Image.composite(big, Image.new("RGB", big.size, (40, 40, 44)), grad)

    lit.filter(ImageFilter.GaussianBlur(0.7)).save(out, quality=62)


def main() -> int:
    if not REGULAR.exists():
        sys.exit(f"맑은 고딕이 없습니다: {REGULAR}\n"
                 "다른 글꼴로 그리면 12 의 조건이 아니게 됩니다 — 여기서 멈춥니다.")

    out_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "screens"
    items = json.loads((HERE / "eval-set.json").read_text(encoding="utf-8"))["items"]

    manifest = []
    for cond in ("clean", "lowres", "photo"):
        (out_dir / cond).mkdir(parents=True, exist_ok=True)

    for item in items:
        img = draw_screen(item)
        clean = out_dir / "clean" / f'{item["id"]}.png'
        img.save(clean)
        lowres(img, out_dir / "lowres" / f'{item["id"]}.jpg')
        photo(img, out_dir / "photo" / f'{item["id"]}.jpg')
        manifest.append({"id": item["id"], "ch": item["ch"], "screen": item["screen"],
                         "size": list(img.size), "fields": len(item["fields"])})
        print(f"  {item['id']}  {img.size[0]}x{img.size[1]}  칸 {len(item['fields'])}", flush=True)

    (out_dir / "manifest.json").write_text(
        json.dumps({"condition": "12 §1 절차로 다시 그림", "items": manifest},
                   ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n{len(manifest)}장 x 3조건 -> {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
