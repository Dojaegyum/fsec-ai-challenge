"""이미지에서 글자를 — EasyOCR + 좌표로 행 복원.

근거: docs/research/11-로컬OCR-PII인식-실측.md
      R-2 *"OCR 엔진은 EasyOCR + 좌표 행 복원. 최적 구성 누출 5.7% · 과차단 0"*
      R-3 *"`detail=0` 으로 부르지 않는다 — 엔진이 주는 좌표를 버리면 짝짓기가 무너진다"*

## 왜 행으로 묶나

EasyOCR 은 글자 덩어리를 조각조각 냅니다. `받는 분` 과 `김도현` 이 따로 나오면
**어느 항목의 값인지 알 수 없습니다.** 실측이 이걸 「짝짓기」로 따로 쟀고,
좌표로 같은 줄을 이으면 짝 유지가 살아난다고 적었습니다(§5.2).

**그래서 행 복원은 이 파일의 일입니다.** 조각이 몇 개로 나오는지는 엔진마다 다르고,
Tesseract 로 갈아끼우면 다른 처리가 필요합니다 — 엔진에 딸린 성질입니다.

**반대로 말풍선 좌·우를 화자로 가르는 것은 앱의 일입니다.** 그건 엔진을 바꿔도
안 바뀌는 판단입니다 → `src/modules/transcriber/transcribe.ts`.
"""

from __future__ import annotations

import os
from typing import Any

from .base import Progress


def _box(points: list[list[float]]) -> list[int]:
    """네 점을 `[x, y, width, height]` 로. **좌상단 기준 픽셀**입니다.

    앱의 `ImageAt` 가 이 단위를 못 박고 있습니다 — 제품마다 좌표 형식이 달라
    변환은 여기서 하고 앱 안쪽은 한 가지만 압니다.
    """
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    x, y = min(xs), min(ys)
    return [int(x), int(y), int(max(xs) - x), int(max(ys) - y)]


class EasyOcrReader:
    def __init__(self, *, device: str) -> None:
        import easyocr

        self.name = f"easyocr ko+en ({device})"
        self._reader = easyocr.Reader(["ko", "en"], gpu=(device != "cpu"))
        # 같은 줄로 볼 세로 겹침 비율.
        # ⬜ **정본에 없습니다.** 조각의 높이 대비 중심 차이로 재고, 기본값은
        # 실측 화면(글자 높이 40px 안팎)에서 고른 것입니다 — 실제 은행 앱으로
        # 다시 봐야 합니다(실측 P-01)
        self._row_ratio = float(os.environ.get("FINALLY_OCR_ROW_RATIO", "0.6"))

    def read(self, path: str, *, on_progress: Progress | None = None) -> dict[str, Any]:
        if on_progress:
            on_progress(10)

        # detail=1 — 좌표와 신뢰도를 함께 받습니다. 버리면 안 됩니다(R-3)
        found = self._reader.readtext(path, detail=1)
        if on_progress:
            on_progress(70)

        pieces = []
        for points, text, conf in found:
            t = (text or "").strip()
            if not t:
                continue
            pieces.append({"text": t, "box": _box(points), "confidence": float(conf)})

        lines = self._to_rows(pieces)
        if on_progress:
            on_progress(100)
        return {"engine": self.name, "lines": lines}

    def _to_rows(self, pieces: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """세로로 겹치는 조각을 한 줄로 잇는다. 가로 순서대로 붙인다."""
        if not pieces:
            return []

        rest = sorted(pieces, key=lambda p: (p["box"][1], p["box"][0]))
        rows: list[list[dict[str, Any]]] = []

        for piece in rest:
            x, y, _w, h = piece["box"]
            placed = False
            for row in rows:
                ry, rh = row[0]["box"][1], row[0]["box"][3]
                # 두 조각의 세로 중심이 글자 높이의 일정 비율 안에 있으면 같은 줄
                if abs((y + h / 2) - (ry + rh / 2)) <= max(h, rh) * self._row_ratio:
                    row.append(piece)
                    placed = True
                    break
            if not placed:
                rows.append([piece])

        out: list[dict[str, Any]] = []
        for row in rows:
            row.sort(key=lambda p: p["box"][0])
            xs = [p["box"][0] for p in row]
            ys = [p["box"][1] for p in row]
            x2 = max(p["box"][0] + p["box"][2] for p in row)
            y2 = max(p["box"][1] + p["box"][3] for p in row)
            out.append(
                {
                    "text": " ".join(p["text"] for p in row),
                    "box": [min(xs), min(ys), x2 - min(xs), y2 - min(ys)],
                    # 줄의 신뢰도는 **가장 낮은 조각**을 씁니다. 평균을 쓰면
                    # 한 조각만 의심스러운 줄이 멀쩡해 보입니다
                    "confidence": min(p["confidence"] for p in row),
                    # 조각을 그대로 남깁니다 — 확인 화면이 낱말 단위로 열리려면 필요합니다
                    "pieces": row,
                }
            )

        out.sort(key=lambda r: (r["box"][1], r["box"][0]))
        return out
