"""아홉 유형을 **끝까지** 걸어 표로 만든다 — QA 가 가능한지 보는 자리.

각 유형마다: 사건 생성 → 슬롯 → 플랜 → **모든 단계를 순서대로 완료** →
단계가 다 열렸나 · 번호가 붙나 · 기한이 서나.

    python qa_matrix.py [base_url]
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3311"

# 라벨은 lib/questions.ts 의 CHANNEL_CHOICES 그대로여야 합니다
CASES = [
    ("CH-bank", "시중은행 계좌이체", "KB국민은행"),
    ("CH-neobank", "인터넷은행 (토스뱅크 등)", "카카오뱅크"),
    ("CH-securities", "증권사 계좌", "미래에셋증권"),
    ("CH-easypay", "간편송금 (카카오페이·토스 등)", "카카오페이"),
    ("CH-crypto", "가상자산 (거래소 경유)", "빗썸"),
    ("CH-facetoface", "대면편취 (현금 전달)", ""),
    ("CH-giftcard", "상품권 (핀번호 전달)", "컬쳐랜드"),
    ("CH-carrier", "휴대폰 소액결제", "LG유플러스"),
    ("CH-card", "카드 부정사용·카드론", "신한카드"),
]


def call(method, path, body=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(  # noqa: S310
        f"{BASE}{path}", data=data, method=method,
        headers={"content-type": "application/json", "accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as res:
            return res.status, json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", "replace")
        try:
            return error.code, json.loads(raw)
        except json.JSONDecodeError:
            return error.code, raw[:120]
    except Exception as error:  # noqa: BLE001
        return 0, type(error).__name__


rows = []
for channel_id, label, org in CASES:
    st, case = call("POST", "/api/cases", {"track": "victim"})
    if st != 201:
        rows.append((channel_id, f"사건 생성 {st}", "", "", "", ""))
        continue
    token = case["link_token"]

    answers = [("transferred", "네"), ("channel", label)]
    if org:
        answers.append(("org_name", org))
    answers.append(("amount", "3000000"))
    bad = []
    for key, value in answers:
        s, b = call("PATCH", f"/api/cases/{token}/slots/{key}", {"action": "answer", "value": value})
        if s != 200:
            bad.append(f"{key}:{s}")

    # 열려 있는 단계를 전부 끝냅니다. 새 단계가 안 열릴 때까지
    seen: set[str] = set()
    for _ in range(8):
        st, plan = call("GET", f"/api/cases/{token}/plan")
        todo = [
            s for s in plan.get("steps", [])
            if s.get("step_id") not in seen and s.get("state") != "done_verified"
        ]
        if not todo:
            break
        for one in todo:
            seen.add(one["step_id"])
            call("POST", f"/api/cases/{token}/steps/{one['step_id']}/artifacts",
                 {"kind": "receipt_no", "value": "2026-004821"})

    st, plan = call("GET", f"/api/cases/{token}/plan")
    keys = [(s.get("body") or {}).get("step_key") for s in plan.get("steps", [])]
    tels = sorted({
        line["contact"]
        for s in plan.get("steps", [])
        for line in ((s.get("body") or {}).get("steps") or [])
        if line.get("contact")
    })
    ch = (plan.get("channels") or [{}])[0]

    st, dl = call("GET", f"/api/cases/{token}/deadlines")
    rowsdl = (dl.get("deadlines") if isinstance(dl, dict) else dl) or []

    rows.append((
        channel_id,
        ch.get("org_id") or ("—" if not org else "⛔못붙임"),
        ",".join(bad) or "ok",
        f"{len(keys)}: {'·'.join(str(k or '?') for k in keys)}",
        ",".join(tels) or "없음",
        f"{len(rowsdl)}개 " + ",".join(f"{r.get('kind')}@{str(r.get('due_at'))[:10]}" for r in rowsdl),
    ))

head = ("유형", "org", "슬롯", "단계", "번호", "기한")
widths = [max(len(str(r[i])) for r in [head, *rows]) for i in range(6)]
print("  ".join(str(head[i]).ljust(widths[i]) for i in range(6)))
print("-" * (sum(widths) + 12))
for r in rows:
    print("  ".join(str(r[i]).ljust(widths[i]) for i in range(6)))
