#!/usr/bin/env python3
"""기관 하나를 초안에서 사전으로 올린다 — 서식을 지키면서.

    python materialize.py --org korbit --source https://... [--tel 1670-9756]
                          [--hours "평일 10:00~19:00"] [--steps "..."]
                          [--caution "..."] [--alias 코빗코리아 --alias Korbit]
    python materialize.py --check            # 지금 상태만 본다

## 왜 스크립트가 필요한가

손으로 하면 세 가지가 반복해서 깨집니다.

**① 서식.** `json.dumps(indent=2)` 로 다시 쓰면 `aliases` 와 `contact` 가 줄줄이
풀려서, 실제로 몇 줄 바꾼 변경이 **350줄짜리 diff** 가 됩니다. 손으로 맞춰 온
파일이라 리뷰가 안 됩니다.

**② 초안에서 빼기.** 두 파일을 같이 고쳐야 하는데 한쪽만 하면 **중복**이 생깁니다.

**③ 근거 확인.** `source_url` 이 `https://` 로 시작하는지, `verified_at` 이 날짜
모양인지, `org_id` 가 겹치지 않는지. `kb-load.ts` 는 **하나라도 어기면 통째로
거부**하므로 여기서 막는 편이 낫습니다.

⚠️ **이 스크립트는 출처를 확인해 주지 않습니다.** 대조는
`assets/datasets/08-26-org-dict/verify_source.py` · `dart_lookup.py` 가 먼저 합니다.
여기는 **이미 확인된 것을 옮기는 자리**입니다.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[4]
ORG = ROOT / "src/kb/org.json"
DRAFT = ROOT / "assets/datasets/08-26-org-dict/org-draft.json"

# 08-14-channel-matrix.md 의 ID 칸 그대로 — 손으로 옮겨 어긋남을 잡습니다
CHANNELS = {"CH-bank", "CH-neobank", "CH-securities", "CH-easypay", "CH-crypto",
            "CH-facetoface", "CH-giftcard", "CH-carrier", "CH-card"}
CONTACT_KEYS = ("report_tel", "report_steps", "report_hours", "submit", "caution")
TEL = re.compile(r"^(\d{2,4}-\d{3,4}-\d{4}|\d{4}-\d{4})$")

J = lambda v: json.dumps(v, ensure_ascii=False)


def render_contact(c: dict) -> str:
    """org.json 이 손으로 지켜 온 모양 — 칸이 하나면 한 줄, 여럿이면 여러 줄."""
    if not c:
        return "{}"
    if len(c) == 1 and not isinstance(next(iter(c.values())), list):
        k, v = next(iter(c.items()))
        return "{ " + f"{J(k)}: {J(v)}" + " }"
    rows = []
    for k, v in c.items():
        if isinstance(v, list):
            items = ",\n".join(
                "          { " + ", ".join(f"{J(a)}: {J(b)}" for a, b in one.items()) + " }"
                for one in v)
            rows.append(f"        {J(k)}: [\n{items}\n        ]")
        else:
            rows.append(f"        {J(k)}: {J(v)}")
    return "{\n" + ",\n".join(rows) + "\n      }"


def render(d: dict) -> str:
    blocks = []
    for o in d["orgs"]:
        al = ", ".join(J(a) for a in o["aliases"])
        blocks.append(
            "    {\n"
            f'      "org_id": {J(o["org_id"])},\n'
            f'      "channel_id": {J(o["channel_id"])},\n'
            f'      "name": {J(o["name"])},\n'
            f'      "aliases": [{al}],\n'
            f'      "contact": {render_contact(o["contact"])},\n'
            f'      "source_url": {J(o["source_url"])},\n'
            f'      "verified_at": {J(o["verified_at"])}\n'
            "    }")
    note = ",\n".join(f"    {J(line)}" for line in d["_note"])
    out = '{\n  "_note": [\n' + note + '\n  ],\n  "orgs": [\n' + ",\n".join(blocks) + "\n  ]\n}\n"
    json.loads(out)                       # 깨진 JSON 을 내보내지 않습니다
    return out


def state() -> None:
    org = json.loads(ORG.read_text(encoding="utf-8"))["orgs"]
    draft = json.loads(DRAFT.read_text(encoding="utf-8"))["orgs"]
    from collections import Counter
    a, b = Counter(o["channel_id"] for o in org), Counter(o["channel_id"] for o in draft)
    print(f"{'유형':<18}{'사전':>5}{'초안':>6}")
    for ch in sorted(CHANNELS):
        print(f"  {ch:<18}{a.get(ch, 0):>5}{b.get(ch, 0):>6}")
    forms = sum(1 + len(o["aliases"]) for o in org)
    print(f"\n  사전 {len(org)}곳 · 표기 {forms}가지 · 초안 {len(draft)}곳 남음")
    bad = [o["org_id"] for o in org if not str(o.get("source_url", "")).startswith("https://")]
    print(f"  출처 없는 곳: {bad or '없음'}")


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--check", action="store_true", help="지금 상태만 본다")
    p.add_argument("--org", help="초안의 org_id")
    p.add_argument("--source", help="대조를 통과한 출처 URL")
    p.add_argument("--verified", help="확인일 YYYY-MM-DD (기본: 오늘)")
    p.add_argument("--alias", action="append", default=[], help="더할 별칭 (여러 번)")
    p.add_argument("--tel"), p.add_argument("--steps")
    p.add_argument("--hours"), p.add_argument("--caution")
    a = p.parse_args()

    if a.check or not a.org:
        state()
        return 0 if a.check else 2

    if not a.source or not a.source.startswith("https://"):
        raise SystemExit("--source 가 https:// 로 시작해야 합니다 — 먼저 대조하세요")
    verified = a.verified or __import__("datetime").date.today().isoformat()
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", verified):
        raise SystemExit("--verified 는 YYYY-MM-DD")
    if a.tel and not TEL.match(a.tel):
        raise SystemExit(f"전화번호 모양이 아닙니다 — {a.tel}")

    draft = json.loads(DRAFT.read_text(encoding="utf-8"))
    org = json.loads(ORG.read_text(encoding="utf-8"))

    one = next((o for o in draft["orgs"] if o["org_id"] == a.org), None)
    if one is None:
        raise SystemExit(f"초안에 없습니다 — {a.org}")
    if any(o["org_id"] == a.org for o in org["orgs"]):
        raise SystemExit(f"사전에 이미 있습니다 — {a.org}")
    if one["channel_id"] not in CHANNELS:
        raise SystemExit(f"9유형 밖입니다 — {one['channel_id']}")

    contact = {}
    for key, val in (("report_tel", a.tel), ("report_steps", a.steps),
                     ("report_hours", a.hours), ("caution", a.caution)):
        if val:
            contact[key] = val
    assert set(contact) <= set(CONTACT_KEYS)

    one = dict(one)
    one["aliases"] = list(dict.fromkeys([*one["aliases"], *a.alias]))
    one["contact"] = contact
    one["source_url"] = a.source
    one["verified_at"] = verified

    org["orgs"].append(one)
    draft["orgs"] = [o for o in draft["orgs"] if o["org_id"] != a.org]

    ORG.write_text(render(org), encoding="utf-8", newline="\n")
    DRAFT.write_text(json.dumps(draft, ensure_ascii=False, indent=2) + "\n",
                     encoding="utf-8", newline="\n")

    print(f"올렸습니다 — {one['name']} ({a.org}) · {one['channel_id']}")
    if not contact:
        print("  연락처는 비었습니다 — 이름·실재만 확인된 상태입니다")
    print()
    state()
    print("\n다음 — dict_probe.py 로 다시 재고, 04·17 에 되먹이세요.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
