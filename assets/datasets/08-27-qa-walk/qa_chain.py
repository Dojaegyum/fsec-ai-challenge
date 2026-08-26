"""사슬 전체를 끝까지 건다 — **한 유형을 처음부터 끝까지.**

진입 → 진술 → 플랜 → 단계 완료 → **다음 단계가 열리는가** → **기한이 서는가**
→ 재방문. 중간에 끊기는 자리를 찾는 것이 목적입니다.

    python qa_chain.py [base_url]
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3311"


def call(method: str, path: str, body: dict | None = None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(  # noqa: S310
        f"{BASE}{path}",
        data=data,
        method=method,
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
            return error.code, raw[:200]
    except Exception as error:  # noqa: BLE001
        return 0, type(error).__name__


def step_keys(plan) -> list[str]:
    return [(s.get("body") or {}).get("step_key") for s in plan.get("steps", [])]


def find(plan, key: str):
    for s in plan.get("steps", []):
        if (s.get("body") or {}).get("step_key") == key:
            return s
    return None


print(f"# {BASE}\n")

st, case = call("POST", "/api/cases", {"track": "victim"})
print(f"① 사건 생성            {st}")
if st != 201:
    print(json.dumps(case, ensure_ascii=False)[:300])
    raise SystemExit(1)
token = case.get("link_token") or case.get("case_token")

for key, value in [
    ("transferred", "네"),
    ("channel", "시중은행 계좌이체"),
    ("org_name", "KB국민은행"),
    ("amount", "3000000"),
]:
    st, body = call("PATCH", f"/api/cases/{token}/slots/{key}", {"action": "answer", "value": value})
    flag = "" if st == 200 else f"   ⛔ {json.dumps(body, ensure_ascii=False)[:120]}"
    print(f"② 슬롯 {key.ljust(12)}   {st}{flag}")

st, plan = call("GET", f"/api/cases/{token}/plan")
print(f"\n③ 플랜                {st}   단계 {step_keys(plan)}")
st, dl = call("GET", f"/api/cases/{token}/deadlines")
rows = (dl.get("deadlines") if isinstance(dl, dict) else dl) or []
print(f"   기한                {st}   {len(rows)}개 {[one.get('kind') for one in rows]}")

# ── 112 신고를 접수번호로 끝냅니다 ────────────────────────────────────
one = find(plan, "report-112")
if one:
    st, verdict = call(
        "POST", f"/api/cases/{token}/steps/{one['step_id']}/artifacts",
        {"kind": "receipt_no", "value": "2026-004821"},
    )
    print(f"\n④ 112 접수번호         {st}   {verdict.get('verify_result')}"
          f" / {verdict.get('step_state')}"
          f" / 연 단계 {[u.get('title', '')[:16] for u in verdict.get('unlocked_steps') or []]}")

st, plan = call("GET", f"/api/cases/{token}/plan")
print(f"   플랜 다시            {st}   단계 {step_keys(plan)}")

# ── 지급정지를 캡처로 끝냅니다 ────────────────────────────────────────
one = find(plan, "freeze-request")
if one:
    st, verdict = call(
        "POST", f"/api/cases/{token}/steps/{one['step_id']}/artifacts",
        {"kind": "receipt_no", "value": "KB-20260826-0001"},
    )
    print(f"\n⑤ 지급정지 접수번호      {st}   {verdict.get('verify_result')}"
          f" / {verdict.get('step_state')}"
          f" / 연 단계 {[u.get('title', '')[:16] for u in verdict.get('unlocked_steps') or []]}")

st, plan = call("GET", f"/api/cases/{token}/plan")
print(f"   플랜 다시            {st}   단계 {step_keys(plan)}")

# ── 피해구제 신청까지 ─────────────────────────────────────────────────
one = find(plan, "relief-apply")
if one:
    st, verdict = call(
        "POST", f"/api/cases/{token}/steps/{one['step_id']}/artifacts",
        {"kind": "receipt_no", "value": "2026-777001"},
    )
    print(f"\n⑥ 피해구제 접수번호      {st}   {verdict.get('verify_result')}"
          f" / {verdict.get('step_state')}"
          f" / 연 단계 {[u.get('title', '')[:16] for u in verdict.get('unlocked_steps') or []]}")
else:
    print("\n⑥ 피해구제 접수번호      ⛔ relief-apply 가 플랜에 없습니다")

st, plan = call("GET", f"/api/cases/{token}/plan")
print(f"   플랜 다시            {st}   단계 {step_keys(plan)}")

st, dl = call("GET", f"/api/cases/{token}/deadlines")
rows = (dl.get("deadlines") if isinstance(dl, dict) else dl) or []
print(f"\n⑦ 기한                {st}   {len(rows)}개")
for r in rows:
    print(f"      {str(r.get('kind')).ljust(8)} {str(r.get('due_at') or r.get('due'))[:10]}"
          f"  {(r.get('label') or r.get('title') or '')[:36]}"
          f"  estimated={r.get('estimated')}")

st, hist = call("GET", f"/api/cases/{token}/messages")
print(f"\n⑧ 대화 이력            {st}   {len(hist.get('messages', [])) if isinstance(hist, dict) else '?'}건")

st, again = call("GET", f"/api/cases/{token}/plan")
print(f"⑨ 재방문(같은 토큰)      {st}   단계 {len(again.get('steps', []))}개")

st, vault = call("GET", f"/api/cases/{token}/vault")
print(f"⑩ 볼트                {st}   {json.dumps(vault, ensure_ascii=False)[:120]}")

print(f"\n토큰: {token}")
