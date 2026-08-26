"""모델이 낸 **낱말**을 원문의 **자리**로 바꾼다.

정본: src/modules/pii-tokenizer/types.ts (`NerSpan`) · spec/common/08-14-api.md §1.2
근거: docs/research/09 R-1

## 왜 이 파일이 따로 있나

**언어모델에게 문자 오프셋을 세게 하면 안 됩니다.** 자주 틀리고 한글에서는 더합니다.
틀린 오프셋은 값이 안 걸리는 것보다 나쁩니다 — **엉뚱한 자리를 가리고 진짜 이름은
그대로 내보냅니다.**

그래서 모델에게는 「어떤 낱말이 사람 이름인가」만 묻고, **위치는 코드가 찾습니다.**
이 파일이 그 일만 합니다. 모델을 갈아끼워도 여기는 안 바뀝니다.

## 한 낱말이 여러 번 나오면 전부 찾습니다

`"김민수 수사관입니다 … 김민수 씨"` 에서 앞의 하나만 가리면 뒤엣것이 그대로
나갑니다. **겹치지 않게, 나오는 자리마다** 냅니다.
"""

from __future__ import annotations

from typing import Any

# 모델이 이 길이를 넘겨 주면 이름이 아닙니다 — 문장을 통째로 집은 것입니다.
# 그대로 두면 **말 전체가 토큰 하나로 바뀌어** 사건 내용이 사라집니다
MAX_NAME_LEN = 20


def locate(text: str, words: list[str], *, label: str = "PERSON") -> list[dict[str, Any]]:
    """낱말 목록을 자리 목록으로. **원문에 없는 낱말은 버립니다.**

    모델이 글자를 다듬어 내놓는 일이 있습니다(`김민수씨` → `김민수 씨`).
    **그때는 못 찾은 것으로 둡니다** — 비슷한 자리를 짐작해 가리면 엉뚱한 곳을
    가립니다. 못 찾은 것은 1차 정규식과 사용자 확인이 받습니다.
    """
    spans: list[dict[str, Any]] = []
    taken: list[tuple[int, int]] = []

    for raw in words:
        word = raw.strip() if isinstance(raw, str) else ""
        if not word or len(word) > MAX_NAME_LEN:
            continue

        start = text.find(word)
        while start != -1:
            end = start + len(word)
            # 이미 잡은 자리와 겹치면 건너뜁니다 — 같은 글자를 두 번 가리면
            # 토큰 번호가 어긋나 **복원이 엉뚱한 값을 되살립니다**
            if not any(s < end and start < e for s, e in taken):
                taken.append((start, end))
                spans.append({"label": label, "start": start, "end": end, "value": word})
            start = text.find(word, start + 1)

    spans.sort(key=lambda one: one["start"])
    return spans
