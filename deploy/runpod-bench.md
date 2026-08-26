# RunPod 으로 벤치마크 팟 띄우기 — 뽑기를 줄이는 순서

> [ADR-043](../decisions/043-gpu-hosting.md) 이 **개발·대회 데모용 GPU 는 RunPod 에서
> 시간 단위로 빌린다**고 정했습니다. 이 문서는 그 절차이고, **실제로 헛돈 자리**를
> 적어 둔 것입니다.
>
> 이 절차로 잰 것: [15 STT GPU](../docs/research/15-STT-GPU-실측.md) ·
> [16 OCR GPU](../docs/research/16-OCR-GPU-실측.md)

## ⚠️ 팟을 띄운 직후 두 가지를 확인하세요

**여기서 하루에 세 번 헛돌았습니다.** RunPod 은 아래 둘을 **골라 주지 않습니다** —
운이 나쁘면 컨테이너가 조용히 안 뜨고, 에러도 안 납니다.

### ① 호스트 CUDA 가 이미지보다 낮으면 컨테이너가 안 뜹니다

```
이미지 runpod/pytorch:1.0.2-cu1281-...   → CUDA 12.8 이 필요합니다

호스트 12.4  →  ✗ 컨테이너가 안 뜸.  status 는 RUNNING 인데 uptime 이 0 에서 안 올라감
호스트 12.8  →  ✓
호스트 13.0  →  ✓ (상위 호환)
```

**증상이 「에러」가 아니라 「조용함」이라 알아채기 어렵습니다.** 팟 정보의
`cudaVersion` 을 보고 **이미지가 요구하는 것보다 낮으면 바로 지우고 다시 잡으세요.**
기다려도 안 뜹니다.

### ② TCP 공인 포트가 안 열리는 호스트가 있습니다

`ports: ["22/tcp"]` 로 만들어도 호스트에 따라 **http 포트만** 매핑됩니다.

```
runtime.ports 에 type:"tcp" · private:22 항목이 있어야  →  ssh/scp 가 됩니다
없으면                                                  →  파일을 올릴 방법이 없습니다
```

**`ssh.runpod.io` 프록시로는 안 됩니다** — 그쪽은 계정에 등록한 키로 인증해서,
팟의 `PUBLIC_KEY` 만으로는 `Permission denied (publickey)` 가 납니다. `scp` 도 안 됩니다.

**커뮤니티에서 이게 자주 빕니다. SECURE 는 공인 IP 가 보장됩니다** — 시간당 두 배지만
(4090 기준 $0.34 → $0.74) 30분짜리 측정이면 차액이 20센트입니다. **헛돈 시간이 더 비쌉니다.**

## 순서

```
1. 팟 생성 (4090 · 40GB · ports 22/tcp · sshPublicKey 는 ~/.ssh/finally_oracle.pub)
2. ⚠️ cudaVersion 확인        — 이미지보다 낮으면 지우고 1로
3. 2~3분 뒤 runtime.ports 확인 — tcp/22 가 없으면 지우고 1로 (SECURE 로)
4. ssh root@<ip> -p <public>  — 직접 접속만 됩니다
5. scp 로 꾸러미 올리고 tar -x --no-same-owner
6. pip install --break-system-packages ...
7. 재고, 결과를 scp 로 회수
8. ⚠️ 끝나면 terminate      — stop 이 아닙니다
```

**8 이 규칙인 이유**는 [단가 조사 §2.2](../docs/research/13-GPU-클라우드-단가.md) 에
있습니다 — **정지 중 볼륨이 가동 중보다 비쌉니다.**

## 잔손질 둘

**`--break-system-packages` 가 필요합니다.** 이미지의 python 이 PEP 668 로 잠겨
있습니다. 버리는 팟이라 그대로 씁니다.

**`tar` 에 `--no-same-owner`.** 없으면 Windows 에서 만 꾸러미의 uid 를 그대로 쓰려다
`Cannot change ownership` 로 실패합니다.

## 재는 게 아니라 **띄울** 때 — 이름 찾기 서비스 (2026-08-27 실제 순서)

벤치는 한 번 재고 끝이지만, 데모는 **앱이 부르는 동안 살아 있어야** 합니다.
아래는 RTX 4090 팟에 `services/transcriber` 를 올려 `POST /ner` 를 연 순서
그대로입니다. 측정값은 [research/09 §7.2](../docs/research/09-로컬모델-PII인식-실측.md).

```bash
# 1. 모델 — Ollama 는 GPU 를 스스로 찾습니다 (설치 로그의 "GPU 못 찾음" 경고는 무시)
curl -fsSL https://ollama.com/install.sh | sh
setsid nohup ollama serve > /tmp/ollama.log 2>&1 < /dev/null &
ollama pull gemma3:4b                 # 3.1GB · 8분쯤

# 2. 전사 쪽 의존성
apt-get install -y ffmpeg
pip install --break-system-packages -r requirements.txt -r requirements-models.txt

# 3. 서비스 — 로컬에서 꾸러미로 올립니다
#    tar czf - --exclude=__pycache__ -C services transcriber | ssh … "tar xzf - --no-same-owner -C /opt/finally"
FINALLY_ENGINE=local FINALLY_DEVICE=cuda FINALLY_COMPUTE=float16 \
FINALLY_STT=large-v3 FINALLY_NER=gemma3:4b FINALLY_WARMUP=1 \
FINALLY_TOKEN=<공유 비밀> \
  python3 -m uvicorn transcriber.app:app --host 0.0.0.0 --port 8917

# 4. 확인 — 아무도 요청하지 않았는데 모델이 올라와 있어야 합니다
ollama ps                             # gemma3:4b … 100% GPU … Forever
curl -s localhost:8917/health         # "ready": true
```

밖에서는 `https://<팟ID>-8917.proxy.runpod.net` 입니다(팟 생성 때 `8917/http`).

### ⛔ `FINALLY_WARMUP=1` 을 빼면 **첫 요청이 실패합니다**

첫 적재가 **60초를 넘겨** 그대로 타임아웃했습니다. 이름 찾기가 죽으면 앱은 슬롯
저장을 503 으로 막으므로(경계라서 못 가리면 안 내보냅니다) **첫 사용자가 그것을
맞으면 사건 진행이 멈춥니다.** 켜면 첫 요청이 0.4초입니다.

### ⚠️ `pkill -f uvicorn` 은 **당신의 ssh 세션을 죽입니다**

`pkill -f` 는 명령줄 전체를 봅니다. ssh 로 보낸 명령줄에 `uvicorn` 이라는 글자가
들어 있으므로 **그 명령을 실행 중인 셸이 스스로 걸립니다.** 출력 없이 세션만
끊겨서 원인을 찾기 어렵습니다. 다시 띄우는 일은 **팟 안에 스크립트 파일로 두고**
`setsid /opt/finally/restart.sh < /dev/null` 로 부르세요.

같은 이유로 `nohup … &` 만으로는 ssh 가 끊길 때 함께 죽는 경우가 있습니다 —
`setsid nohup … < /dev/null &` 로 떼어 두세요.

## 무엇을 올려도 되나

**합성 데이터만.** 실제 피해자의 음성·이미지는 올리지 않습니다 —
[ADR-043](../decisions/043-gpu-hosting.md) 의 **절대 조건**입니다. 합성이라 개인정보가
아니고, 그래서 국외 이전에 해당하지 않습니다. **이 조건이 깨지면 국내에서만 돌려야 합니다.**
