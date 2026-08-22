#!/usr/bin/env bash
# 갓 만든 우분투 서버를 전사 서비스가 돌 수 있는 상태로 만듭니다.
#
#   서버에 접속해서:  bash bootstrap.sh
#
# 여러 번 돌려도 안전합니다 — 이미 돼 있으면 건너뜁니다.
set -euo pipefail

say() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
skip() { printf '  이미 됨 — 건너뜁니다\n'; }

# ── 1. 도커 ────────────────────────────────────────────────────────────
say "도커를 확인합니다"
if command -v docker >/dev/null 2>&1; then
  skip
else
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
  echo "  도커를 넣었습니다. **다시 접속해야 sudo 없이 씁니다.**"
fi

# ── 2. 방화벽 ──────────────────────────────────────────────────────────
# 오라클 서버는 만들자마자 SSH 말고 전부 막혀 있습니다. 게다가 막는 곳이
# 두 군데(서버 안 iptables + 웹 콘솔의 보안 목록)라, 한쪽만 열고
# "왜 안 되지" 하는 일이 흔합니다.
say "서버 안쪽 방화벽에서 80·443 을 엽니다"
if command -v ufw >/dev/null 2>&1 && sudo ufw status 2>/dev/null | grep -q "Status: active"; then
  sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
elif command -v iptables >/dev/null 2>&1; then
  for port in 80 443; do
    if sudo iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null; then
      echo "  $port 이미 열림"
    else
      # SSH 를 막는 REJECT 규칙보다 앞에 넣어야 합니다. 뒤에 넣으면 안 열립니다
      sudo iptables -I INPUT 1 -p tcp --dport "$port" -j ACCEPT
      echo "  $port 열었습니다"
    fi
  done
  if command -v netfilter-persistent >/dev/null 2>&1; then
    sudo netfilter-persistent save
  else
    sudo apt-get install -y iptables-persistent >/dev/null 2>&1 || true
  fi
fi

# ── 3. 스왑 ────────────────────────────────────────────────────────────
# 메모리 4GB 서버에서 모델 적재 순간에만 잠깐 넘칠 수 있습니다. 스왑이
# 없으면 그 순간 커널이 서비스를 죽이고 이유가 안 남습니다
say "스왑을 확인합니다"
if [ "$(free -m | awk '/Swap:/ {print $2}')" -gt 0 ]; then
  skip
else
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
  echo "  2GB 붙였습니다"
fi

# ── 4. 설정 ────────────────────────────────────────────────────────────
say "설정 파일을 확인합니다"
if [ -f .env ]; then
  skip
else
  cp .env.example .env
  token=$(openssl rand -hex 32)
  sed -i "s|^FINALLY_TOKEN=.*|FINALLY_TOKEN=${token}|" .env
  echo "  .env 를 만들고 비밀값을 넣었습니다."
  echo "  ⚠️ TRANSCRIBER_DOMAIN 은 아직 비어 있습니다 — 채우고 다시 돌리세요."
  echo
  echo "  앱 쪽 환경변수에 넣을 값:"
  echo "    TRANSCRIBER_TOKEN=${token}"
  exit 0
fi

if ! grep -q '^TRANSCRIBER_DOMAIN=.\+' .env; then
  echo "  ⚠️ .env 의 TRANSCRIBER_DOMAIN 이 비어 있습니다. 채우고 다시 돌리세요."
  exit 1
fi

# ── 5. 띄우기 ──────────────────────────────────────────────────────────
say "서비스를 띄웁니다 (처음이면 모델 1.5GB 를 받느라 오래 걸립니다)"
docker compose up -d --build

cat <<'DONE'

  띄웠습니다. 준비될 때까지 기다리려면:

    docker compose logs -f transcriber

  「모델 적재 완료」가 뜨면 받을 준비가 된 것입니다. 확인:

    curl https://$(grep '^TRANSCRIBER_DOMAIN=' .env | cut -d= -f2)/health

  ⚠️ 오라클 클라우드라면 **웹 콘솔에서도 열어야 합니다** —
     네트워킹 → 가상 클라우드 네트워크 → 보안 목록 → 수신 규칙에
     0.0.0.0/0 의 TCP 80·443 을 추가하세요. 서버 안쪽만 열면 안 닿습니다.
DONE
