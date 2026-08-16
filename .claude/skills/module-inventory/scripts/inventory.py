"""FinAlly 인벤토리 — 모듈 이름·역할과 DB 테이블·컬럼을 정본에서 읽어 표로 낸다.

이 스크립트는 목록을 갖고 있지 않다. 정본을 파싱할 뿐이다.
정본이 바뀌면 출력도 따라 바뀐다 — 그것이 이 스크립트의 존재 이유다.

  모듈 정본  spec/common/08-16-module-names.md
  스키마 정본 spec/backend/08-16-data-model.md
"""

import argparse
import os
import re
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
MODULE_SRC = os.path.join(REPO, "spec", "common", "08-16-module-names.md")
SCHEMA_SRC = os.path.join(REPO, "spec", "backend", "08-16-data-model.md")
ARCH = os.path.join(REPO, "ARCHITECTURE.md")

RETIRED = {
    "Ingest 서비스": "transcriber",
    "2차 PII 스크러버": "pii-tokenizer",
    "분석 오케스트레이터": "case-reader · slot-extractor · planner (셋으로 갈림)",
    "pii-scrubber": "pii-tokenizer",
    "kb-retriever": "kb-finder",
}

LAYER_HEAD = re.compile(r"^##\s+층\s+(\S+)\s*(?:·\s*(.*))?$")
ROW = re.compile(r"^\|\s*`([a-z0-9-]+)`\s*\|(.+)$")

CREATE = re.compile(r'^\s*CREATE TABLE\s+"?([a-z_][a-z0-9_]*)"?\s*\(', re.I)
NOT_A_COLUMN = re.compile(
    r"^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT|KEY|INDEX|EXCLUDE)\b", re.I)
COLUMN = re.compile(r"^([a-z_][a-z0-9_]*)\s+([A-Za-z][A-Za-z0-9_]*(?:\([^)]*\))?)(.*)$")
IN_VALUES = re.compile(r"IN\s*\(([^)]*)\)", re.I)


def _link(m):
    text, href = m.group(1), m.group(2)
    if text.strip().isdigit() and href.endswith(".md"):
        return os.path.basename(href)
    return text


def clean(cell):
    cell = re.sub(r"\[([^\]]*)\]\(([^)]*)\)", _link, cell)
    cell = cell.replace("**", "").replace("`", "")
    return " ".join(cell.split()).strip()


# ── 모듈 ────────────────────────────────────────────────────────────

def parse_modules():
    if not os.path.exists(MODULE_SRC):
        return []
    layers = []
    for line in open(MODULE_SRC, encoding="utf-8"):
        line = line.rstrip("\n")
        head = LAYER_HEAD.match(line)
        if head:
            layers.append({"layer": head.group(1),
                           "title": (head.group(2) or "").strip(),
                           "modules": []})
            continue
        if not layers:
            continue
        row = ROW.match(line)
        if row:
            cells = [c for c in (clean(c) for c in row.group(2).split("|")) if c]
            layers[-1]["modules"].append({
                "name": row.group(1),
                "role": cells[0] if cells else "",
                "extra": cells[1:],
            })
    return [g for g in layers if g["modules"]]


def render_modules(groups, only=None, find=None, names_only=False):
    total, seen = 0, set()
    for g in groups:
        mods = g["modules"]
        if only and g["layer"] != only:
            continue
        if find:
            q = find.lower()
            mods = [m for m in mods if q in m["name"].lower() or q in m["role"].lower()]
        if not mods:
            continue

        if names_only:
            for m in mods:
                if m["name"] in seen:
                    continue
                seen.add(m["name"])
                print(m["name"])
                total += 1
            continue

        print("\n── 층 %s · %s" % (g["layer"], g["title"]))
        width = max(len(m["name"]) for m in mods)
        for m in mods:
            print("   %-*s  %s" % (width, m["name"], m["role"]))
            where = [e for e in m["extra"] if e in ("서버", "브라우저")]
            tail = [e for e in m["extra"] if e not in ("서버", "브라우저")]
            if where:
                print("   %-*s  ↳ 어디서: %s" % (width, "", where[0]))
            if tail:
                print("   %-*s  ↳ 관련: %s" % (width, "", " / ".join(tail)))
            total += 1
    return total


# ── 스키마 ──────────────────────────────────────────────────────────

def parse_schema():
    """DDL 블록에서 테이블과 컬럼을 뽑는다. 실패해도 죽지 않는다."""
    if not os.path.exists(SCHEMA_SRC):
        return []

    tables, cur, in_sql = [], None, False
    for raw in open(SCHEMA_SRC, encoding="utf-8"):
        line = raw.rstrip("\n")

        if line.strip().startswith("```"):
            in_sql = "sql" in line.lower()
            continue
        if not in_sql:
            continue

        start = CREATE.match(line)
        if start:
            cur = {"name": start.group(1), "columns": []}
            tables.append(cur)
            continue
        if cur is None:
            continue
        if line.strip().startswith(");"):
            cur = None
            continue

        body, _, comment = line.partition("--")
        body, comment = body.strip().rstrip(","), comment.strip()

        # 컬럼 줄이 아니면 — 앞 컬럼의 보조 정보로 붙인다 (CHECK 절·주석 이어짐)
        if not body or NOT_A_COLUMN.match(body):
            if cur["columns"]:
                last = cur["columns"][-1]
                vals = IN_VALUES.search(body)
                if vals:
                    last["values"] = [v.strip().strip("'\"") for v in vals.group(1).split(",")]
                if comment and not last["comment"]:
                    last["comment"] = comment
            continue

        col = COLUMN.match(body)
        if not col:
            if cur["columns"] and comment and not cur["columns"][-1]["comment"]:
                cur["columns"][-1]["comment"] = comment
            continue

        rest = col.group(3).strip()
        vals = IN_VALUES.search(rest)
        constraints = re.sub(r"CHECK\s*\(.*", "", rest, flags=re.I).strip()
        cur["columns"].append({
            "name": col.group(1),
            "type": col.group(2),
            "constraints": " ".join(constraints.split()),
            "values": [v.strip().strip("'\"") for v in vals.group(1).split(",")] if vals else [],
            "comment": comment,
        })
    return [t for t in tables if t["columns"]]


def render_tables(tables, find=None):
    rows = tables
    if find:
        q = find.lower()
        rows = [t for t in tables
                if q in t["name"].lower()
                or any(q in c["name"].lower() or q in c["comment"].lower() for c in t["columns"])]
    if not rows:
        return 0
    width = max(len(t["name"]) for t in rows)
    print("\n── 테이블 %d개" % len(rows))
    for t in rows:
        print("   %-*s  컬럼 %d" % (width, t["name"], len(t["columns"])))
    return len(rows)


def render_columns(tables, name, find=None):
    hit = [t for t in tables if t["name"] == name]
    if not hit:
        near = [t["name"] for t in tables if name in t["name"]]
        print("'%s' 테이블이 없습니다.%s" % (name, ("  비슷한 것: " + ", ".join(near)) if near else ""))
        return 0

    for t in hit:
        cols = t["columns"]
        if find:
            q = find.lower()
            cols = [c for c in cols if q in c["name"].lower() or q in c["comment"].lower()]
        if not cols:
            continue
        w_name = max(len(c["name"]) for c in cols)
        w_type = max(len(c["type"]) for c in cols)
        w_con = max([len(c["constraints"]) for c in cols] + [4])

        print("\n── %s" % t["name"])
        print("   %-*s  %-*s  %-*s  %s" % (w_name, "컬럼", w_type, "타입", w_con, "제약", "정의"))
        print("   %s  %s  %s  %s" % ("-" * w_name, "-" * w_type, "-" * w_con, "-" * 4))
        for c in cols:
            print("   %-*s  %-*s  %-*s  %s" % (
                w_name, c["name"], w_type, c["type"], w_con, c["constraints"], c["comment"]))
            if c["values"]:
                print("   %-*s  %-*s  %-*s  값: %s" % (
                    w_name, "", w_type, "", w_con, "", " | ".join(c["values"])))
    return 1


# ── 점검 ────────────────────────────────────────────────────────────

def check(groups, tables):
    known = {m["name"] for g in groups for m in g["modules"]}
    problems = 0

    print("1) 쓰지 않기로 한 옛 표기가 남아 있는지")
    for old, new in RETIRED.items():
        hits = []
        for root, dirs, files in os.walk(REPO):
            dirs[:] = [d for d in dirs if d not in
                       (".git", "node_modules", ".next", ".claude", "archived")]
            for fn in files:
                if not fn.endswith(".md"):
                    continue
                path = os.path.join(root, fn)
                try:
                    text = open(path, encoding="utf-8").read()
                except (OSError, UnicodeDecodeError):
                    continue
                # 「…」로 감싼 것은 '쓰지 마세요'·'한때 부르던' 처럼 언급하는 자리다.
                # 쓰는 것과 가리키는 것을 구별한다.
                text = text.replace("「%s」" % old, "")
                if old in text:
                    rel = os.path.relpath(path, REPO).replace("\\", "/")
                    if rel.endswith("08-16-module-names.md") or "014-module-names" in rel:
                        continue  # 대응표를 싣는 자리라 정상
                    hits.append(rel)
        if hits:
            problems += 1
            print("   ✗ %-22s → %s" % (old, new))
            for h in sorted(set(hits)):
                print("        %s" % h)
    if not problems:
        print("   ✓ 없음")

    print("\n2) 정본의 모듈이 ARCHITECTURE 연결구조에 그려져 있는지")
    if not os.path.exists(ARCH):
        print("   ? ARCHITECTURE.md 없음")
    else:
        arch = open(ARCH, encoding="utf-8").read()
        missing = sorted(n for n in known if n not in arch)
        if missing:
            problems += 1
            print("   ✗ 안 보이는 모듈: %s" % ", ".join(missing))
            print("     → 이름만 있고 어디에 이어지는지가 없는 상태입니다")
        else:
            print("   ✓ %d개 전부 등장" % len(known))

    print("\n3) 스키마를 읽을 수 있는지")
    if not tables:
        problems += 1
        print("   ✗ DDL 을 하나도 못 읽었습니다 — 형식이 바뀌었는지 확인하세요")
    else:
        cols = sum(len(t["columns"]) for t in tables)
        print("   ✓ 테이블 %d개 · 컬럼 %d개" % (len(tables), cols))

    print("\n%s" % ("문제 없음" if not problems else "확인이 필요한 항목 %d건" % problems))
    return problems


def main():
    ap = argparse.ArgumentParser(
        description="FinAlly 인벤토리 — 모듈과 DB 스키마를 정본에서 읽어 표로 낸다")
    ap.add_argument("--modules", action="store_true", help="모듈만")
    ap.add_argument("--db", action="store_true", help="테이블 목록")
    ap.add_argument("--table", metavar="NAME", help="그 테이블의 컬럼·타입·제약·정의")
    ap.add_argument("--layer", help="모듈을 층으로 좁힘 (1·2·3·4·없음)")
    ap.add_argument("--find", metavar="Q", help="모듈·컬럼에서 검색")
    ap.add_argument("--names", action="store_true", help="모듈 이름만 한 줄씩")
    ap.add_argument("--check", action="store_true", help="옛 표기·연결구조 누락·파싱 점검")
    args = ap.parse_args()

    groups, tables = parse_modules(), parse_schema()
    if not groups:
        sys.exit("모듈 정본에서 하나도 못 읽었습니다: %s" % MODULE_SRC)

    if args.check:
        sys.exit(1 if check(groups, tables) else 0)

    if args.table:
        render_columns(tables, args.table, find=args.find)
        return

    want_mod = args.modules or args.layer or args.names or not args.db
    want_db = args.db or not (args.modules or args.layer or args.names)

    found = 0
    if want_mod:
        found += render_modules(groups, only=args.layer, find=args.find,
                                names_only=args.names)
    if want_db and not args.names:
        found += render_tables(tables, find=args.find)

    if args.find and not found:
        print("'%s' 에 걸리는 것이 없습니다." % args.find)
    elif not args.names:
        print("\n정본 — 모듈: spec/common/08-16-module-names.md"
              " · 스키마: spec/backend/08-16-data-model.md")


if __name__ == "__main__":
    main()
