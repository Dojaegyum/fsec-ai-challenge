#!/usr/bin/env python3
"""시연용 GPU 팟을 띄우고 · 채우고 · 지운다 — RunPod 한 대에 STT·OCR·이름 찾기를 함께.

정본: deploy/runpod-bench.md 「시연 당일 순서」
근거: ADR-043(개발·시연 GPU 는 시간 단위로 빌린다 · 합성 데이터만 · 끝나면 terminate)
      ADR-052(전사는 large-v3 · VAD 켬) · deploy/README.md 「2차 탐지를 켜려면」

## 쓰는 법 (저장소 어디서든)

    python deploy/runpod-pod.py list        # 계정에 도는 팟 — 과금이 남아 있는지 (없으면 [])
    python deploy/runpod-pod.py up          # 팟 생성 → id 를 deploy/.runpod-pod.json 에 적음
    python deploy/runpod-pod.py status      # CUDA · 공인 IP · 22/tcp · 시간당 비용 · 바깥 주소
    python deploy/runpod-pod.py provision   # 서비스 꾸러미를 올리고 팟 안에서 provision.sh 를 돌림
    python deploy/runpod-pod.py health      # 바깥 주소로 /health — "ready": true 를 기다림
    python deploy/runpod-pod.py down        # ⚠️ terminate (stop 이 아닙니다)

열쇠는 환경변수 `RUNPOD_API_KEY` 또는 `src/.env.local` 의 같은 이름에서 읽습니다.
서비스 토큰(`FINALLY_TOKEN`)은 `src/.env.local` 의 `TRANSCRIBER_TOKEN` 을 씁니다 —
앱이 그 값으로 부르므로 팟도 같은 값이어야 합니다(`NER_TOKEN` 시크릿도 같은 값).

## 왜 REST 인가

`assets/datasets/08-26-stt-vad/mkpod.py` 가 2026-08-26 에 같은 끝점(`rest.runpod.io/v1/pods`)으로
팟을 만들어 쓴 적이 있습니다 — 검증된 길을 그대로 씁니다. 응답의 `machine.cudaVersion` 과
`portMappings` 는 그때 실제로 읽은 값입니다.

## 헛도는 자리 둘 (runpod-bench.md 「⚠️ 팟을 띄운 직후」)

- 호스트 CUDA 가 이미지(12.8)보다 낮으면 컨테이너가 **조용히** 안 뜹니다 → `status` 가 경고합니다. `down` 뒤 `up`.
- 22/tcp 가 안 열리는 호스트가 있습니다 → `status` 가 경고합니다. SECURE 로 만들어 드뭅니다.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATE = ROOT / "deploy" / ".runpod-pod.json"  # .gitignore 에 있습니다
ENV_LOCAL = ROOT / "src" / ".env.local"
SSH_KEY = Path.home() / ".ssh" / "id_ed25519_finally"
API = "https://rest.runpod.io/v1"
PORT = 8917
MIN_CUDA = (12, 8)

# runpod-bench.md 와 같은 값 — SECURE 4090 · 40GB · 이미지는 실측(15·16)이 쓴 것
POD_SPEC = {
    "cloudType": "SECURE",
    "gpuTypeIds": ["NVIDIA GeForce RTX 4090"],
    "gpuCount": 1,
    "containerDiskInGb": 40,
    "name": "finally-demo",
    "imageName": "runpod/pytorch:1.0.2-cu1281-torch280-ubuntu2404",
    "ports": ["22/tcp", f"{PORT}/http"],
}


def die(msg: str) -> None:
    print(f"✗ {msg}", file=sys.stderr)
    sys.exit(1)


def env_local(name: str) -> str | None:
    """`.env.local` 의 한 값 — 셸에 있으면 그것이 먼저입니다."""
    if os.environ.get(name):
        return os.environ[name]
    if not ENV_LOCAL.exists():
        return None
    for line in ENV_LOCAL.read_text(encoding="utf-8").splitlines():
        if line.startswith(f"{name}="):
            return line.split("=", 1)[1].strip().strip('"').strip("'") or None
    return None


def api(method: str, path: str, body: dict | None = None) -> dict | list | None:
    key = env_local("RUNPOD_API_KEY") or die("RUNPOD_API_KEY 가 없습니다 — src/.env.local")
    req = urllib.request.Request(
        f"{API}{path}",
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as res:
            raw = res.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        die(f"RunPod {method} {path} → HTTP {e.code} {e.read().decode(errors='replace')[:300]}")


def pod_id(argv: list[str]) -> str:
    if len(argv) > 2:
        return argv[2]
    if STATE.exists():
        return json.loads(STATE.read_text())["id"]
    die("팟 id 가 없습니다 — `up` 을 먼저 하거나 id 를 인자로 주세요")


def cuda_of(pod: dict) -> tuple[int, ...] | None:
    v = (pod.get("machine") or {}).get("cudaVersion")
    if not v:
        return None
    try:
        return tuple(int(x) for x in str(v).split(".")[:2])
    except ValueError:
        return None


def describe(pod: dict) -> dict:
    """사람이 볼 것만 — 그리고 두 함정의 판정."""
    pid = pod["id"]
    cuda = cuda_of(pod)
    ports = pod.get("portMappings") or {}
    ssh_port = ports.get("22")
    ip = pod.get("publicIp")
    out = {
        "id": pid,
        "status": pod.get("desiredStatus"),
        "gpu": (pod.get("machine") or {}).get("gpuDisplayName") or (pod.get("machine") or {}).get("gpuTypeId"),
        "cost_per_hr": pod.get("costPerHr"),
        "cuda": ".".join(map(str, cuda)) if cuda else "(아직 모름)",
        "public_ip": ip,
        "ssh_port": ssh_port,
        "proxy_url": f"https://{pid}-{PORT}.proxy.runpod.net",
        "ssh": f"ssh -i {SSH_KEY} -p {ssh_port} root@{ip}" if ip and ssh_port else "(아직 안 열림)",
    }
    warnings = []
    if cuda and cuda < MIN_CUDA:
        warnings.append(f"호스트 CUDA {out['cuda']} < 12.8 — 컨테이너가 안 뜹니다. `down` 뒤 다시 `up`")
    if pod.get("desiredStatus") == "RUNNING" and ip and not ssh_port:
        warnings.append("22/tcp 가 안 열렸습니다 — 파일을 올릴 길이 없습니다. `down` 뒤 다시 `up`")
    out["warnings"] = warnings
    return out


def show(d: dict) -> None:
    for k, v in d.items():
        if k == "warnings":
            continue
        print(f"  {k:12} {v}")
    for w in d["warnings"]:
        print(f"  ⚠️  {w}")


def cmd_up() -> None:
    if STATE.exists():
        die(f"{STATE.name} 이 이미 있습니다 — 팟이 살아 있으면 `down` 먼저, 아니면 파일을 지우세요")
    pub = SSH_KEY.with_suffix(".pub")
    if not pub.exists():
        die(f"{pub} 가 없습니다 — runpod-bench.md 의 ssh 키")
    body = {**POD_SPEC, "env": {"PUBLIC_KEY": pub.read_text().strip()}}
    pod = api("POST", "/pods", body)
    STATE.write_text(json.dumps({"id": pod["id"], "created_at": time.strftime("%Y-%m-%dT%H:%M:%S%z")}))
    print(f"✓ 팟을 만들었습니다 — 시간당 ${pod.get('costPerHr')} 가 **지금부터** 갑니다. 끝나면 반드시 `down`")
    show(describe(pod))
    print("\n다음: 2~3분 뒤 `status` 로 CUDA 와 22/tcp 를 확인하고 `provision`")


def cmd_list() -> None:
    pods = api("GET", "/pods") or []
    if not pods:
        print("[] — 도는 팟이 없습니다. 과금 0")
        return
    for pod in pods:
        show(describe(pod))
        print()


def cmd_status() -> None:
    pod = api("GET", f"/pods/{pod_id(sys.argv)}")
    show(describe(pod))


def wait_ssh(pid: str, minutes: int = 6) -> tuple[str, int]:
    """공인 IP 와 22/tcp 가 잡힐 때까지 — 안 잡히는 호스트는 여기서 드러납니다."""
    for _ in range(minutes * 6):
        d = describe(api("GET", f"/pods/{pid}"))
        if any("CUDA" in w for w in d["warnings"]):
            die(d["warnings"][0])
        if d["public_ip"] and d["ssh_port"]:
            return d["public_ip"], int(d["ssh_port"])
        time.sleep(10)
    die("6분이 지나도 22/tcp 가 안 열렸습니다 — `down` 뒤 다시 `up` (SECURE 인지 확인)")


def ssh_base(ip: str, port: int) -> list[str]:
    return [
        "ssh", "-i", str(SSH_KEY), "-p", str(port),
        "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "LogLevel=ERROR",
        f"root@{ip}",
    ]


def cmd_provision() -> None:
    pid = pod_id(sys.argv)
    token = env_local("TRANSCRIBER_TOKEN") or die("TRANSCRIBER_TOKEN 이 src/.env.local 에 없습니다")
    ip, port = wait_ssh(pid)
    base = ssh_base(ip, port)
    print(f"▸ {ip}:{port} 로 꾸러미를 올립니다")
    # 로컬에서 tar → 팟에서 풀기. `--no-same-owner` 가 없으면 Windows 쪽 uid 로 실패합니다 (runpod-bench.md)
    tar = subprocess.Popen(
        ["tar", "czf", "-", "--exclude=__pycache__", "--exclude=.venv", "--exclude=.work",
         "-C", str(ROOT / "services"), "transcriber"],
        stdout=subprocess.PIPE,
    )
    subprocess.run(base + ["mkdir -p /opt/finally && tar xzf - --no-same-owner -C /opt/finally"],
                   stdin=tar.stdout, check=True)
    tar.wait()
    provision = (ROOT / "deploy" / "runpod-provision.sh").read_bytes()
    subprocess.run(base + ["cat > /opt/finally/provision.sh"], input=provision, check=True)
    # 토큰은 명령줄이 아니라 stdin 으로 — 팟의 프로세스 목록에 안 남습니다
    subprocess.run(base + ["umask 077 && cat > /opt/finally/token"], input=token.encode(), check=True)
    print("▸ 팟 안에서 provision.sh 를 돌립니다 (모델 내려받기 포함 · 10분쯤)")
    subprocess.run(base + ["bash /opt/finally/provision.sh"], check=True)
    print(f"\n✓ 끝. 바깥 주소: https://{pid}-{PORT}.proxy.runpod.net  → `health` 로 확인 뒤 vercel-env")


def cmd_health() -> None:
    pid = pod_id(sys.argv)
    token = env_local("TRANSCRIBER_TOKEN") or ""
    url = f"https://{pid}-{PORT}.proxy.runpod.net/health"
    for i in range(30):
        req = urllib.request.Request(url, headers={"x-finally-token": token})
        try:
            with urllib.request.urlopen(req, timeout=20) as res:
                d = json.loads(res.read())
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
            d = {"error": str(e)[:80]}
        print(f"  {url} → {json.dumps(d, ensure_ascii=False)}")
        if d.get("ready"):
            print("✓ ready — 모델이 올라와 있습니다. 이제 vercel-env (runpod-bench.md 「시연 당일 순서」 ④)")
            return
        time.sleep(20)
    die("10분을 기다려도 ready 가 아닙니다 — ssh 로 /tmp/uvicorn.log 를 보세요")


def cmd_down() -> None:
    pid = pod_id(sys.argv)
    api("DELETE", f"/pods/{pid}")
    if STATE.exists():
        STATE.unlink()
    print(f"✓ {pid} 를 지웠습니다(terminate). 과금이 멈춥니다")
    print("남은 것: vercel-env 에서 `clear_ner=true` 와 `transcriber_url=<상시 서버>` — 배포본이 죽은 주소를 부르지 않게 (runpod-bench.md ⑥)")


def main() -> None:
    cmds = {"list": cmd_list, "up": cmd_up, "status": cmd_status, "provision": cmd_provision, "health": cmd_health, "down": cmd_down}
    if len(sys.argv) < 2 or sys.argv[1] not in cmds:
        print(__doc__)
        sys.exit(2)
    cmds[sys.argv[1]]()


if __name__ == "__main__":
    main()
