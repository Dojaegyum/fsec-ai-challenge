"""같은 걸음을 **로컬과 배포본에 똑같이** 걸어 다른 곳을 찾는다.

로컬만 보면 「내 기기에서는 됩니다」로 끝납니다. 심사위원이 여는 것은 배포본입니다.

    python qa_compare.py
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

TARGETS = {
    "로컬": "http://127.0.0.1:3311",
    "배포": "https://fin-ally-khaki.vercel.app",
}


def call(base: str, method: str, path: str, body: dict | None = None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(  # noqa: S310
        f"{base}{path}",
        data=data,
        method=method,
        headers={"content-type": "application/json", "accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            return res.status, json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", "replace")
        try:
            return error.code, json.loads(raw)
        except json.JSONDecodeError:
            return error.code, raw[:200]
    except Exception as error:  # noqa: BLE001
        return 0, type(error).__name__


def walk(base: str) -> dict:
    out: dict = {}
    status, case = call(base, "POST", "/api/cases", {"track": "victim"})
    out["사건 생성"] = status
    if status != 201:
        return out
    token = case.get("link_token") or case.get("case_token")
    out["token"] = token

    for key, value in [
        ("transferred", "네"),
        ("channel", "시중은행 계좌이체"),
        ("org_name", "KB국민은행"),
        ("amount", "3000000"),
        ("occurred_at", "2026-08-25"),
    ]:
        st, _ = call(base, "PATCH", f"/api/cases/{token}/slots/{key}", {"action": "answer", "value": value})
        out[f"slot:{key}"] = st

    st, plan = call(base, "GET", f"/api/cases/{token}/plan")
    out["plan"] = st
    if st == 200:
        out["단계"] = [(s.get("body") or {}).get("step_key") for s in plan.get("steps", [])]
        out["번호"] = [
            line["contact"]
            for s in plan.get("steps", [])
            for line in ((s.get("body") or {}).get("steps") or [])
            if line.get("contact")
        ]

    st, dl = call(base, "GET", f"/api/cases/{token}/deadlines")
    out["deadlines"] = st
    if st == 200:
        rows = dl.get("deadlines") if isinstance(dl, dict) else dl
        out["기한"] = [
            f"{one.get('kind')}:{one.get('label') or one.get('title') or '?'}" for one in (rows or [])
        ]

    st, hist = call(base, "GET", f"/api/cases/{token}/messages")
    out["messages"] = st

    # **재방문** — 링크 토큰으로 다시 여는 길
    st, again = call(base, "GET", f"/api/cases/{token}/plan")
    out["재조회"] = st
    if st == 200:
        out["재조회 단계수"] = len(again.get("steps", []))
    return out


results = {name: walk(base) for name, base in TARGETS.items()}

keys: list[str] = []
for one in results.values():
    for k in one:
        if k not in keys:
            keys.append(k)

print(f"{'항목'.ljust(16)} {'로컬'.ljust(46)} 배포")
print("-" * 110)
for k in keys:
    if k == "token":
        continue
    a = json.dumps(results["로컬"].get(k), ensure_ascii=False)
    b = json.dumps(results["배포"].get(k), ensure_ascii=False)
    mark = "  " if a == b else "⚠️"
    print(f"{mark} {k.ljust(14)} {a[:44].ljust(46)} {b[:44]}")
