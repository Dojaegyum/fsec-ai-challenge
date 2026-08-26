# OCR GPU 실측 — 측정 원본

2026-08-26 측정. **우리가 직접 만들고 직접 잰 데이터**입니다(외부에서 받은 자산 아님).

| 읽을 것 | 어디 |
| --- | --- |
| **결론·발견·권고** | [docs/research/16-OCR-GPU-실측.md](../../../docs/research/16-OCR-GPU-실측.md) |
| 앞선 CPU 측정 | [11](../../../docs/research/11-로컬OCR-PII인식-실측.md) · [12](../../../docs/research/12-OCR-실측-방법론.md) |
| 전사 쪽 짝 | [15-STT-GPU-실측.md](../../../docs/research/15-STT-GPU-실측.md) · [08-25-stt-gpu/](../08-25-stt-gpu/) |
| 하네스 | [services/transcriber/bench_ocr.py](../../../services/transcriber/bench_ocr.py) |

## 파일

| 파일 | 무엇 |
| --- | --- |
| `results-ocr.json` | 네 조건의 결과. **화면별 읽어낸 글 전문** 포함 |

**평가셋과 화면은 여기 없습니다.** [08-21-local-ocr-pii/](../08-21-local-ocr-pii/) 의
`eval-set.json` 을 그대로 썼고, 화면은 같은 폴더의 `screens/` 에 있습니다 —
[make_screens.py](../08-21-local-ocr-pii/make_screens.py) 로 그린 것입니다.

## 조건 넷

| | 장치 | 열화 | 무엇을 가르나 |
| --- | --- | --- | --- |
| `C1` | cpu | clean | 기준선 |
| `G1` | cuda | clean | **`C1` 과 장치만 다름** — GPU 의 몫 |
| `G2` | cuda | lowres | 열화가 속도에 영향을 주나 |
| `G3` | cuda | photo | 가장 나쁜 조건 |

## ⚠️ 셋

**① 전부 합성입니다.** 계좌·주민번호·전화·이름은 실존하지 않는 임의값이고, 화면도
Pillow 로 그린 것입니다 → [ADR-043](../../../decisions/043-gpu-hosting.md).

**② `C1` 의 CPU 값을 [ADR-043](../../../decisions/043-gpu-hosting.md) 의 「장당 87초」와
곧바로 잇지 마세요.** 이 팟의 CPU 가 128코어라 4.76초가 나왔습니다. **37배는 이
기계 안에서의 장치 차이**이고 실제 배포 CPU 기준으로는 더 큽니다 → 16 §2.

**③ [11](../../../docs/research/11-로컬OCR-PII인식-실측.md) 의 절대값과 나란히 놓지
마세요.** 화면을 12 §1 절차로 **다시 그린 것**이라 픽셀 단위로 같지 않고, 채점도
「값이 살아남았나」만 봅니다(11 의 짝짓기·자형 혼동은 안 쟀습니다).

## 측정 환경

```
RunPod SECURE · RTX 4090 24GB · 호스트 CUDA 13.0 · CPU 128코어
EasyOCR ko+en · torch 2.8.0+cu128 · detail=1 + 좌표 행 복원
엔진은 services/transcriber/engines/easyocr_reader.py 를 그대로 부릅니다
```
