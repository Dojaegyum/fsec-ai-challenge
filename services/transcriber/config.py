"""환경변수 하나로 무엇을 쓸지 정합니다 — **코드를 안 고치고 갈아끼우려고.**

근거: ADR-043(개발은 빌린 GPU · 운영은 국내) · ADR-028(자원은 밖에서 받는다)

```
FINALLY_ENGINE   echo | local          무엇으로 읽나. 기본은 echo (모델 없이 돎)
FINALLY_DEVICE   cpu | cuda            어디서 돌리나. 기본 cpu
FINALLY_STT      medium | large-v3 …   전사 모델 크기
FINALLY_COMPUTE  int8 | float16        정밀도. CPU 면 int8, GPU 면 float16
FINALLY_NER      gemma3:4b …           사람 이름을 찾는 모델 (Ollama)
FINALLY_OLLAMA   기본 127.0.0.1:11434   그 모델이 도는 자리
FINALLY_TOKEN    (없으면 인증 안 함)      앱만 부를 수 있게 하는 공유 비밀
FINALLY_WORKDIR  기본 ./.work           내려받은 파일을 두는 자리
```

**CPU 에서 GPU 로 옮길 때 바꾸는 것은 두 줄입니다** — `FINALLY_DEVICE=cuda`,
`FINALLY_COMPUTE=float16`. 코드는 안 바뀝니다.

⚠️ **`FINALLY_COMPUTE=int8` 은 CPU 에서만 쓰세요.** GPU 에서 int8 은 빨라지지도
않으면서 정확도만 떨어집니다 — 앞선 조사에서 확인된 값입니다. GPU 를 붙이면
`float16` 으로 두세요.
"""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    engine: str
    device: str
    stt_model: str
    compute_type: str
    # 사람 이름을 찾는 모델과 그것이 도는 자리 → docs/research/09 R-1
    ner_model: str
    ollama_url: str
    token: str | None
    workdir: str
    # 내려받을 파일의 상한. 사건당 상한이 300MB 라 그보다 크면 애초에 못 올라옵니다
    # → spec/common/08-14-api.md §1.3
    max_bytes: int

    @property
    def is_echo(self) -> bool:
        return self.engine == "echo"


def load() -> Config:
    return Config(
        engine=os.environ.get("FINALLY_ENGINE", "echo"),
        device=os.environ.get("FINALLY_DEVICE", "cpu"),
        # 실측 권고 R-5 — base 는 숫자 20건 중 1~2건만 남겨 파이프라인이 무너집니다
        # → docs/research/09 §5.1
        stt_model=os.environ.get("FINALLY_STT", "medium"),
        compute_type=os.environ.get("FINALLY_COMPUTE", "int8"),
        # 실측 R-1 — gemma3:4b + 정규식 + 허용목록이 누출 0%·과차단 0%
        # → docs/research/09 §3. qwen3:4b 도 같은 자리에서 재 봤습니다
        ner_model=os.environ.get("FINALLY_NER", "gemma3:4b"),
        ollama_url=os.environ.get("FINALLY_OLLAMA", "http://127.0.0.1:11434"),
        token=os.environ.get("FINALLY_TOKEN") or None,
        workdir=os.environ.get("FINALLY_WORKDIR", "./.work"),
        max_bytes=int(os.environ.get("FINALLY_MAX_BYTES", 300 * 1024 * 1024)),
    )
