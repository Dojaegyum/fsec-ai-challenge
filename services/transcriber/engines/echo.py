"""모델 없이 도는 대역 — **붙기 전에도 흐름 전체를 시험할 수 있게.**

모델을 내려받는 데만 몇 GB 가 걸립니다. 그 전에 업로드·작업 접수·폴링·정규화·
확인 화면까지 이어 보려면 **무언가는 돌려줘야** 합니다.

**빈 결과를 돌려주지 않습니다.** 그러면 「모델이 없다」와 「아무것도 안 들렸다」가
같은 모양이 되어, 화면이 왜 비었는지 아무도 모릅니다 — 앱 쪽 `not-configured.ts`
가 *"조용히 빈 배열을 돌려주면 며칠 뒤에야 누가 알아챕니다"* 라고 적은 것과 같은 이유입니다.

**대신 이 엔진은 자기 이름을 밝힙니다.** 결과에 `engine: "echo"` 가 붙으므로
화면과 감사 기록에서 「진짜로 읽은 것이 아니다」를 구분할 수 있습니다.
"""

from __future__ import annotations

import os
from typing import Any

from .base import Progress

# 흐름을 시험하려면 **가릴 것이 있어야** 합니다. 아래 값은 전부 실존하지 않는
# 임의값입니다 — 실측 평가셋과 같은 규칙입니다 → docs/research/09 §2.1
_AUDIO_LINES = [
    {
        "text": "여보세요 금융감독원 김민수 수사관입니다",
        "speaker": "S0",
        "speakerConfidence": 0.91,
        "startMs": 0,
        "endMs": 2400,
        "confidence": 0.88,
        "pieces": [
            {"text": "여보세요", "startMs": 0, "endMs": 700, "confidence": 0.94},
            {"text": "금융감독원", "startMs": 800, "endMs": 1500, "confidence": 0.71},
            {"text": "김민수", "startMs": 1600, "endMs": 2000, "confidence": 0.62},
            {"text": "수사관입니다", "startMs": 2000, "endMs": 2400, "confidence": 0.85},
        ],
    },
    {
        "text": "네 맞는데요 무슨 일이시죠",
        "speaker": "S1",
        "speakerConfidence": 0.88,
        "startMs": 2900,
        "endMs": 4600,
        "confidence": 0.9,
        "pieces": [
            {"text": "네", "startMs": 2900, "endMs": 3100, "confidence": 0.96},
            {"text": "맞는데요", "startMs": 3100, "endMs": 3800, "confidence": 0.89},
            {"text": "무슨", "startMs": 3900, "endMs": 4200, "confidence": 0.92},
            {"text": "일이시죠", "startMs": 4200, "endMs": 4600, "confidence": 0.87},
        ],
    },
    {
        "text": "신한은행 110에 234-56만 7,890개자로 850만원을 이체하세요",
        "speaker": "S0",
        "speakerConfidence": 0.93,
        "startMs": 5200,
        "endMs": 9800,
        "confidence": 0.64,
        "pieces": [
            {"text": "신한은행", "startMs": 5200, "endMs": 5900, "confidence": 0.77},
            {"text": "110에", "startMs": 6000, "endMs": 6400, "confidence": 0.41},
            {"text": "234-56만", "startMs": 6400, "endMs": 7100, "confidence": 0.38},
            {"text": "7,890개자로", "startMs": 7100, "endMs": 7900, "confidence": 0.35},
            {"text": "850만원을", "startMs": 8000, "endMs": 8900, "confidence": 0.82},
            {"text": "이체하세요", "startMs": 8900, "endMs": 9800, "confidence": 0.9},
        ],
    },
]

# 말풍선 좌·우가 갈리는 캡처. 앱의 좌표 규칙이 실제로 도는지 보려는 것입니다
_IMAGE_LINES = [
    {"text": "안녕하세요 고객님", "box": [48, 120, 260, 44], "confidence": 0.93},
    {"text": "네 누구세요", "box": [700, 190, 190, 44], "confidence": 0.9},
    {"text": "계좌 302-0987-6 543-21", "box": [48, 260, 380, 44], "confidence": 0.58},
    {"text": "확인해볼게요", "box": [700, 330, 210, 44], "confidence": 0.91},
]


class EchoStt:
    name = "echo"

    def transcribe(
        self,
        path: str,
        *,
        vocabulary: list[str] | None = None,
        on_progress: Progress | None = None,
    ) -> dict[str, Any]:
        del path, vocabulary
        if on_progress:
            on_progress(100)
        return {"engine": "echo", "lines": _AUDIO_LINES}


class EchoOcr:
    name = "echo"

    def read(self, path: str, *, on_progress: Progress | None = None) -> dict[str, Any]:
        del path
        if on_progress:
            on_progress(100)
        return {"engine": "echo", "lines": _IMAGE_LINES}


class EchoNer:
    """모델 없이 이름을 찾는 대역 — **모양만 맞춰 흐름을 이어 줍니다.**

    ⚠️ **경계가 아닙니다.** 아래 목록에 없는 이름은 못 찾습니다. `engine` 에
    `echo` 가 실리므로 **진짜로 판정한 것이 아니라는 사실이 응답에 남습니다** —
    STT·OCR 대역과 같은 규칙입니다.

    이 이름들은 `_AUDIO_LINES`·평가셋에 나오는 것과 같은 임의값입니다.
    """

    name = "echo"

    # 실측 평가셋에 나오는 이름들 → docs/research/09 §2.1
    KNOWN = ["김민수", "김도현", "이정훈", "박서준", "최유진"]

    def find(self, text: str) -> dict[str, Any]:
        from .spans import locate

        return {"engine": "echo", "spans": locate(text, list(self.KNOWN))}


def enabled() -> bool:
    """대역으로 돌고 있는가. 설정 현황과 응답에 그대로 실립니다."""
    return os.environ.get("FINALLY_ENGINE", "echo") == "echo"
