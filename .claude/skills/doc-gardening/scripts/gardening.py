"""FinAlly 문서 손질 — rfc·spec·docs 의 자기 표기·피참조·은퇴 상태를 저장소에서 읽어 낸다.

이 스크립트는 판정을 하지 않는다. 판정(살아 있음·낡음·은퇴)은 코드를 읽은 사람·에이전트가 한다.
여기는 그 판정에 필요한 재료를 뽑고, 은퇴가 규약(RFC-001 「은퇴」)대로 됐는지만 검사한다.

  markers            열린 자기 표기(TODO·⬜·미정·미구현·미반영·개정 대기 …)를 file:line 으로
  inbound <문서>     그 문서를 가리키는 파일 — decisions/·spec/·rfc/·docs/·src/ 로 묶어서
  retire <문서> ...  H1 아래에 은퇴 배너를 넣고, 고쳐야 할 README 자리를 알려 준다
  check              은퇴 배너와 README 「은퇴」 절이 맞물리는지 · RFC 「최종 개정」이 이력보다 뒤처졌는지
"""

import argparse
import datetime as dt
import os
import re
import subprocess
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))

# 자기 표기를 훑는 곳. decisions/ 는 이력이라 뺀다 — 거기 TODO 는 그때의 TODO 다.
MARKER_ROOTS = ("rfc", "spec", "docs", "CLAUDE.md", "ARCHITECTURE.md", "README.md")
# 은퇴 검사 대상 — doc-integrity 의 INDEXED_DIRS 중 은퇴가 허용되는 곳.
RETIRE_ROOTS = ("spec", "docs/plans", "docs/research")
SKIP_DIRS = {".git", "node_modules", ".next", ".venv", "__pycache__", "archived"}
TEXT_EXT = (".md", ".ts", ".tsx", ".py", ".yml", ".yaml", ".json", ".sql")

MARKER = re.compile(
    r"TODO\(|⬜|\b미정\b|미구현|미반영|미확인|개정 대기|서버 미구현|아직 정해지지|근거 필요"
)
STRUCK = re.compile(r"~~.*?~~")
BANNER = re.compile(r"^>\s*\*\*은퇴\((\d{4}-\d{2}-\d{2})\)\*\*\s*—")
HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*$")
LINK = re.compile(r"\[[^\]]*\]\(\s*([^)\s#]+)")
RFC_LAST = re.compile(r"^-\s*최종 개정:\s*(\d{4}-\d{2}-\d{2})", re.M)
ROW_DATE = re.compile(r"^\|\s*(\d{4}-\d{2}-\d{2})\s*\|", re.M)


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def rel(path):
    return os.path.relpath(path, REPO).replace("\\", "/")


def walk(roots, exts):
    for root in roots:
        top = os.path.join(REPO, root)
        if os.path.isfile(top):
            if top.endswith(exts):
                yield top
            continue
        for dirpath, dirnames, filenames in os.walk(top):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
            for name in filenames:
                if name.endswith(exts):
                    yield os.path.join(dirpath, name)


# ── markers ─────────────────────────────────────────────────────────


def cmd_markers(args):
    total = 0
    per_file = []
    for path in sorted(walk(MARKER_ROOTS, (".md",))):
        hits = []
        for no, line in enumerate(read(path).split("\n"), 1):
            if not MARKER.search(line):
                continue
            if not args.all and STRUCK.search(line) and MARKER.search(STRUCK.sub("", line)) is None:
                continue  # 취소선 안에만 있으면 닫힌 것
            hits.append((no, line.strip()[:140]))
        if hits:
            per_file.append((rel(path), hits))
            total += len(hits)
    for name, hits in per_file:
        print(f"\n{name}  ({len(hits)})")
        if not args.count:
            for no, text in hits:
                print(f"  :{no}  {text}")
    print(f"\n열린 표기 {total}건 / 파일 {len(per_file)}개")
    return 0


# ── inbound ─────────────────────────────────────────────────────────


def group_of(path):
    for g in ("decisions/", "spec/", "rfc/", "docs/", "src/", "services/", "deploy/", ".github/", ".claude/"):
        if path.startswith(g):
            return g.rstrip("/")
    return "(루트)"


def cmd_inbound(args):
    target = args.doc.replace("\\", "/")
    base = os.path.basename(target)
    groups = {}
    for path in walk((".",), TEXT_EXT):
        r = rel(path)
        if r == target:
            continue
        try:
            text = read(path)
        except UnicodeDecodeError:
            continue
        if base not in text:
            continue
        lines = [no for no, line in enumerate(text.split("\n"), 1) if base in line]
        groups.setdefault(group_of(r), []).append((r, lines))
    if not groups:
        print(f"{target} 을 가리키는 파일이 없습니다.")
        return 0
    print(f"{target} 을 가리키는 파일 — 옮기면 이 링크가 전부 깨집니다 (ADR 은 고칠 수 없습니다):\n")
    for g in ("decisions", "spec", "rfc", "docs", "src", "services", "deploy", ".github", ".claude", "(루트)"):
        if g not in groups:
            continue
        rows = groups[g]
        print(f"  {g}  ({len(rows)}개 파일)")
        for r, lines in sorted(rows):
            print(f"    {r}:{','.join(map(str, lines[:6]))}{'…' if len(lines) > 6 else ''}")
    return 0


# ── retire ──────────────────────────────────────────────────────────


def readme_for(doc_rel):
    """doc-integrity 와 같은 규칙 — 자기 README 를 가진 가장 가까운 상위 폴더가 목차를 책임진다."""
    d = os.path.dirname(doc_rel)
    while d:
        cand = os.path.join(REPO, d, "README.md")
        if os.path.exists(cand):
            return rel(cand)
        d = os.path.dirname(d)
    return None


def cmd_retire(args):
    doc_rel = args.doc.replace("\\", "/")
    path = os.path.join(REPO, doc_rel)
    if not os.path.exists(path):
        print(f"없는 파일입니다: {doc_rel}")
        return 2
    text = read(path)
    lines = text.split("\n")
    if any(BANNER.match(l) for l in lines[:12]):
        print(f"이미 은퇴 배너가 있습니다: {doc_rel}")
        return 1
    h1 = next((i for i, l in enumerate(lines) if l.startswith("# ")), None)
    if h1 is None:
        print("H1 이 없어 배너를 넣을 자리를 모릅니다.")
        return 2
    today = args.date or dt.date.today().isoformat()
    banner = [
        "",
        f"> **은퇴({today})** — {args.why.rstrip('.')}. 이제 볼 곳 — {args.see}.",
        "> 파일은 링크를 지키려 제자리에 둡니다 — 더 갱신하지 않습니다.",
    ]
    lines[h1 + 1 : h1 + 1] = banner
    with open(path, "wb") as f:
        f.write("\n".join(lines).encode("utf-8"))
    print(f"배너를 넣었습니다: {doc_rel}")
    readme = readme_for(doc_rel)
    if readme:
        print(f"\n다음은 손으로: {readme} 에서 이 문서의 행을 현행 표에서 빼고 「은퇴」 절 표로 옮기세요.")
        print("  은퇴 절이 없으면 `## 은퇴` (또는 `### 은퇴`) 제목 아래 「파일 · 왜 끝났나 · 이제 볼 곳」 표를 만듭니다.")
    print("그리고 아직 사실인 절이 있으면 제 폴더로 꺼내고, 원래 자리에는 어디로 갔는지만 적습니다.")
    print("끝나면 `python .claude/skills/doc-gardening/scripts/gardening.py check` 와 doc-integrity 를 돌립니다.")
    return 0


# ── check ───────────────────────────────────────────────────────────


def sections_of(readme_text):
    """README 를 제목 단위로 갈라, 각 구간이 **등록한** 파일명 집합을 돌려준다.

    목차 행은 `| [파일](href) | 설명 |` 이라 **줄의 첫 링크**가 그 행의 문서다.
    설명 칸의 링크(「이제 볼 곳」 등)는 등록이 아니므로 세지 않는다.
    """
    out = []  # (heading, set(basenames))
    heading, links = "(머리)", set()
    for line in readme_text.split("\n"):
        m = HEADING.match(line)
        if m:
            out.append((heading, links))
            heading, links = m.group(2), set()
            continue
        first = LINK.search(line)
        if first:
            links.add(os.path.basename(first.group(1)))
    out.append((heading, links))
    return out


def is_retired(path):
    for line in read(path).split("\n")[:12]:
        if BANNER.match(line):
            return True
    return False


def check_retirement():
    findings = []
    readme_cache = {}
    for path in walk(RETIRE_ROOTS, (".md",)):
        name = os.path.basename(path)
        if name in ("README.md", "000-template.md"):
            continue
        doc_rel = rel(path)
        retired = is_retired(path)
        readme = readme_for(doc_rel)
        if not readme:
            continue
        if readme not in readme_cache:
            readme_cache[readme] = sections_of(read(os.path.join(REPO, readme)))
        under_retired, under_current = False, False
        for heading, links in readme_cache[readme]:
            if name not in links:
                continue
            if "은퇴" in heading:
                under_retired = True
            else:
                under_current = True
        if retired and not under_retired:
            findings.append(f"{doc_rel}: 은퇴 배너가 있는데 {readme} 의 「은퇴」 절에 없습니다")
        if retired and under_current:
            findings.append(f"{doc_rel}: 은퇴했는데 {readme} 의 현행 표에도 남아 있습니다 — 「은퇴」 절로 내리세요")
        if not retired and under_retired:
            findings.append(f"{doc_rel}: {readme} 「은퇴」 절에 있는데 문서 머리에 은퇴 배너가 없습니다")
    return findings


def check_rfc_dates():
    findings = []
    for path in walk(("rfc",), (".md",)):
        name = os.path.basename(path)
        if not re.match(r"^\d{3}-", name) or name.startswith("000-"):
            continue
        text = read(path)
        m = RFC_LAST.search(text)
        if not m:
            continue
        last = m.group(1)
        tail = text.split("## 개정 이력", 1)
        if len(tail) < 2:
            continue
        dates = ROW_DATE.findall(tail[1])
        if dates and max(dates) > last:
            findings.append(f"{rel(path)}: 「최종 개정: {last}」 인데 개정 이력의 마지막이 {max(dates)} 입니다")
    return findings


def git_last(doc_rel):
    try:
        out = subprocess.run(
            ["git", "log", "-1", "--format=%cs", "--", doc_rel],
            cwd=REPO, capture_output=True, text=True, check=False,
        )
        return out.stdout.strip() or None
    except OSError:
        return None


def cmd_check(args):
    findings = check_retirement() + check_rfc_dates()
    if args.verbose:
        print("은퇴한 문서:")
        for path in sorted(walk(RETIRE_ROOTS, (".md",))):
            if os.path.basename(path) != "README.md" and is_retired(path):
                print(f"  {rel(path)}  (마지막 커밋 {git_last(rel(path)) or '?'})")
        print()
    if not findings:
        print("문제 없음 — 은퇴 배너와 README 「은퇴」 절이 맞물리고, RFC 「최종 개정」이 이력과 맞습니다.")
        return 0
    for f in findings:
        print(f"✗ {f}")
    print(f"\n{len(findings)}건. 규칙은 rfc/001-repo-structure.md 「은퇴」.")
    return 1


# ── main ────────────────────────────────────────────────────────────


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    m = sub.add_parser("markers", help="열린 자기 표기를 file:line 으로")
    m.add_argument("--all", action="store_true", help="취소선으로 닫힌 것까지")
    m.add_argument("--count", action="store_true", help="파일별 건수만")
    m.set_defaults(fn=cmd_markers)

    i = sub.add_parser("inbound", help="문서를 가리키는 파일")
    i.add_argument("doc", help="저장소 루트 기준 경로")
    i.set_defaults(fn=cmd_inbound)

    r = sub.add_parser("retire", help="은퇴 배너를 넣는다")
    r.add_argument("doc")
    r.add_argument("--why", required=True, help="왜 끝났나 한 줄")
    r.add_argument("--see", required=True, help="이제 볼 곳 — 마크다운 링크 그대로")
    r.add_argument("--date", help="YYYY-MM-DD (기본 오늘)")
    r.set_defaults(fn=cmd_retire)

    c = sub.add_parser("check", help="은퇴 상태와 README 「은퇴」 절, RFC 최종 개정일 검사")
    c.add_argument("--verbose", "-v", action="store_true")
    c.set_defaults(fn=cmd_check)

    args = p.parse_args()
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
