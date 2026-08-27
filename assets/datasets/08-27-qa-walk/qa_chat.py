# -*- coding: utf-8 -*-
"""챗 한 턴이 실제로 도나 — 그리고 **근거를 달고 오나**.

    python qa_chat.py [주소] [보고서파일]

## 무엇을 보나 — 셋

| | |
| --- | --- |
| **돈다** | `POST …/messages` 가 200 으로 답하나. 모델을 부르는 가장 비싼 경로입니다 |
| **근거** | 답에 KB 인용이 붙나. 안 붙으면 되묻기로 가야 합니다 |
| **경계** | 내가 쓴 계좌번호가 **토큰으로** 바뀌어 나가나 → 불변 규칙 2 |

⚠️ **콘솔에 한국어를 찍지 않습니다.** Windows 콘솔이 cp949 라 깨지고, 그러다
UnicodeEncodeError 로 도구가 죽습니다 — 결과는 UTF-8 파일에 씁니다.

⛔ 보내는 문장은 **합성**입니다. 실제 피해자 진술을 넣지 마세요.
"""

from __future__ import annotations

import io
import json
import sys
import time
import urllib.error
import urllib.request

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3311").rstrip("/")
REPORT = sys.argv[2] if len(sys.argv) > 2 else "chat-report.txt"

# 슬롯을 먼저 채워 둡니다 — 유형을 모르면 챗이 공통 절차만 인용합니다
SLOTS = [
    ("transferred", "네"),
    ("channel", "시중은행 계좌이체"),
    ("org_name", "KB국민은행"),
]

ACCOUNT = "110-234-567890"
TURNS = [
    "지금 뭘 먼저 해야 하나요?",
    f"제 계좌는 {ACCOUNT} 인데 이걸 알려줘야 하나요?",
    "돈은 언제쯤 돌려받을 수 있나요?",
]

# 넷째 인자로 질문 목록(JSON 배열 파일)을 주면 위 셋을 대신합니다
if len(sys.argv) > 3:
    TURNS = json.loads(io.open(sys.argv[3], encoding="utf-8").read())

OUT: list[str] = []


def say(line: str = "") -> None:
    OUT.append(line)


def call(method: str, path: str, body: dict | None = None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(
        BASE + path, data=data, method=method, headers={"content-type": "application/json"}
    )
    began = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=180) as res:
            return res.status, json.loads(res.read().decode("utf-8")), time.monotonic() - began
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", "replace")
        try:
            return error.code, json.loads(raw), time.monotonic() - began
        except Exception:
            return error.code, {"raw": raw[:400]}, time.monotonic() - began


def main() -> None:
    st, case, _ = call("POST", "/api/cases", {"track": "victim"})
    if st != 201:
        say(f"[X] 사건을 못 만듭니다 {st} {json.dumps(case, ensure_ascii=False)[:300]}")
        flush()
        raise SystemExit(1)
    token = case["link_token"]
    say(f"① 사건            {st}  {token}")

    for key, value in SLOTS:
        s, _, _ = call("PATCH", f"/api/cases/{token}/slots/{key}", {"action": "answer", "value": value})
        say(f"   슬롯 {key:12} {s}")

    ok = 0
    for n, content in enumerate(TURNS, start=1):
        st, body, took = call("POST", f"/api/cases/{token}/messages", {"content": content})
        say("")
        say(f"③-{n} ({took:.1f}초 · {st})  「{content}」")
        whole = json.dumps(body, ensure_ascii=False, indent=2)
        if st != 200:
            say(f"      [X] {whole[:900]}")
            continue
        ok += 1
        say(f"      키   {sorted(body.keys())}")
        say(whole[:2400])
        # **내가 쓴 계좌번호가 그대로 돌아오면 안 됩니다**
        if ACCOUNT in whole:
            say("      [!] 계좌번호가 응답에 그대로 있습니다 — 경계를 봐야 합니다")

    st, msgs, _ = call("GET", f"/api/cases/{token}/messages")
    rows = (msgs.get("messages") if isinstance(msgs, dict) else msgs) or []
    say("")
    say(f"④ 대화 이력       {st}  {len(rows)}건")
    for one in rows[:8]:
        if not isinstance(one, dict):
            say(f"      {str(one)[:80]}")
            continue
        role = one.get("role") or one.get("sender") or "?"
        text = str(one.get("content") or one.get("text") or "")[:70]
        say(f"      {role:10} {text}")

    say("")
    say(f"{ok}/{len(TURNS)} 턴이 돌았습니다")
    flush()


def flush() -> None:
    io.open(REPORT, "w", encoding="utf-8", newline="\n").write("\n".join(OUT) + "\n")
    print(f"wrote {REPORT} ({len(OUT)} lines)")


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as error:  # 죽어도 여기까지 쓴 것은 남깁니다
        say(f"[X] {type(error).__name__}: {error}")
        flush()
        raise
