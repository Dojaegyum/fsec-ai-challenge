#!/usr/bin/env bash
# 갓 만든 RunPod 팟을 시연 서버로 만든다 — **팟 안에서** 돈다.
#
#   올리는 쪽: python deploy/runpod-pod.py provision   (이 파일을 /opt/finally/provision.sh 로 올리고 부릅니다)
#   손으로:    ssh … 'bash /opt/finally/provision.sh'
#
# 정본: deploy/runpod-bench.md 「재는 게 아니라 띄울 때」 — 2026-08-27 에 손으로 한 순서 그대로입니다.
# 근거: ADR-052(large-v3 · VAD 켬 · GPU 는 float16) · ADR-043(합성 데이터만)
#
# 여러 번 돌려도 안전합니다 — 이미 돼 있으면 건너뜁니다.
#
# 앞에 `/opt/finally/transcriber/`(services/transcriber 꾸러미)와 `/opt/finally/token`(공유 비밀값)이 있어야 합니다.
set -euo pipefail
cd /opt/finally

say() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }

[ -d transcriber ] || { echo "✗ /opt/finally/transcriber 가 없습니다 — 꾸러미를 먼저 올리세요"; exit 1; }
[ -s token ]       || { echo "✗ /opt/finally/token 이 비어 있습니다 — FINALLY_TOKEN 이 없으면 아무나 부릅니다"; exit 1; }

# ── 1. 이름 찾기 모델 — Ollama 는 GPU 를 스스로 찾습니다 (설치 로그의 "GPU 못 찾음" 경고는 무시)
say "Ollama"
if ! command -v ollama >/dev/null 2>&1; then
  curl -fsSL https://ollama.com/install.sh | sh
fi
if ! curl -fs localhost:11434/api/tags >/dev/null 2>&1; then
  # setsid + < /dev/null — ssh 가 끊겨도 같이 안 죽습니다 (runpod-bench.md)
  setsid nohup ollama serve > /tmp/ollama.log 2>&1 < /dev/null &
  for _ in $(seq 1 30); do curl -fs localhost:11434/api/tags >/dev/null 2>&1 && break; sleep 1; done
fi
if ! ollama list 2>/dev/null | grep -q '^gemma3:4b'; then
  ollama pull gemma3:4b            # 3.1GB · 8분쯤
fi

# ── 2. 전사 쪽 의존성 — 이미지의 python 이 PEP 668 로 잠겨 있어 --break-system-packages
say "ffmpeg · pip"
command -v ffmpeg >/dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq ffmpeg; }
pip install -q --break-system-packages -r transcriber/requirements.txt -r transcriber/requirements-models.txt

# ── 3. 다시 띄우는 스크립트 — pkill -f 는 ssh 세션까지 죽이므로 pid 파일로만 (runpod-bench.md)
say "restart.sh"
cat > /opt/finally/restart.sh <<'EOF'
#!/usr/bin/env bash
# setsid /opt/finally/restart.sh < /dev/null   — 다시 띄울 때는 이렇게만
cd /opt/finally
if [ -f uvicorn.pid ] && kill -0 "$(cat uvicorn.pid)" 2>/dev/null; then
  kill "$(cat uvicorn.pid)"; sleep 2
fi
FINALLY_ENGINE=local FINALLY_DEVICE=cuda FINALLY_COMPUTE=float16 \
FINALLY_STT=large-v3 FINALLY_VAD=1 FINALLY_NER=gemma3:4b FINALLY_WARMUP=1 \
FINALLY_WORKDIR=/opt/finally/.work \
FINALLY_TOKEN="$(cat /opt/finally/token)" \
  setsid nohup python3 -m uvicorn transcriber.app:app --host 0.0.0.0 --port 8917 \
    > /tmp/uvicorn.log 2>&1 < /dev/null &
echo $! > uvicorn.pid
EOF
chmod +x /opt/finally/restart.sh
setsid /opt/finally/restart.sh < /dev/null

# ── 4. 확인 — 아무도 요청하지 않았는데 모델이 올라와 있어야 합니다 (FINALLY_WARMUP=1)
#    large-v3 3GB 와 easyocr 가 첫 실행에 내려받히므로 길게 기다립니다
say "health — ready 를 기다립니다"
for i in $(seq 1 90); do
  body=$(curl -s -H "x-finally-token: $(cat token)" localhost:8917/health || true)
  case "$body" in *'"ready":true'*|*'"ready": true'*) echo "  $body"; break ;; esac
  [ "$i" = 90 ] && { echo "✗ 15분이 지나도 ready 가 아닙니다 — /tmp/uvicorn.log:"; tail -20 /tmp/uvicorn.log; exit 1; }
  sleep 10
done
ollama ps
echo
echo "✓ 팟 안은 끝. 바깥에서 python deploy/runpod-pod.py health"
