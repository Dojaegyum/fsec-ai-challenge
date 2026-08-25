# STT GPU 실측 — 측정 원본

2026-08-25 측정. **우리가 직접 만들고 직접 잰 데이터**입니다(외부에서 받은 자산 아님).

| 읽을 것 | 어디 |
| --- | --- |
| **결론·발견·권고** | [docs/research/15-STT-GPU-실측.md](../../../docs/research/15-STT-GPU-실측.md) |
| 앞선 CPU 측정 | [docs/research/14-STT-전처리-실측.md](../../../docs/research/14-STT-전처리-실측.md) · [08-25-stt-preprocess/](../08-25-stt-preprocess/) |
| 평가셋 설계·채점 규칙의 뿌리 | [docs/research/10-PII인식-실측-방법론.md](../../../docs/research/10-PII인식-실측-방법론.md) |
| 하네스 | [services/transcriber/bench_stt.py](../../../services/transcriber/bench_stt.py) |

## 파일

| 파일 | 무엇 | 만든 것 |
| --- | --- | --- |
| `results-gpu.json` | 발화 40개를 **하나씩** 옮긴 네 조건(`E`~`H`). 발화별 전사문 전문 포함 | `services/transcriber/bench_stt.py` |
| `results-long.json` | 40개를 이어붙인 **6.8분 하나**에서 배치를 벗겨 본 여섯 조건 × 모델 둘 | `long_bench.py` |
| `results-repeat.json` | 같은 조건 3회 반복 — 흔들림 폭 | `repeat_bench.py` |
| `results-ship.json` | 실제로 붙일 조합(배치 + 낱말 시각) 3회 | `ship_bench.py` |
| `results-notation.json` | **보존 · 자리표기 변형 · 소실** 셋으로 가른 것 → [15 §6](../../../docs/research/15-STT-GPU-실측.md) | `notation.py` |

**음성과 평가셋은 여기 없습니다.** [08-25-stt-preprocess](../08-25-stt-preprocess/)
의 `make_audio.py` 로 만든 것과 [08-21-local-llm-pii/eval-set.json](../08-21-local-llm-pii/eval-set.json)
을 그대로 썼습니다 — 40발화 · `pii` 33건 · `keep` 80건.

`long_bench.py` 셋은 경로가 `/poc` 로 박혀 있습니다. POC 팟에서 돌린 그대로 남깁니다.
**`notation.py` 만 저장소 경로로 돕니다** — GPU 없이 저장된 전사문만 보기 때문입니다.

`notation.py` 는 **참조 구현이지 정본이 아닙니다.** 실제로 붙일 자리는 `pii-tokenizer`
앞이고 그 모듈은 아직 없습니다 → [ADR-052](../../../decisions/052-stt-configuration.md).

## ⚠️ 셋

**① 전부 합성입니다.** 계좌·주민번호·전화·이름은 실존하지 않는 임의값이고 실제
피해자 음성이 아닙니다 → [ADR-043](../../../decisions/043-gpu-hosting.md).

**② `results-long.json` 의 채점을 `results-gpu.json` 과 나란히 놓지 마세요.**
긴 쪽은 이어붙인 전사문 **전체**에 값이 남아 있는지로 셉니다 — 다른 발화 자리에서
우연히 맞아도 삽니다. 각 파일 **안에서** 조건끼리는 비교됩니다.

**③ 「실시간 배수」보다 `wall_seconds` 를 보세요.** 14 의 함정이 여기서도 같습니다.

## 측정 환경

```
RunPod 커뮤니티 · RTX 4090 24GB · 드라이버 570.133.20 · $0.34/시간
faster-whisper 1.2.1 · CTranslate2 4.8.1 · compute_type=float16
모델은 (이름·장치·정밀도)마다 한 번만 적재
```
