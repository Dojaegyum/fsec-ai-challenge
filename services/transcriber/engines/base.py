"""엔진이 지켜야 하는 모양 — **이걸 구현하면 갈아끼워집니다.**

정본: spec/common/08-14-api.md §3.3 (전사 결과가 화면으로 나가는 모양)
      src/modules/transcriber/types.ts (`EngineLine` · `EngineOutput`)
근거: ADR-028(모듈은 자원을 인터페이스로 받는다) · ADR-043(GPU 배치)

## 왜 인터페이스를 먼저 두나

제품이 아직 안 정해졌습니다. 실측이 후보를 좁혀 주긴 했지만
(음성은 faster-whisper medium 이상, 이미지는 EasyOCR + 좌표 복원),
**GPU 를 붙이면 다시 볼 값들입니다** → docs/research/09 · 11.

그래서 앱 쪽이 이미 하고 있는 것을 여기서도 합니다 — **자리를 인터페이스로 두고
구현을 갈아끼웁니다.** 엔진을 바꿔도 HTTP 계약과 앱 코드는 안 바뀝니다.

## 내놓는 모양이 앱의 타입과 같아야 합니다

여기서 내는 `dict` 는 `src/modules/transcriber/types.ts` 의 `EngineOutput` 으로
그대로 들어갑니다. **칸 이름을 바꾸면 앱이 조용히 못 읽습니다** — 그쪽이
못 읽은 줄을 버리고 세기만 하기 때문입니다(`dropped`).
"""

from __future__ import annotations

from typing import Any, Callable, Protocol

# 진행률을 알리는 자리. 0~100
Progress = Callable[[int], None]


class SttEngine(Protocol):
    """음성을 글로 옮긴다. 화자 분리를 함께 하면 `speaker` 를 채운다."""

    name: str

    def transcribe(
        self,
        path: str,
        *,
        vocabulary: list[str] | None = None,
        on_progress: Progress | None = None,
    ) -> dict[str, Any]:
        """`{"engine": str, "lines": [...]}` 를 낸다.

        `lines[]` 한 줄의 칸 — 전부 선택이고, **없으면 넣지 않는다**:

        | 칸 | 뜻 |
        | --- | --- |
        | `text` | 읽은 글자. **다듬지 않는다** |
        | `speaker` | 화자 구분값. 무엇이든 됨 — 앱이 A·B 로 다시 붙인다 |
        | `speakerConfidence` | 이 화자가 맞나. 0~1 |
        | `startMs` `endMs` | 원본의 어디인가. 밀리초 |
        | `confidence` | 판독 신뢰도. 0~1 |
        | `pieces` | 낱말 단위. `text`·`startMs`·`endMs`·`confidence` |

        **`pieces` 가 ADR-038 의 확인 화면을 여는 재료입니다.** 낱말마다 신뢰도가
        없으면 그 화면이 줄 단위로만 열립니다.
        """
        ...


class OcrEngine(Protocol):
    """이미지에서 글자를 읽는다. **좌표를 버리지 않는다.**"""

    name: str

    def read(
        self,
        path: str,
        *,
        on_progress: Progress | None = None,
    ) -> dict[str, Any]:
        """`{"engine": str, "lines": [...]}` 를 낸다.

        음성과 같은 모양이되 자리가 `box` 입니다 — `[x, y, width, height]`,
        **좌상단 기준 픽셀**.

        ⚠️ **좌표를 버리면 안 됩니다.** 실측 권고 R-3 이 *"`detail=0` 으로 부르지
        않는다 — 엔진이 주는 좌표를 버리면 짝짓기가 무너진다"* 라고 못 박았습니다.
        `받는 분 = 김도현` 이 한 줄에 붙어 있어야 슬롯을 뽑을 수 있습니다
        → docs/research/11 §5.2.
        """
        ...
