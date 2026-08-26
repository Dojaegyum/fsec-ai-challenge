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

import json
import unittest
import urllib.request
from typing import Any
from unittest import mock

from .engines import warm_all
from .engines.echo import EchoNer
from .engines.ollama_ner import OllamaNer, _names
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

    def test_미리_올리기가_있다(self) -> None:
        # 앱이 엔진을 안 가리고 부릅니다. 대역에 없으면 대역일 때만 뜨다 맙니다
        self.assertIsNone(EchoNer().warm())


class WarmingUpDoesNotSendText(unittest.TestCase):
    """**첫 요청이 통째로 실패하던 것을 없앤 자리** — 2026-08-27 RTX 4090.

    ```
    처음 한 번        60초 넘김 → 요청 타임아웃    ⛔
    내렸다가 다시     5.5초
    따뜻할 때         0.27~0.39초
    ```

    이름 찾기가 죽으면 앱은 슬롯 저장을 **503 으로 막습니다**(경계라서 못 가리면
    안 내보냅니다). 그래서 첫 적재를 사용자가 맞으면 **사건 진행이 멈춥니다.**
    """

    def _sent(self, call) -> dict[str, Any]:
        return json.loads(call.args[0].data.decode("utf-8"))

    def test_미리_올릴_때_글을_안_보낸다(self) -> None:
        # ⚠️ 이 길로 원문이 지나가면 안 됩니다 → 08-14-pii-boundary.md
        engine = OllamaNer(base_url="http://x", model="gemma3:4b")
        with mock.patch.object(urllib.request, "urlopen") as opened:
            opened.return_value = _Res({"done": True})
            engine.warm()

        body = self._sent(opened.call_args)
        self.assertEqual(body["model"], "gemma3:4b")
        self.assertNotIn("prompt", body)

    def test_미리_올리기는_요청보다_오래_기다린다(self) -> None:
        # 첫 적재가 60초를 넘겼습니다. 그렇다고 요청 쪽을 늘리면 **정말 죽었을 때**
        # 사용자가 몇 분을 기다립니다 — 긴 기다림은 뜰 때, 짧은 실패는 요청할 때
        engine = OllamaNer(base_url="http://x", model="m")
        with mock.patch.object(urllib.request, "urlopen") as opened:
            opened.return_value = _Res({"done": True})
            engine.warm()
        warm_timeout = opened.call_args.kwargs["timeout"]

        with mock.patch.object(urllib.request, "urlopen") as opened:
            opened.return_value = _Res({"response": '{"names": []}'})
            engine.find("여보세요")
        self.assertGreater(warm_timeout, opened.call_args.kwargs["timeout"])

    def test_요청마다_얼마나_둘지_함께_보낸다(self) -> None:
        # Ollama 기본이 5분이라, 안 보내면 그 사이 쉰 다음 사람이 5.5초를 맞습니다
        engine = OllamaNer(base_url="http://x", model="m", keep_alive="7m")
        with mock.patch.object(urllib.request, "urlopen") as opened:
            opened.return_value = _Res({"response": '{"names": ["김민수"]}'})
            got = engine.find("여보세요 김민수입니다")

        self.assertEqual(self._sent(opened.call_args)["keep_alive"], "7m")
        self.assertEqual([one["value"] for one in got["spans"]], ["김민수"])

    def test_안_내림은_글자가_아니라_숫자다(self) -> None:
        # ⛔ 문자열 "-1" 은 400 입니다 — `time: missing unit in duration "-1"`.
        # 환경변수는 전부 글자로 들어오니 이 시험이 없으면 **기본값이 그대로 400**
        engine = OllamaNer(base_url="http://x", model="m")  # 기본 -1
        with mock.patch.object(urllib.request, "urlopen") as opened:
            opened.return_value = _Res({"done": True})
            engine.warm()

        sent = self._sent(opened.call_args)["keep_alive"]
        self.assertIsInstance(sent, int)
        self.assertEqual(sent, -1)


class WarmUpLeavesNobodyOut(unittest.TestCase):
    """**빠졌던 것은 「부르는 쪽」이었습니다.**

    `OllamaNer.warm()` 이 아무리 옳아도 뜰 때 아무도 안 부르면 첫 사용자가 그
    60초를 맞습니다. 실제로 그렇게 빠져 있었으므로 **부르는 쪽에도 시험을 답니다.**
    """

    def _spy(self) -> tuple[list[str], dict[str, Any]]:
        touched: list[str] = []
        engine = mock.Mock()
        engine.warm.side_effect = lambda: touched.append("ner")
        return touched, {
            "stt": lambda: touched.append("stt"),
            "ocr": lambda: touched.append("ocr"),
            "ner": lambda: engine,
        }

    def test_모델을_쓸_때는_셋_다_올린다(self) -> None:
        touched, getters = self._spy()
        warm_all(_Cfg(is_echo=False), **getters)
        self.assertEqual(sorted(touched), ["ner", "ocr", "stt"])

    def test_대역일_때도_이름_찾기는_부른다(self) -> None:
        # 대역이면 아무것도 안 하지만, **부르는 것을 건너뛰지는 않습니다** —
        # 건너뛰면 `FINALLY_ENGINE` 을 local 로 바꾼 날 조용히 빠집니다
        touched, getters = self._spy()
        warm_all(_Cfg(is_echo=True), **getters)
        self.assertEqual(touched, ["ner"])


class _Cfg:
    """`warm_all` 이 보는 칸은 하나뿐입니다."""

    def __init__(self, *, is_echo: bool) -> None:
        self.is_echo = is_echo


class _Res:
    """`urlopen` 이 내주는 것 시늉 — 컨텍스트 매니저 하나면 됩니다."""

    def __init__(self, payload: dict[str, Any]) -> None:
        self._payload = payload

    def __enter__(self) -> _Res:
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def read(self) -> bytes:
        return json.dumps(self._payload).encode("utf-8")


if __name__ == "__main__":
    unittest.main()
