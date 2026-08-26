"""이름 찾기 — **모델에게 자릿수를 맡기지 않는다.**

정본: spec/common/08-14-api.md §1.2 의 `/ner` · src/lib/ner.ts
근거: docs/research/09 R-1 · R-2

## 왜 이 시험이 있나

언어모델은 문자 오프셋을 자주 틀리고, 한글에서는 더합니다. **틀린 오프셋은 값이
안 걸리는 것보다 나쁩니다** — 엉뚱한 자리를 가리고 진짜 이름은 그대로 내보냅니다.

그래서 모델에게는 「어떤 낱말이 이름인가」만 묻고 **위치는 코드가 찾습니다.**
아래는 그 코드가 지켜야 하는 것들입니다.

의존성 없이 돕니다:
    python -m unittest discover -s services/transcriber -t .
"""

from __future__ import annotations

import unittest

from .engines.echo import EchoNer
from .engines.ollama_ner import _names
from .engines.spans import MAX_NAME_LEN, locate


class LocateFindsEveryOccurrence(unittest.TestCase):
    def test_자리가_원문과_맞는다(self) -> None:
        text = "여보세요 김민수 수사관입니다"
        spans = locate(text, ["김민수"])

        self.assertEqual(len(spans), 1)
        one = spans[0]
        # **이것이 이 파일의 핵심입니다** — 자리가 원문과 안 맞으면
        # 엉뚱한 글자가 가려지고 진짜 이름이 그대로 나갑니다
        self.assertEqual(text[one["start"] : one["end"]], "김민수")
        self.assertEqual(one["label"], "PERSON")
        self.assertEqual(one["value"], "김민수")

    def test_같은_이름이_여러_번_나오면_전부_찾는다(self) -> None:
        # 앞의 하나만 가리면 뒤엣것이 그대로 나갑니다
        text = "김민수 수사관입니다 … 김민수 씨 맞으시죠"
        spans = locate(text, ["김민수"])

        self.assertEqual(len(spans), 2)
        for one in spans:
            self.assertEqual(text[one["start"] : one["end"]], "김민수")

    def test_자리_순서대로_낸다(self) -> None:
        text = "박서준 님과 김민수 님"
        spans = locate(text, ["김민수", "박서준"])
        self.assertEqual([one["value"] for one in spans], ["박서준", "김민수"])

    def test_겹치는_자리는_한_번만(self) -> None:
        # 「김민수」와 「민수」를 함께 받으면 뒤엣것이 앞의 안쪽입니다.
        # 두 번 가리면 토큰 번호가 어긋나 **복원이 엉뚱한 값을 되살립니다**
        text = "김민수 님"
        spans = locate(text, ["김민수", "민수"])
        self.assertEqual(len(spans), 1)
        self.assertEqual(spans[0]["value"], "김민수")


class LocateRefusesWhatItCannotPlace(unittest.TestCase):
    def test_원문에_없는_낱말은_버린다(self) -> None:
        # 모델이 글자를 다듬어 내놓는 일이 있습니다(`김민수씨` → `김민수 씨`).
        # 비슷한 자리를 짐작해 가리면 엉뚱한 곳을 가립니다
        self.assertEqual(locate("여보세요", ["김민수"]), [])

    def test_문장을_통째로_집으면_버린다(self) -> None:
        # 그대로 두면 **말 전체가 토큰 하나로** 바뀌어 사건 내용이 사라집니다
        long = "가" * (MAX_NAME_LEN + 1)
        self.assertEqual(locate(long, [long]), [])

    def test_빈_값과_문자열이_아닌_것을_버린다(self) -> None:
        self.assertEqual(locate("김민수", ["", "   ", None, 3]), [])  # type: ignore[list-item]


class ModelReplyIsParsedStrictly(unittest.TestCase):
    def test_이름_배열을_꺼낸다(self) -> None:
        self.assertEqual(_names('{"names": ["김민수", "박서준"]}'), ["김민수", "박서준"])

    def test_빈_배열은_정상이다(self) -> None:
        self.assertEqual(_names('{"names": []}'), [])

    def test_문자열이_아닌_조각은_버린다(self) -> None:
        self.assertEqual(_names('{"names": ["김민수", 7, null]}'), ["김민수"])

    # **모양이 아니면 던집니다.** 빈 목록으로 내려가면 앱이 「이름은 없었다」로
    # 읽습니다 — 모델이 형식을 못 지킨 것과 이름이 없는 것은 다른 일입니다
    def test_JSON_이_아니면_던진다(self) -> None:
        with self.assertRaises(RuntimeError):
            _names("이름이 없습니다")

    def test_names_가_없으면_던진다(self) -> None:
        with self.assertRaises(RuntimeError):
            _names('{"people": ["김민수"]}')

    def test_names_가_배열이_아니면_던진다(self) -> None:
        with self.assertRaises(RuntimeError):
            _names('{"names": "김민수"}')


class EchoTellsThatItIsEcho(unittest.TestCase):
    def test_대역임을_응답에_남긴다(self) -> None:
        # 「모델이 없다」와 「아무 이름도 없다」가 같은 모양이 되면 안 됩니다
        got = EchoNer().find("김민수 수사관입니다")
        self.assertEqual(got["engine"], "echo")
        self.assertEqual([one["value"] for one in got["spans"]], ["김민수"])

    def test_모르는_이름은_못_찾는다(self) -> None:
        # 대역은 경계가 아닙니다. 그 사실이 이 시험으로 남습니다
        self.assertEqual(EchoNer().find("여보세요 홍길동입니다")["spans"], [])


if __name__ == "__main__":
    unittest.main()
