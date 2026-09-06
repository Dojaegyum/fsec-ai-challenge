#!/usr/bin/env python3
"""시연용 GPU 팟을 띄우고 · 채우고 · 지운다 — RunPod 한 대에 STT·OCR·이름 찾기를 함께.

정본: deploy/runpod-bench.md 「시연 당일 순서」
근거: ADR-043(개발·시연 GPU 는 시간 단위로 빌린다 · 합성 데이터만 · 끝나면 terminate)
      ADR-052(전사는 large-v3 · VAD 켬) · deploy/README.md 「2차 탐지를 켜려면」
      ADR-092(감시자가 이 파일의 함수를 직접 부른다 — C·D)

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
ssh 키는 `~/.ssh/id_ed25519_finally` 가 기본이고, 환경변수 `POD_SSH_KEY` 로 다른 경로를
줄 수 있습니다 — 감시자(finally-runpod-watch)는 다른 사용자로 다른 서버에서 돌아 다른
키를 씁니다.

이 파일은 CLI 이자 모듈입니다. 파일명에 `-` 가 있어 일반 `import` 는 안 되고,
감시자는 `importlib.util.spec_from_file_location` 으로 읽어 `list_pods`·`create_pod`·
`health_once`·`wait_ready`·`terminate` 같은 함수를 직접 부릅니다. CLI 동작(사람에게
보이는 출력·종료 코드)은 이 함수들을 감싼 `cmd_*` 로 그대로 남아 있습니다.

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
SSH_KEY = Path(os.environ.get("POD_SSH_KEY") or (Path.home() / ".ssh" / "id_ed25519_finally"))
API = "https://rest.runpod.io/v1"
PORT = 8917
MIN_CUDA = (12, 8)

# RunPod 프록시(<pod>-8917.proxy.runpod.net)는 Cloudflare 뒤에 있어 urllib 기본 User-Agent 에
# HTTP 403 을 돌려준다(curl 은 통과, 이 환경에서 확인됨) — 감시자가 살아 있는 팟을 죽은 것으로
# 오판해 3분마다 새로 만들지 않도록 모든 프록시 호출에 명시한다
USER_AGENT = "finally-runpod-watch/1"

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

POD_NAME = POD_SPEC["name"]


class PodError(Exception):
    """사람에게 보일 실패. CLI 는 종료 코드 1, 감시자는 잡아서 다음 회차로."""


def die(msg: str) -> None:
    raise PodError(msg)


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
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as res:
            raw = res.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        die(f"RunPod {method} {path} → HTTP {e.code} {e.read().decode(errors='replace')[:300]}")


def proxy_url(pod_id: str) -> str:
    return f"https://{pod_id}-{PORT}.proxy.runpod.net"


def list_pods() -> list[dict]:
    return api("GET", "/pods") or []


def find_pods(name: str = POD_NAME) -> list[dict]:
    return [p for p in list_pods() if p.get("name") == name]


def create_pod(name: str = POD_NAME) -> dict:
    """팟을 만든다 — **STATE 파일은 안 건드립니다**(감시자는 여러 팟을 다룹니다). CLI 의 `up` 이 그 뒤를 합니다."""
    pub = SSH_KEY.with_suffix(".pub")
    if not pub.exists():
        die(f"{pub} 가 없습니다 — runpod-bench.md 의 ssh 키")
    body = {**POD_SPEC, "name": name, "env": {"PUBLIC_KEY": pub.read_text().strip()}}
    return api("POST", "/pods", body)


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
        "proxy_url": proxy_url(pid),
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


def ssh_target(pod: dict) -> tuple[str, int] | None:
    d = describe(pod)
    if d["public_ip"] and d["ssh_port"]:
        return d["public_ip"], int(d["ssh_port"])
    return None


def health_once(pod_id: str, timeout: int = 10) -> dict | None:
    """프록시로 /health 한 번. 못 닿거나 5xx 면 None — 판단은 부르는 쪽이."""
    token = env_local("TRANSCRIBER_TOKEN") or ""
    # User-Agent 를 안 주면 Cloudflare 가 403 을 돌려줘 살아 있는 팟도 죽은 것으로 보인다
    req = urllib.request.Request(
        f"{proxy_url(pod_id)}/health",
        headers={"x-finally-token": token, "User-Agent": USER_AGENT},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return json.loads(res.read())
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, ValueError):
        return None


def wait_ready(pod_id: str, minutes: int = 15) -> bool:
    for _ in range(minutes * 3):
        d = health_once(pod_id, timeout=20)
        print(f"  {proxy_url(pod_id)}/health → {json.dumps(d, ensure_ascii=False) if d else '(못 닿음)'}")
        if d and d.get("ready"):
            return True
        time.sleep(20)
    return False


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


def provision(pod_id: str) -> None:
    token = env_local("TRANSCRIBER_TOKEN") or die("TRANSCRIBER_TOKEN 이 없습니다 — src/.env.local 또는 환경변수")
    ip, port = wait_ssh(pod_id)
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
    provision_script = (ROOT / "deploy" / "runpod-provision.sh").read_bytes()
    subprocess.run(base + ["cat > /opt/finally/provision.sh"], input=provision_script, check=True)
    # 토큰은 명령줄이 아니라 stdin 으로 — 팟의 프로세스 목록에 안 남습니다
    subprocess.run(base + ["umask 077 && cat > /opt/finally/token"], input=token.encode(), check=True)
    print("▸ 팟 안에서 provision.sh 를 돌립니다 (모델 내려받기 포함 · 10분쯤)")
    subprocess.run(base + ["bash /opt/finally/provision.sh"], check=True)


def terminate(pod_id: str) -> None:
    api("DELETE", f"/pods/{pod_id}")


def pod_id(argv: list[str]) -> str:
    if len(argv) > 2:
        return argv[2]
    if STATE.exists():
        return json.loads(STATE.read_text())["id"]
    running = [p for p in find_pods() if p.get("desiredStatus") == "RUNNING"]
    if len(running) == 1:
        return running[0]["id"]
    die("팟 id 가 없습니다 — `up` 을 먼저 하거나 id 를 인자로 주세요")


def cmd_list() -> None:
    pods = list_pods()
    if not pods:
        print("[] — 도는 팟이 없습니다. 과금 0")
        return
    for pod in pods:
        show(describe(pod))
        print()


def cmd_up() -> None:
    if STATE.exists():
        die(f"{STATE.name} 이 이미 있습니다 — 팟이 살아 있으면 `down` 먼저, 아니면 파일을 지우세요")
    pod = create_pod()
    STATE.write_text(json.dumps({"id": pod["id"], "created_at": time.strftime("%Y-%m-%dT%H:%M:%S%z")}))
    print(f"✓ 팟을 만들었습니다 — 시간당 ${pod.get('costPerHr')} 가 **지금부터** 갑니다. 끝나면 반드시 `down`")
    show(describe(pod))
    print("\n다음: 2~3분 뒤 `status` 로 CUDA 와 22/tcp 를 확인하고 `provision`")


def cmd_status() -> None:
    pod = api("GET", f"/pods/{pod_id(sys.argv)}")
    show(describe(pod))


def cmd_provision() -> None:
    provision(pod_id(sys.argv))
    print(f"\n✓ 끝. 바깥 주소: {proxy_url(pod_id(sys.argv))}  → `health` 로 확인 뒤 vercel-env")


def cmd_health() -> None:
    if wait_ready(pod_id(sys.argv), minutes=10):
        print("✓ ready — 모델이 올라와 있습니다. 이제 vercel-env (runpod-bench.md 「시연 당일 순서」 ④)")
        return
    die("10분을 기다려도 ready 가 아닙니다 — ssh 로 /tmp/uvicorn.log 를 보세요")


def cmd_down() -> None:
    pid = pod_id(sys.argv)
    terminate(pid)
    if STATE.exists():
        STATE.unlink()
    print(f"✓ {pid} 를 지웠습니다(terminate). 과금이 멈춥니다")
    print("남은 것: vercel-env 에서 `clear_ner=true` 와 `transcriber_url=<상시 서버>` — 배포본이 죽은 주소를 부르지 않게 (runpod-bench.md ⑥)")
    print("⚠️ 감시자(finally-runpod-watch)가 돌고 있으면 먼저 멈추세요 — 아니면 30초 안에 새 팟을 만듭니다 (deploy/README.md)")


def main() -> None:
    cmds = {"list": cmd_list, "up": cmd_up, "status": cmd_status, "provision": cmd_provision, "health": cmd_health, "down": cmd_down}
    if len(sys.argv) < 2 or sys.argv[1] not in cmds:
        print(__doc__)
        sys.exit(2)
    try:
        cmds[sys.argv[1]]()
    except PodError as e:
        print(f"✗ {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
