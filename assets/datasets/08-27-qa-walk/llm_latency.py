# -*- coding: utf-8 -*-
"""챗이 늦는 게 **모델 탓인지 배포 환경 탓인지** 가른다.

    python llm_latency.py [반복수]

`src/.env.local` 에서 열쇠·주소·모델 목록을 읽어, **이 컴퓨터에서** 같은
프롬프트를 후보마다 던지고 걸린 시간만 잽니다.

## 왜 이걸 재나

2026-08-27 배포 환경 실측: 챗 여섯 턴 중 **셋이 55초 예산을 다 써서 503**.
성공한 것도 7.3초 · 8.2초 · 17.9초 · 31.8초 · 48.1초로 널뛰었습니다.

    같은 프롬프트가 여기서도 느리면   → **모델 탓**    후보를 바꾼다
    여기서는 빠르면                  → **환경 탓**    나가는 길·리전을 본다

⛔ **열쇠를 찍지 않습니다.** 이 파일도 출력도 저장소에 열쇠를 남기지 않습니다.
⛔ 보내는 글은 **합성**입니다.
"""

from __future__ import annotations

import io
import json
import os
import sys
import time
import urllib.error
import urllib.request

REPEAT = int(sys.argv[1]) if len(sys.argv) > 1 else 3

HERE = os.path.dirname(os.path.abspath(__file__))
ENV = os.path.join(HERE, "..", "..", "..", "src", ".env.local")


def read_env() -> dict:
    out = {}
    for line in io.open(ENV, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        out[key.strip()] = value.strip().strip('"').strip("'")
    return out


# 실제 챗 프롬프트에 가깝게 — KB 조각과 사건 맥락이 실려 길어집니다.
# 정확한 본문이 아니라 **크기**를 맞추는 것이 목적입니다
FILLER = (
    "절차 항목: 112 에 신고합니다. 근거는 전기통신금융사기 피해 방지 및 피해금 환급에 "
    "관한 특별법 시행령 제3조입니다. 시행일 2024-01-01. 단계는 셋이고 필요한 산출물은 "
    "수사기관의 피해신고확인서입니다. 기한은 없습니다. 주의: 기대를 낮춰 잡으세요.\n"
)

SYSTEM = "너는 보이스피싱 피해자를 돕는 비서다. 아래 자료 안에서만 답한다.\n" + FILLER * 40
USER = "지금 뭘 먼저 해야 하나요?\n\n[사건 맥락]\n" + FILLER * 20


def once(base: str, key: str, model: str) -> tuple[str, float]:
    body = json.dumps(
        {
            "model": model,
            "temperature": 0,
            "messages": [
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": USER},
            ],
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        base.rstrip("/") + "/chat/completions",
        data=body,
        headers={"content-type": "application/json", "authorization": f"Bearer {key}"},
    )
    began = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=120) as res:
            res.read()
            return f"HTTP {res.status}", time.monotonic() - began
    except urllib.error.HTTPError as error:
        error.read()
        return f"HTTP {error.code}", time.monotonic() - began
    except Exception as error:
        return type(error).__name__, time.monotonic() - began


def main() -> None:
    env = read_env()
    key = env.get("LLM_API_KEY") or env.get("XAI_API_KEY")
    base = env.get("LLM_BASE_URL") or "https://api.x.ai/v1"
    models = [one.strip() for one in (env.get("LLM_MODEL") or "").split(",") if one.strip()]
    if not key or not models:
        print("열쇠나 모델 목록이 없습니다")
        raise SystemExit(1)

    print(f"보낸 글 {len(SYSTEM) + len(USER):,}자 · {REPEAT}회씩 · {base}")
    for model in models:
        took = []
        for _ in range(REPEAT):
            status, seconds = once(base, key, model)
            took.append((status, seconds))
        line = "  ".join(f"{s} {t:5.1f}s" for s, t in took)
        ok = [t for s, t in took if s == "HTTP 200"]
        worst = f"{max(ok):.1f}" if ok else "-"
        print(f"{model:26} {line}   최악 {worst}s")


if __name__ == "__main__":
    main()
