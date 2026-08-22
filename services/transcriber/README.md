# transcriber 서비스 — 모델을 돌리는 자리

앱(`src/`)은 **모델을 안 올립니다.** Vercel 서버리스 함수에 모델을 띄울 수 없기 때문입니다
→ [ADR-028](../../decisions/028-runtime-and-module-shape.md). 그래서 읽는 일만 여기로 뺐습니다.

| | |
| --- | --- |
| 무엇을 하나 | 녹음을 글로 · 이미지에서 글자를 |
| 무엇을 **안 하나** | 토큰화 · 화자 이름표 · 말풍선 좌우 판정 · 저장 |
| 짝 | `src/modules/transcriber/` (판단은 전부 그쪽) |
| 배치 | 개발은 빌린 GPU · **운영은 국내** (GPU 배치 결정 · 병합 대기) |

## 왜 판단을 앱에 두나

**제품을 바꾸면 바뀌는 것만 여기 둡니다.** 모델을 갈아끼우면 이 서비스는 바뀌지만
앱은 안 바뀝니다. 반대로 「먼저 말한 쪽이 A」나 「말풍선 좌우로 화자를 가른다」는
엔진과 무관한 판단이라 앱에 있습니다.

**토큰화는 특히 여기서 하지 않습니다.** 경계는 `pii-tokenizer` 하나이고,
여기가 두 번째 경계가 되면 우회할 자리가 둘이 됩니다
→ [PII 격리 경계](../../spec/common/08-14-pii-boundary.md).

## 띄우기

```bash
cd services/transcriber
python3 -m venv .venv
./.venv/bin/pip install -r requirements.txt

cd ..
./transcriber/.venv/bin/python -m uvicorn transcriber.app:app --port 8917
```

**모델 없이 바로 돕니다.** 기본이 `echo` 라 흐름 전체(업로드 → 접수 → 폴링 → 정규화 →
확인 화면)를 모델을 안 내려받고 시험할 수 있습니다. 결과에 `engine: "echo"` 가 붙어
**진짜로 읽은 것이 아님이 드러납니다.**

### 모델을 실제로 붙일 때

```bash
./.venv/bin/pip install -r requirements-models.txt
FINALLY_ENGINE=local ./.venv/bin/python -m uvicorn transcriber.app:app --port 8917
```

## 설정

| 환경변수 | 기본 | 무엇 |
| --- | --- | --- |
| `FINALLY_ENGINE` | `echo` | `echo` \| `local` |
| `FINALLY_DEVICE` | `cpu` | `cpu` \| `cuda` |
| `FINALLY_STT` | `medium` | 전사 모델 크기 |
| `FINALLY_COMPUTE` | `int8` | `int8`(CPU) \| `float16`(GPU) |
| `FINALLY_VAD` | `0` | 무음 건너뛰기 |
| `FINALLY_TOKEN` | (없음) | 앱만 부르게 하는 공유 비밀 |
| `FINALLY_MAX_BYTES` | 300MB | 내려받기 상한 → [API 계약](../../spec/common/08-14-api.md) §1.3 |

**CPU 에서 GPU 로 옮길 때 바꾸는 것은 두 줄입니다** — `FINALLY_DEVICE=cuda`,
`FINALLY_COMPUTE=float16`. 코드는 안 바뀝니다.

⚠️ **밖에 열어 둘 때는 `FINALLY_TOKEN` 을 반드시 채우세요.** 이 서비스는 넘겨받은
주소를 내려받으므로, 열어 두면 남의 심부름을 하게 됩니다.

## 계약

```
GET  /health              무엇이 붙어 있나
POST /jobs                { kind, url, mime_type?, vocabulary? } → 202 { job_id }
GET  /jobs/{job_id}       { status, percent, engine?, lines?, reason? }
```

**기다리지 않습니다.** 전사는 몇 분 걸리고 앱의 함수는 그렇게 오래 못 삽니다.
계약이 이미 폴링입니다 → [API 계약](../../spec/common/08-14-api.md) §3.2 §3.3.

**콜백이 아닌 이유 셋** — ① 폴링은 이미 계약에 있습니다 ② 콜백이면 밖에서 앱을 부르는
구멍을 뚫어야 하는데 지금은 **들어오는 구멍이 없습니다** ③ 요청이 올 때만 켜지는
방식이면 서비스가 죽었다 살아나는 사이 콜백이 유실됩니다.

**파일은 이쪽이 직접 내려받습니다.** 앱이 중계하면 함수 본문 한계에 걸립니다 —
업로드가 이미 그 이유로 브라우저에서 저장소로 직행합니다.
읽고 나면 **바로 지웁니다** — 보관은 객체 저장소가 하고 파기는 사건과 함께 일어납니다.

## 엔진 갈아끼우기

`engines/base.py` 의 모양을 구현하고 `engines/__init__.py` 에서 고르게 하면 됩니다.

| 지금 | 근거 |
| --- | --- |
| 전사 · faster-whisper **medium 이상** | [실측 09](../../docs/research/09-로컬모델-PII인식-실측.md) R-5 — base 는 숫자 20건 중 1~2건만 남깁니다 |
| 판독 · **EasyOCR + 좌표 행 복원** | [실측 11](../../docs/research/11-로컬OCR-PII인식-실측.md) R-2 — 누출 5.7% · 과차단 0 |
| 판독 · `detail=0` 금지 | 실측 11 R-3 — 좌표를 버리면 짝짓기가 무너집니다 |

## 아직 없는 것

| ⬜ | 무엇 |
| --- | --- |
| **화자 분리** | 두 실측 어디에도 없어 후보가 안 정해졌습니다. 지금은 `speaker` 를 안 채우고, 앱이 그 사실을 실어 냅니다 |
| **개인정보 탐지** | 실측은 Ollama 의 `gemma3:4b` 로 쟀습니다. 여기 붙일지 따로 둘지 미정 |
| **작업이 메모리에만 있음** | 다시 뜨면 사라집니다. 앱이 사건 상태를 들고 있어 다시 접수시키면 됩니다 |
| **GPU 실측** | CPU 값만 있습니다. 한 사건 48분 (GPU 배치 결정에 실측이 실려 있습니다) |
| **메모리 실사용량** | 모델 넷을 동시에 올렸을 때. 서버 크기가 여기서 정해집니다 |
