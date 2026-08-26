# STT 무음 건너뛰기·배치 실측 — 측정 원본

2026-08-26 측정. **우리가 직접 만들고 직접 잰 데이터**입니다.

[14](../../../docs/research/14-STT-전처리-실측.md) 가 「무음 건너뛰기는 속도로 켤 이유가
없다(0.4%)」로, [15](../../../docs/research/15-STT-GPU-실측.md) §8 이 「배치가 `keep` 을 왜
좋게 만들었나 — **직접 확인한 것이 아닙니다**」로 남긴 두 자리를 이어서 잰 것입니다.

**아직 연구 문서가 없습니다.** 14·15 에 이어 붙일지 새 번호로 갈지 미정입니다.

## 무엇을 재려 한 것인가

14 의 측정은 **10~31초짜리 발화 40개를 따로따로** 잰 것입니다. 그 클립들이 전부
whisper 30초 창 하나 안에 들어가서(최소 5.88초·최대 24.89초), **창을 넘겨 다니는
실제 통화의 모양을 한 번도 재지 않았습니다.**

그래서 **이어붙인 긴 녹음 하나**로 다시 쟀습니다. 14 가 만든 `gap` 세트(침묵 37%)를
이어붙인 10.8분짜리입니다.

## 파일

| 파일 | 무엇 | 만든 것 |
| --- | --- | --- |
| `results-vad-cpu.json` | CPU · `medium` · 무음 건너뛰기 on/off. 침묵 세트와 무침묵 세트 | `vad_cpu_bench.py` |
| `results-vad-followup.json` | 같은 조건 되풀이 + 문맥 이어받기를 끈 조건 | `vad_followup.py` |
| `transcripts-vad.json` | **세그먼트 전문**(시각·신뢰도·압축비 포함). 붕괴를 눈으로 보는 자료 | `capture_text.py` |
| `results-gpu-vad.json` | GPU · 모델 둘 × 무음 건너뛰기 × 배치, 14조건 | `gpu_bench.py` |
| `mkpod.py` | 벤치용 팟을 띄우는 최소 스크립트 → [runpod-bench](../../../deploy/runpod-bench.md) | — |

**음성과 평가셋은 여기 없습니다.** [08-25-stt-preprocess](../08-25-stt-preprocess/) 의
`make_audio.py` 로 만든 것과 [08-21-local-llm-pii/eval-set.json](../08-21-local-llm-pii/eval-set.json)
을 그대로 썼습니다 — 40발화 · `pii` 33건 · `keep` 80건. 채점도
[bench_stt.py](../../../services/transcriber/bench_stt.py) 의 `score()` 를 그대로 씁니다.

## ⚠️ 넷

**① 절대 초를 14·15 의 표와 나란히 놓지 마세요.** 기계가 다릅니다 — CPU 측정은
**6코어 x86 노트북**이고 14 는 오라클 ARM 2코어입니다. 옮길 수 있는 것은
**무음 건너뛰기 켬/끔의 비(比)와 재현성**뿐이고, 그 둘은 하드웨어와 무관한 성질입니다.

**② 운영 서버에서는 못 쟀습니다.** 오라클 애슈번에서 돌리려다 백그라운드 실행이
조용히 실패했고, GPU 로 옮기면서 다시 시도하지 않았습니다.

**③ 전부 합성입니다.** 실제 피해자 음성이 아니고, 침묵도 발화 앞뒤에 3초씩 붙인
인공 배치입니다 → [ADR-043](../../../decisions/043-gpu-hosting.md). 실제 통화의
침묵 분포와 다릅니다.

**④ 긴 녹음 채점은 발화별 채점과 절대값을 견줄 수 없습니다.** 이어붙인 전사문
**전체**에 값이 남아 있는지로 세므로 발화별보다 후합니다 — 15 §8 과 같은 단서입니다.

## 측정 환경

```
CPU  Intel Core Ultra 5 225H · 6코어 · WSL2      faster-whisper 1.2.1 · CTranslate2 4.8.1 · int8
GPU  RunPod SECURE · RTX 4090 24GB · CUDA 12.8   같은 버전 · float16
```

## 무엇이 나왔나

**침묵이 들어가면 전사가 무너지고, 그 결과가 실행마다 다릅니다.**

| 조건 | 회 | 글자 수 | 중복 세그먼트 | PII 손상 | keep 손상 |
| --- | ---: | ---: | ---: | ---: | ---: |
| GPU `medium` 끔 | 3 | 1,492~2,032 | 0 · 0 · **16** | 13~25 | 28~57 |
| GPU `large-v3` 끔 | 3 | 2,057~2,573 | **6 · 3 · 8** | 10~15 | 17~28 |
| GPU `large-v3` 켬 | 2 | 2,358 · 2,502 | 1 · 0 | 11 | 21 · 28 |
| **GPU `large-v3` 켬 + 배치 16** | 2 | **2,219 · 2,219** | **0 · 0** | **7** | **10** |

**원인은 반복 루프입니다.** `transcripts-vad.json` 을 열면 같은 문장이 **17번**
반복되면서 191초~544초 구간의 발화를 통째로 먹고 있습니다. 그러는 동안
`avg_logprob` 이 -0.580 → -0.054 로 **오히려 좋아집니다** —
[09 §6.1](../../../docs/research/09-로컬모델-PII인식-실측.md) 의 「confidence 로는
못 잡습니다」가 여기서도 그대로입니다.

**그래서 [ADR-052](../../../decisions/052-stt-configuration.md) 가 채택한 조합이
속도 4배뿐 아니라 「같은 녹음을 두 번 돌리면 같은 결과가 나온다」까지 줍니다.**
모델만 올려서는 안 되고(`large-v3` 도 배치 없이는 무너집니다), 무음 건너뛰기만
켜서도 부족합니다(두 회차의 글자 수가 안 붙습니다).

**기각된 가설 하나** — 앞 구간 결과를 뒤로 물려받는 옵션(`condition_on_previous_text`)이
오염을 퍼뜨리는 것으로 의심했는데, 꺼도 붕괴가 안 멎고 45% 느려지기만 했습니다.

## 다시 재려면

```bash
# ① 음성 (08-25-stt-preprocess 의 스크립트)
python make_audio.py <eval-set.json> audio-nogap          # 침묵 없음
cp -r audio-nogap/raw audio-gap/raw                       # 같은 말소리를 쓰게
python make_audio.py <eval-set.json> audio-gap 3          # 침묵 37%

# ② 이어붙이기 — 15 §9 의 레시피 그대로
ffmpeg -y -f concat -safe 0 -i list.txt -c copy audio-gap.wav

# ③ 재기
python vad_cpu_bench.py       # CPU
python gpu_bench.py           # GPU (팟에서)
python capture_text.py        # 전사문 원문 저장
```

경로가 스크립트 안에 박혀 있습니다 — 돌린 그대로 남깁니다.
