#!/usr/bin/env bash
# 상시 서버(OCI)에 감시자를 설치한다 — ADR-092 C·E.  서버에서:  bash runpod-watch-install.sh
set -euo pipefail
REPO_DIR=/home/ubuntu/fsec-ai-challenge
say() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }

say "저장소"
if [ -d "$REPO_DIR/.git" ]; then git -C "$REPO_DIR" pull -q --ff-only; else git clone -q https://github.com/Dojaegyum/fsec-ai-challenge.git "$REPO_DIR"; fi

say "비밀값 자리"
sudo mkdir -p /etc/finally /var/lib/finally
sudo chown ubuntu:ubuntu /var/lib/finally
if [ ! -f /etc/finally/watch.env ]; then
  sudo cp "$REPO_DIR/deploy/watch.env.example" /etc/finally/watch.env
  sudo chown ubuntu:ubuntu /etc/finally/watch.env && sudo chmod 600 /etc/finally/watch.env
  echo "  /etc/finally/watch.env 를 채우고 다시 돌리세요"; exit 0
fi
sudo chmod 600 /etc/finally/watch.env
[ -f /home/ubuntu/.ssh/id_ed25519_finally ] || { echo "✗ /home/ubuntu/.ssh/id_ed25519_finally 가 없습니다 — 팟 ssh 키를 복사하세요"; exit 1; }
chmod 600 /home/ubuntu/.ssh/id_ed25519_finally

say "systemd"
sudo cp "$REPO_DIR/deploy/finally-runpod-watch.service" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now finally-runpod-watch
sleep 3
systemctl --no-pager status finally-runpod-watch | head -8 || true
echo
echo "로그: journalctl -u finally-runpod-watch -f   · 멈춤: touch /var/lib/finally/watch.paused"
