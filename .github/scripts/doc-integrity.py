#!/usr/bin/env python3
"""문서 무결성 검사 — 규약이 실제 저장소와 어긋나지 않는지 본다.

이 저장소는 사람과 에이전트가 함께 쓰고, 에이전트는 문서를 그대로 믿습니다.
그래서 링크가 깨지거나 목차에 없는 문서는 "틀린 지도"가 되고, 비용이 사람보다 큽니다.

근거: RFC-001 저장소 구조 규약 · CLAUDE.md 「ID 체계」 · ADR-017

로컬에서:
    python .github/scripts/doc-integrity.py

CI에서 (ADR 불변성까지 검사하려면 비교 기준이 필요합니다):
    python .github/scripts/doc-integrity.py --base <sha> --head <sha>
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

# Windows 콘솔은 기본이 cp949 라 '—' 같은 글자에서 죽습니다.
# 로컬에서도 그대로 돈다는 것이 이 검사기의 전제이므로 출력 인코딩을 고정합니다.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8")

# ─────────────────────────────────────────────────────────────────────────────
# 설정 — 규약이 바뀌면 여기를 고칩니다 (그리고 rfc/001-repo-structure.md 도).
# ─────────────────────────────────────────────────────────────────────────────

# 검사하지 않는 폴더.
#   src/       create-next-app 이 생성하고 next dev 가 다시 씁니다 (RFC-001 「src/」)
#   archived/  읽되 갱신하지 않고 이름도 바꾸지 않습니다 (RFC-001 「assets/」)
#   .venv/     services/ 의 파이썬 의존성. node_modules 와 같은 이유입니다 —
#              남의 패키지 문서를 우리 규약으로 검사할 수 없습니다 (RFC-001 「services/」)
SKIP_DIRS = {".git", "node_modules", ".next", "src", "archived", ".venv", "__pycache__"}

# 검사하지 않는 파일.
#   assets/artifacts/handoff/*/PR.md
#     넘겨받은 원문 그대로 두는 스냅샷이라 **고칠 수 없습니다** (RFC-003 규칙 2).
#     시안 설명에 「[서류 초안 열기](고스트)」 같은 괄호가 흔한데, 마크다운 링크로
#     읽히면 없는 파일을 가리키게 됩니다. 우리가 쓴 README.md 는 그대로 검사합니다.
SKIP_HANDOFF_PR = ("assets", "artifacts", "handoff")

# 파일명 규약 (RFC-001 「파일명 규약」).
NNN_RE = re.compile(r"^\d{3}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$")
MMDD_RE = re.compile(r"^\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$")

# docs/research/ 는 읽는 순서가 있는 연작이라 순번을 씁니다 (RFC-001 「파일명 규약」).
NN_RE = re.compile(r"^\d{2}-\S+\.md$")

NNN_DIRS = ("rfc", "decisions")
MMDD_DIRS = ("spec", "docs")
NN_DIRS = ("docs/research",)

# 규약이 이름을 직접 지정한 파일 — 파일명 검사에서 뺍니다.
FILENAME_EXEMPT = {"README.md", "AGENDA.md"}

# ID 가 정의된 곳 (CLAUDE.md 「ID 체계」).
# 문서가 옮겨지면 여기도 같이 고칩니다 — 경로가 사라지면 검사기가 그렇다고 말합니다.
ID_SOURCES = {
    "F": "spec/common/08-14-features.md",
    "S": "spec/frontend/08-14-screens.md",
    "CH": "spec/backend/08-14-channel-matrix.md",
}

ID_PATTERNS = {
    "F": re.compile(r"\bF-\d{2}[a-z]?\b"),
    "S": re.compile(r"\bS-\d{2}\b"),
    "CH": re.compile(r"\bCH-[a-z][a-z0-9-]*\b"),
}

ADR_REF = re.compile(r"\bADR-(\d{1,4})\b")
RFC_REF = re.compile(r"\bRFC-(\d{1,4})\b")

# 규약을 설명하며 쓰는 자리표시자 — 실제 참조가 아닙니다 (예: "ID(F-xx, S-xx, CH-xxx)").
ID_PLACEHOLDER = re.compile(r"^(?:F|S|CH)-x+$", re.IGNORECASE)

# 목차 등록을 강제할 폴더 — 그 폴더의 README.md 가 형제 문서를 전부 가리켜야 합니다.
# RFC-001: "목차에 없는 문서는 사실상 없는 문서입니다."
INDEXED_DIRS = ("spec", "rfc", "decisions", "docs/plans", "docs/research")

# 링크·이미지. 코드블록을 걷어낸 본문에만 적용합니다.
LINK_RE = re.compile(r"!?\[[^\]]*\]\(\s*([^)\s]+?)\s*(?:\"[^\"]*\")?\s*\)")
HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")

MAX_REPORT = 20  # 검사 항목당 출력 상한 — 벽 같은 로그를 만들지 않습니다.


class Finding:
    def __init__(self, check: str, where: str, message: str, hint: str = ""):
        self.check = check
        self.where = where
        self.message = message
        self.hint = hint


# ─────────────────────────────────────────────────────────────────────────────
# 본문 다루기
# ─────────────────────────────────────────────────────────────────────────────


def strip_code(text: str, inline: bool = True) -> str:
    """펜스 코드블록을 지웁니다. 줄 번호는 보존합니다.

    코드블록 안의 링크는 예시이지 참조가 아닙니다 —
    RFC-001 이 출처 줄 형식을 보여주며 쓴 `<상대경로>` 같은 것.

    inline=True 면 인라인 코드 안까지 비웁니다(링크를 찾을 때).
    제목을 읽을 때는 False — 백틱은 앵커에서 벗겨질 뿐 글자는 남기 때문입니다
    (`### 8.3 \\`info\\` 종류` → `#83-info-종류`).
    """
    out, in_fence = [], False
    for line in text.split("\n"):
        if re.match(r"^\s*(```|~~~)", line):
            in_fence = not in_fence
            out.append("")
            continue
        if in_fence:
            out.append("")
            continue
        out.append(
            re.sub(r"`[^`\n]*`", lambda m: " " * len(m.group(0)), line) if inline else line
        )
    return "\n".join(out)


def slugify(heading: str) -> str:
    """GitHub 앵커 규칙 근사 — 소문자화, 서식·구두점 제거, 공백은 하이픈."""
    s = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", heading)  # 제목 안 링크는 글자만
    s = re.sub(r"[`*_~]", "", s).strip().lower()
    s = re.sub(r"[^\w\s-]", "", s, flags=re.UNICODE)
    # 공백은 하나씩 하이픈이 됩니다 — 묶어서 줄이지 않습니다.
    # "11.1 org — 기관" 은 마침표·대시가 빠지며 공백이 둘 남아 `111-org--기관` 이 됩니다.
    return re.sub(r"\s", "-", s)


def anchors_of(text: str) -> set[str]:
    """문서가 제공하는 앵커. 같은 제목이 여러 번이면 -1, -2 가 붙습니다."""
    seen: dict[str, int] = defaultdict(int)
    result = set()
    for line in strip_code(text, inline=False).split("\n"):
        m = HEADING_RE.match(line)
        if not m:
            continue
        base = slugify(m.group(2))
        if not base:
            continue
        n = seen[base]
        seen[base] += 1
        result.add(base if n == 0 else f"{base}-{n}")
    return result


def md_files(root: Path) -> list[Path]:
    found = []
    for p in sorted(root.rglob("*.md")):
        parts = p.relative_to(root).parts
        if any(part in SKIP_DIRS for part in parts):
            continue
        if parts[: len(SKIP_HANDOFF_PR)] == SKIP_HANDOFF_PR and p.name == "PR.md":
            continue
        found.append(p)
    return found


def rel(root: Path, p: Path) -> str:
    return p.relative_to(root).as_posix()


# ─────────────────────────────────────────────────────────────────────────────
# 검사
# ─────────────────────────────────────────────────────────────────────────────


def check_links_and_anchors(root: Path, docs: list[Path]) -> list[Finding]:
    """1·2. 죽은 상대링크 · 깨진 앵커."""
    findings = []
    anchor_cache: dict[Path, set[str]] = {}

    for p in docs:
        body = strip_code(p.read_text(encoding="utf-8", errors="replace"))
        here = rel(root, p)
        for lineno, line in enumerate(body.split("\n"), 1):
            for target in LINK_RE.findall(line):
                if re.match(r"^(https?:|mailto:|#|<)", target):
                    if target.startswith("#"):  # 문서 안 앵커
                        anchors = anchor_cache.setdefault(
                            p, anchors_of(p.read_text(encoding="utf-8", errors="replace"))
                        )
                        if target[1:].lower() not in anchors:
                            findings.append(
                                Finding("앵커", f"{here}:{lineno}", f"자기 문서에 없는 앵커 — {target}")
                            )
                    continue

                path_part, _, frag = target.partition("#")
                dest = (p.parent / path_part).resolve() if path_part else p.resolve()

                if not dest.exists():
                    findings.append(
                        Finding(
                            "링크",
                            f"{here}:{lineno}",
                            f"가리키는 파일이 없습니다 — {target}",
                            "파일이 옮겨졌거나 이름이 바뀌었습니다. RFC-001: MM-dd 는 개정해도 바꾸지 않습니다.",
                        )
                    )
                    continue

                if frag and dest.suffix == ".md" and dest.is_file():
                    anchors = anchor_cache.setdefault(
                        dest, anchors_of(dest.read_text(encoding="utf-8", errors="replace"))
                    )
                    if frag.lower() not in anchors:
                        findings.append(
                            Finding("앵커", f"{here}:{lineno}", f"대상 문서에 없는 앵커 — {target}")
                        )
    return findings


def check_ids(root: Path, docs: list[Path]) -> list[Finding]:
    """3. 정의되지 않은 ID 참조."""
    findings = []

    defined: dict[str, set[str]] = {}
    for kind, src in ID_SOURCES.items():
        src_path = root / src
        if not src_path.exists():
            findings.append(
                Finding(
                    "ID",
                    src,
                    f"{kind}-xx 를 정의하는 문서가 없습니다",
                    "문서를 옮겼다면 .github/scripts/doc-integrity.py 의 ID_SOURCES 도 같이 고칩니다.",
                )
            )
            defined[kind] = set()
            continue
        # `inline=False` — **정의하는 쪽은 인라인 코드 안까지 읽습니다.**
        # 채널 매트릭스는 아홉 유형을 전부 `CH-bank` 처럼 백틱 안에 적어서,
        # 인라인까지 지우면 **정의가 0개가 되고 검사가 통째로 죽습니다**
        # (F·S 는 맨몸으로도 적혀 있어 드러나지 않았습니다) — 2026-08-27 발견.
        text = strip_code(src_path.read_text(encoding="utf-8", errors="replace"), inline=False)
        defined[kind] = set(ID_PATTERNS[kind].findall(text))

    adr_nums = {int(p.name[:3]) for p in (root / "decisions").glob("[0-9][0-9][0-9]-*.md")}
    rfc_nums = {int(p.name[:3]) for p in (root / "rfc").glob("[0-9][0-9][0-9]-*.md")}

    for p in docs:
        here = rel(root, p)
        body = strip_code(p.read_text(encoding="utf-8", errors="replace"))
        for lineno, line in enumerate(body.split("\n"), 1):
            for num in ADR_REF.findall(line):
                if int(num) not in adr_nums:
                    findings.append(
                        Finding("ID", f"{here}:{lineno}", f"없는 ADR 을 가리킵니다 — ADR-{num}")
                    )
            for num in RFC_REF.findall(line):
                if int(num) not in rfc_nums:
                    findings.append(
                        Finding("ID", f"{here}:{lineno}", f"없는 RFC 를 가리킵니다 — RFC-{num}")
                    )
            for kind, pat in ID_PATTERNS.items():
                if here == ID_SOURCES.get(kind):
                    continue
                for tok in pat.findall(line):
                    if ID_PLACEHOLDER.match(tok):
                        continue
                    if tok not in defined[kind]:
                        findings.append(
                            Finding(
                                "ID",
                                f"{here}:{lineno}",
                                f"{ID_SOURCES[kind]} 에 정의되지 않은 ID — {tok}",
                            )
                        )
    return findings


def check_filenames(root: Path, docs: list[Path]) -> list[Finding]:
    """4. 파일명 규약 (RFC-001 「파일명 규약」)."""
    findings = []
    for p in docs:
        here = rel(root, p)
        top = here.split("/")[0]
        if "/" not in here or p.name in FILENAME_EXEMPT:
            continue  # 루트 md 와 규약이 이름을 지정한 파일은 예외

        if any(here.startswith(d + "/") for d in NN_DIRS):
            if not NN_RE.match(p.name):
                findings.append(Finding("파일명", here, "NN-{제목}.md 여야 합니다 (2자리 순번)"))
        elif top in NNN_DIRS:
            if not NNN_RE.match(p.name):
                findings.append(
                    Finding("파일명", here, "NNN-{slug}.md 여야 합니다 (3자리 번호 + 영문 kebab-case)")
                )
        elif top in MMDD_DIRS:
            if not MMDD_RE.match(p.name):
                findings.append(
                    Finding("파일명", here, "MM-dd-{slug}.md 여야 합니다 (월-일 + 영문 kebab-case)")
                )
    return findings


def check_numbers(root: Path) -> list[Finding]:
    """5. 번호 중복 — RFC·ADR 은 번호가 곧 ID 입니다."""
    findings = []
    for folder, label in (("decisions", "ADR"), ("rfc", "RFC")):
        by_num: dict[str, list[str]] = defaultdict(list)
        for p in (root / folder).glob("[0-9][0-9][0-9]-*.md"):
            by_num[p.name[:3]].append(p.name)
        for num, names in sorted(by_num.items()):
            if len(names) > 1:
                findings.append(
                    Finding(
                        "번호",
                        f"{folder}/",
                        f"{label}-{num} 번호를 {len(names)}개가 씁니다 — {', '.join(sorted(names))}",
                        "번호는 재사용하지 않습니다 (RFC-001 「하지 않는 것」).",
                    )
                )
    return findings


def check_index(root: Path, docs: list[Path]) -> list[Finding]:
    """6. 목차 등록 — 목차에 없는 문서는 사실상 없는 문서입니다."""
    findings = []
    by_dir: dict[str, list[Path]] = defaultdict(list)
    for p in docs:
        by_dir[p.parent.relative_to(root).as_posix()].append(p)

    for target in INDEXED_DIRS:
        index = root / target / "README.md"
        if not index.exists():
            findings.append(Finding("목차", f"{target}/README.md", "목차 파일이 없습니다"))
            continue
        index_text = index.read_text(encoding="utf-8", errors="replace")

        # 하위 폴더까지 훑되, 자기 README 를 가진 하위 폴더는 그쪽이 책임집니다.
        for dirname, files in by_dir.items():
            if dirname != target and not dirname.startswith(target + "/"):
                continue
            owner = root / dirname / "README.md"
            responsible = index if dirname == target or not owner.exists() else owner
            owner_text = (
                index_text
                if responsible == index
                else responsible.read_text(encoding="utf-8", errors="replace")
            )
            for p in files:
                if p.name == "README.md" or p.name == "000-template.md":
                    continue
                if p.name not in owner_text:
                    findings.append(
                        Finding(
                            "목차",
                            rel(root, p),
                            f"{rel(root, responsible)} 목차에 없습니다",
                            "목차에 없는 문서는 에이전트에게 존재하지 않는 것과 같습니다 (RFC-001).",
                        )
                    )
    return findings


def _decision_parts(text: str) -> tuple[str, str]:
    """ADR 에서 '결정 내용'에 해당하는 부분만 뽑습니다 — H1 의 결정 문장과 「## 결정」 절."""
    h1 = ""
    for line in text.split("\n"):
        m = re.match(r"^#\s+(.*)$", line)
        if m:
            # "ADR-001." / "0001." 같은 번호 접두는 떼어냅니다 — 번호 표기 정규화는 결정 변경이 아닙니다.
            h1 = re.sub(r"^(?:ADR-)?\d{1,4}\.\s*", "", m.group(1)).strip()
            break

    section, collecting = [], False
    for line in text.split("\n"):
        if re.match(r"^##\s", line):
            collecting = line.strip().startswith("## 결정")
            continue
        if collecting:
            section.append(line.rstrip())
    return h1, "\n".join(section).strip()


def check_adr_immutability(root: Path, base: str, head: str) -> list[Finding]:
    """7. ADR 불변성 — 한번 쓴 ADR 의 '결정'은 고치지 않습니다.

    맥락·근거·결과·링크·오탈자·상태 줄은 고쳐도 됩니다 (RFC-001 이 허용).
    막는 것은 H1 의 결정 문장과 「## 결정」 절, 그리고 삭제·번호 변경입니다.
    """
    findings = []
    out = _git(root, "diff", "--name-status", "-M", base, head, "--", "decisions/")
    if out is None:
        return findings

    for row in out.splitlines():
        cols = row.split("\t")
        status = cols[0]
        name = cols[-1]
        if not re.match(r"^decisions/\d{3}-.*\.md$", name):
            continue

        if status.startswith("D"):
            findings.append(
                Finding("ADR", name, "ADR 을 지웠습니다", "뒤집을 때는 새 번호를 쓰고 기존 것을 `대체됨`으로 표시합니다.")
            )
            continue
        if status.startswith("R"):
            findings.append(
                Finding("ADR", f"{cols[1]} → {cols[2]}", "ADR 파일명을 바꿨습니다", "번호가 곧 ID 입니다. 번호는 재사용하지도, 옮기지도 않습니다.")
            )
            continue
        if not status.startswith("M"):
            continue

        old = _git(root, "show", f"{base}:{name}")
        new = _git(root, "show", f"{head}:{name}")
        if old is None or new is None:
            continue

        old_h1, old_body = _decision_parts(old)
        new_h1, new_body = _decision_parts(new)
        if old_h1 != new_h1:
            findings.append(
                Finding("ADR", name, "H1 의 결정 문장이 바뀌었습니다", f"이전: {old_h1}\n           지금: {new_h1}")
            )
        if old_body != new_body:
            findings.append(
                Finding("ADR", name, "「## 결정」 절의 내용이 바뀌었습니다", "결정을 바꾸려면 새 ADR 을 쓰고 이 문서는 `대체됨`으로 표시합니다.")
            )
    return findings


def check_superseded(root: Path) -> list[Finding]:
    """8. 대체 관계 역링크 — 대체한 쪽도 대체당한 쪽을 언급해야 이력이 이어집니다."""
    findings = []
    adr_text = {}
    for p in (root / "decisions").glob("[0-9][0-9][0-9]-*.md"):
        adr_text[int(p.name[:3])] = (p, p.read_text(encoding="utf-8", errors="replace"))

    for num, (p, text) in sorted(adr_text.items()):
        head = "\n".join(text.split("\n")[:12])
        m = re.search(r"대체됨\s*\(?\s*→\s*(?:ADR-)?(\d{1,4})", head)
        if not m:
            continue
        target = int(m.group(1))
        if target not in adr_text:
            findings.append(
                Finding("ADR", rel(root, p), f"없는 ADR 로 대체됐다고 적혀 있습니다 — ADR-{target:03d}")
            )
            continue
        if not re.search(rf"\bADR-0*{num}\b", adr_text[target][1]):
            findings.append(
                Finding(
                    "ADR",
                    rel(root, adr_text[target][0]),
                    f"ADR-{num:03d} 를 대체했는데 그 사실을 적지 않았습니다",
                    "대체한 쪽에서도 무엇을 뒤집었는지 밝혀야 이력이 이어집니다.",
                )
            )
    return findings


def _git(root: Path, *args: str) -> str | None:
    try:
        r = subprocess.run(
            ["git", "-c", "core.quotePath=false", *args],
            cwd=root,
            capture_output=True,
            check=False,
        )
    except FileNotFoundError:
        return None
    if r.returncode != 0:
        return None
    return r.stdout.decode("utf-8", errors="replace")


# ─────────────────────────────────────────────────────────────────────────────


def main() -> int:
    ap = argparse.ArgumentParser(description="문서 무결성 검사")
    ap.add_argument("--root", default=None, help="저장소 루트 (기본: 이 스크립트 기준)")
    ap.add_argument("--base", default=None, help="비교 기준 커밋 — ADR 불변성 검사에 필요")
    ap.add_argument("--head", default=None, help="비교 대상 커밋")
    args = ap.parse_args()

    root = Path(args.root).resolve() if args.root else Path(__file__).resolve().parents[2]
    docs = md_files(root)

    findings: list[Finding] = []
    findings += check_links_and_anchors(root, docs)
    findings += check_ids(root, docs)
    findings += check_filenames(root, docs)
    findings += check_numbers(root)
    findings += check_index(root, docs)
    findings += check_superseded(root)

    if args.base and args.head:
        findings += check_adr_immutability(root, args.base, args.head)
    else:
        print("· ADR 불변성 검사는 --base/--head 가 있어야 돕니다. 건너뜁니다.\n")

    print(f"문서 {len(docs)}개를 검사했습니다 — {root}\n")

    if not findings:
        print("문제 없습니다.")
        return 0

    grouped: dict[str, list[Finding]] = defaultdict(list)
    for f in findings:
        grouped[f.check].append(f)

    for check in ("링크", "앵커", "ID", "파일명", "번호", "목차", "ADR"):
        items = grouped.get(check)
        if not items:
            continue
        print(f"■ {check} — {len(items)}건")
        for f in items[:MAX_REPORT]:
            print(f"    {f.where}")
            print(f"      {f.message}")
            if f.hint:
                print(f"      → {f.hint}")
        if len(items) > MAX_REPORT:
            print(f"    … 외 {len(items) - MAX_REPORT}건")
        print()

    print(f"총 {len(findings)}건. 규약은 rfc/001-repo-structure.md 를 보세요.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
