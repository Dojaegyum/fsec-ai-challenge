import json, os, urllib.request
KEY = os.environ["RUNPOD_API_KEY"]
pub = open(os.path.expanduser("~/.ssh/id_ed25519_finally.pub")).read().strip()
body = {
    "cloudType": "SECURE", "gpuTypeIds": ["NVIDIA GeForce RTX 4090"], "gpuCount": 1,
    "containerDiskInGb": 40, "name": "finally-stt-vad-bench",
    "imageName": "runpod/pytorch:1.0.2-cu1281-torch280-ubuntu2404",
    "ports": ["22/tcp"], "env": {"PUBLIC_KEY": pub},
}
req = urllib.request.Request("https://rest.runpod.io/v1/pods",
    data=json.dumps(body).encode(),
    headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"})
d = json.loads(urllib.request.urlopen(req, timeout=90).read())
print("팟 id:", d.get("id"))
print("GPU:", d.get("machine", {}).get("gpuTypeId"), "| 시간당 $", d.get("costPerHr"))
print("호스트 CUDA:", d.get("machine", {}).get("cudaVersion"))
print("PUBLIC_KEY 들어감:", bool(d.get("env", {}).get("PUBLIC_KEY")))
