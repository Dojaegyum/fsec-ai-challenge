# -*- coding: utf-8 -*-
"""파일 한 장이 실제로 올라가고 글이 되어 돌아오나 — Task 6.

    python qa_upload.py [주소] [올릴 파일]

파일을 안 주면 1×1 PNG 를 올립니다(배선만 봅니다). **글자가 있는 그림을 줘야
의미가 있습니다** — 준비된 것이 있습니다:

    assets/datasets/08-21-local-ocr-pii/screens/clean/I01.png   이체 완료 화면

## 네 걸음 — 계약 그대로 (spec/common/08-14-api.md §3.2)

```
① POST …/evidence                자리를 받는다 (presigned URL)
② PUT  <그 주소>                  **API 를 안 지나갑니다** — 함수 본문 한계 때문
③ POST …/evidence/{id}/complete  올렸다고 알린다 → 판독 시작
④ GET  …/evidence/{id}           끝날 때까지 폴링
```

## 무엇을 보나 — **가려졌나**입니다

돌아온 글에 계좌·전화·주민번호가 **토큰으로** 바뀌어 있어야 합니다. 이 경로는
파일이 서버를 거쳐 외부 모델까지 가는 자리라, 여기서 새면 경계가 뚫린 것입니다.

⚠️ **`NER_URL` 이 비어 있으면 이름은 안 가려집니다.** 1차 정규식에는 이름 규칙이
없습니다(한국 이름을 정규식으로 잡으면 오탐이 폭발합니다 → 09 §3.1). 실측에서
「김도현」이 그대로 남는 것을 확인했습니다 — **그 사실이 이 도구의 출력에 보입니다.**

⛔ 올리는 그림은 **합성**이어야 합니다. 실제 피해자 자료를 올리지 마세요.
"""

from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3311").rstrip("/")
FILE = sys.argv[2] if len(sys.argv) > 2 else None

# 1×1 PNG — 배선만 볼 때. 글자가 없어 `shortfalls: ["empty"]` 로 끝납니다
BLANK = bytes.fromhex(
    "89504e470d0a1a0a0000000d494844520000000100000001080600000"
    "01f15c4890000000a49444154789c63000100000500010d0a2db40000"
    "000049454e44ae426082"
)


def call(method: str, path: str, body: dict | None = None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(
        BASE + path, data=data, method=method, headers={"content-type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as res:
            return res.status, json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", "replace")
        try:
            return error.code, json.loads(raw)
        except Exception:
            return error.code, {"raw": raw[:200]}


def main() -> None:
    blob = open(FILE, "rb").read() if FILE else BLANK
    kind = "image"
    mime = "image/jpeg" if (FILE or "").lower().endswith((".jpg", ".jpeg")) else "image/png"

    st, case = call("POST", "/api/cases", {"track": "victim"})
    if st != 201:
        print(f"⛔ 사건을 못 만듭니다 {st} {json.dumps(case, ensure_ascii=False)[:200]}")
        raise SystemExit(1)
    token = case["link_token"]
    print(f"① 사건            {st}  {token}")

    st, slot = call(
        "POST",
        f"/api/cases/{token}/evidence",
        {"kind": kind, "mime_type": mime, "byte_size": len(blob)},
    )
    print(f"② 자리 요청        {st}  {len(blob):,} 바이트")
    if st not in (200, 201):
        print(f"   ⛔ {json.dumps(slot, ensure_ascii=False)[:300]}")
        raise SystemExit(1)

    evidence_id = slot["evidence_id"]
    put = urllib.request.Request(
        slot["upload_url"], data=blob, method="PUT", headers={"content-type": mime}
    )
    try:
        with urllib.request.urlopen(put, timeout=180) as res:
            print(f"③ 파일 올리기      {res.status}   (API 를 안 지나갑니다)")
    except urllib.error.HTTPError as error:
        print(f"③ 파일 올리기      {error.code}  {error.read().decode('utf-8', 'replace')[:200]}")
        raise SystemExit(1)

    st, _ = call("POST", f"/api/cases/{token}/evidence/{evidence_id}/complete", {})
    print(f"④ 올렸다고 알림     {st}")

    got: dict = {}
    for _ in range(30):
        st, got = call("GET", f"/api/cases/{token}/evidence/{evidence_id}")
        if got.get("ingest_status") in ("done", "failed"):
            break
        time.sleep(float(got.get("poll_after_ms") or 1500) / 1000)

    print(f"\n⑤ 끝난 상태        {got.get('ingest_status')}  {got.get('ingest_error') or ''}")
    print(f"   못 한 것        {got.get('shortfalls')}")
    print(f"   가린 것         {[one.get('token') for one in (got.get('pii_tokens') or [])]}")

    lines = got.get("transcript") or []
    print(f"\n   읽은 글 {len(lines)}줄")
    for line in lines[:16]:
        print("     ", (line.get("text") if isinstance(line, dict) else str(line))[:72])

    # **남아 있으면 안 되는 모양**을 눈으로. 정규식이 아니라 눈으로 보라는 뜻입니다
    whole = " ".join(
        (line.get("text") if isinstance(line, dict) else str(line)) for line in lines
    )
    if "[이름-" not in whole and lines:
        print("\n   ⚠️ 이름 토큰이 하나도 없습니다 — `NER_URL` 이 비어 있으면 정상입니다.")
        print("      **그 상태에서는 사람 이름이 그대로 나갑니다** → 09 §3.1")


if __name__ == "__main__":
    main()
