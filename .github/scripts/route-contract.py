#!/usr/bin/env python3
"""라우트 규약 검사 — 껍데기를 지나지 않는 라우트를 막는다.

`handleRoute` 가 계측 헤더·속도 제한·인증·에러 봉투를 **한 자리에서** 붙입니다
(spec/common/08-14-api.md §1.1 · §1.3 · §1.4 · §5.1). 라우트가 그 자리를 비껴가면
어느 한 응답만 조용히 규약을 어기는데, **어기는 쪽이 정상으로 보입니다** —
응답은 200 으로 잘 나가고 빠진 것은 헤더나 카운터뿐이라 사람 눈에 안 띕니다.

경로 파라미터도 같습니다. 링크 토큰은 사실상 비밀번호이고(ADR-021 · ADR-039)
`case_id` 와 규격이 같아 **형식으로는 둘을 못 가릅니다.** 그래서 「어느 사건인가」는
반드시 조회로 답해야 하는데, 그 규칙은 문서에만 두면 다음 라우트에서 샙니다.

근거: ADR-028 「라우트는 얇게, 모듈이 두껍게」 · ADR-039 · RFC-001 「CI가 강제합니다」

로컬에서 (CI 와 같은 명령입니다):
    python .github/scripts/route-contract.py
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path

# Windows 콘솔은 기본이 cp949 라 '—' 같은 글자에서 죽습니다.
# 로컬에서도 그대로 돈다는 것이 이 검사기의 전제이므로 출력 인코딩을 고정합니다.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8")

# ─────────────────────────────────────────────────────────────────────────────
# 설정 — 규약이 바뀌면 여기를 고칩니다 (그리고 rfc/001-repo-structure.md 도).
# ─────────────────────────────────────────────────────────────────────────────

ROUTE_GLOB = "src/app/api/**/route.ts"

# Next 의 라우트 핸들러 이름. 이것만 라우트로 봅니다 —
# `export const runtime` 같은 설정 export 는 검사 대상이 아닙니다.
HTTP_METHODS = ("GET", "POST", "PATCH", "PUT", "DELETE", "HEAD", "OPTIONS")

# 적지 않아도 껍데기가 'read' 를 겁니다 → lib/request.ts `defaultRateFor`.
# 나머지 메서드는 **기본이 없어서**, 안 적으면 상한이 통째로 안 걸립니다.
RATE_OPTIONAL_METHODS = ("GET", "HEAD")

# 이 이름으로 오는 경로 파라미터는 전용 헬퍼로만 읽습니다 → lib/request.ts.
# 값: (세그먼트 이름, 그 세그먼트를 다루는 헬퍼들)
GUARDED_SEGMENTS = {
    "case_token": ("caseTokenOf", "caseIdOf"),
    "evidence_id": ("ulidParamOf",),
    "step_id": ("ulidParamOf",),
    "message_id": ("ulidParamOf",),
}

# URL 에 오는 것은 링크 토큰 하나뿐입니다 → ADR-039.
# `case_id` 는 ULID 라 앞자리가 생성 시각이고, 주소에 쓰면 이웃 사건을 좁혀서
# 찔러볼 수 있습니다. 폴더 이름이 곧 파라미터 이름이라 여기서 막습니다.
FORBIDDEN_SEGMENTS = {
    "case_id": "URL 에 오는 것은 링크 토큰뿐입니다 — 폴더를 `[case_token]` 으로 (ADR-039)",
}

# 라우트가 직접 만들면 계측 헤더(§1.1)가 빠집니다. 붙이는 자리는 `ok`·`fail` 하나입니다.
FORBIDDEN_RESPONSE = (
    (re.compile(r"\bnew\s+Response\s*\("), "`new Response(`"),
    (re.compile(r"\bResponse\s*\.\s*json\s*\("), "`Response.json(`"),
    (re.compile(r"\bNextResponse\b"), "`NextResponse`"),
)

SEGMENT_RE = re.compile(r"\[(\.{3})?([a-zA-Z_][a-zA-Z0-9_]*)\]")


@dataclass(frozen=True)
class Finding:
    path: str
    line: int
    rule: str
    message: str


# ─────────────────────────────────────────────────────────────────────────────
# 주석 지우기 — 문자열 안의 `//` 를 주석으로 오해하지 않게 상태를 봅니다.
# ─────────────────────────────────────────────────────────────────────────────


def strip_comments(src: str) -> str:
    """주석을 공백으로 바꾼다. **줄 수와 오프셋을 보존합니다** — 줄 번호를 그대로 쓰려고.

    문자열 리터럴은 지우지 않습니다. `rate: 'caseCreate'` 를 읽어야 하기 때문입니다.
    정규식 리터럴(`/.../`)은 라우트 파일에 나온 적이 없어 다루지 않습니다 —
    나오면 그 안의 `//` 를 주석으로 오해할 수 있으니, 그때 여기를 고칩니다.
    """
    out: list[str] = []
    i, n = 0, len(src)
    state = "code"  # code | line | block | sq | dq | tpl
    while i < n:
        c = src[i]
        nxt = src[i + 1] if i + 1 < n else ""
        if state == "code":
            if c == "/" and nxt == "/":
                state, out, i = "line", out + ["  "], i + 2
                continue
            if c == "/" and nxt == "*":
                state, out, i = "block", out + ["  "], i + 2
                continue
            if c == "'":
                state = "sq"
            elif c == '"':
                state = "dq"
            elif c == "`":
                state = "tpl"
            out.append(c)
        elif state == "line":
            if c == "\n":
                state = "code"
                out.append("\n")
            else:
                out.append(" ")
        elif state == "block":
            if c == "*" and nxt == "/":
                state, out, i = "code", out + ["  "], i + 2
                continue
            out.append("\n" if c == "\n" else " ")
        else:  # 문자열 안
            if c == "\\":
                out.append(c)
                if i + 1 < n:
                    out.append(src[i + 1])
                i += 2
                continue
            if (
                (state == "sq" and c == "'")
                or (state == "dq" and c == '"')
                or (state == "tpl" and c == "`")
            ):
                state = "code"
            out.append(c)
        i += 1
    return "".join(out)


def line_of(src: str, offset: int) -> int:
    return src.count("\n", 0, offset) + 1


# ─────────────────────────────────────────────────────────────────────────────
# 검사
# ─────────────────────────────────────────────────────────────────────────────


def export_blocks(code: str) -> list[tuple[str, int, str]]:
    """HTTP 메서드 export 를 `(메서드, 시작 오프셋, 본문)` 으로 자른다.

    다음 최상위 `export` 까지를 한 덩어리로 봅니다. 파일에 핸들러가 둘 이상일 때
    (`GET` 과 `POST` 가 한 파일에) 속도 제한을 각각 봐야 하기 때문입니다.
    """
    starts: list[tuple[str, int]] = []
    for m in re.finditer(
        r"^export\s+(?:async\s+)?(?:function\s+)?(?:const\s+)?([A-Z]+)\b",
        code,
        re.MULTILINE,
    ):
        if m.group(1) in HTTP_METHODS:
            starts.append((m.group(1), m.start()))

    bounds = [m.start() for m in re.finditer(r"^export\b", code, re.MULTILINE)]
    blocks: list[tuple[str, int, str]] = []
    for method, start in starts:
        after = [b for b in bounds if b > start]
        end = after[0] if after else len(code)
        blocks.append((method, start, code[start:end]))
    return blocks


def check_route(root: Path, path: Path) -> list[Finding]:
    rel = path.relative_to(root).as_posix()
    raw = path.read_text(encoding="utf-8")
    code = strip_comments(raw)
    found: list[Finding] = []

    segments = [m.group(2) for m in SEGMENT_RE.finditer(rel)]

    # R4a · 폴더 이름 — 주소에 내부 식별자를 쓰지 않습니다.
    for seg in segments:
        if seg in FORBIDDEN_SEGMENTS:
            found.append(Finding(rel, 1, "R4", f"경로에 `[{seg}]` — {FORBIDDEN_SEGMENTS[seg]}"))

    blocks = export_blocks(code)
    if not blocks:
        found.append(Finding(rel, 1, "R1", "HTTP 메서드 export 가 없습니다 — 라우트 파일이 맞습니까"))

    for method, start, body in blocks:
        line = line_of(code, start)

        # R1 · 껍데기를 지나는가.
        if "handleRoute(" not in body:
            found.append(
                Finding(rel, line, "R1", f"`{method}` 가 `handleRoute` 를 안 지납니다 — 계측 헤더·인증·에러 봉투가 빠집니다")
            )
            continue  # 껍데기를 안 지나면 아래 검사는 뜻이 없습니다

        # R3 · 상한을 밝혔는가.
        if method not in RATE_OPTIONAL_METHODS:
            has_upfront = re.search(r"\brate\s*:\s*'[a-zA-Z]+'", body) is not None
            has_case_scope = "ctx.limit(" in body or ".limit(" in body
            if not (has_upfront or has_case_scope):
                found.append(
                    Finding(
                        rel,
                        line,
                        "R3",
                        f"`{method}` 에 상한이 없습니다 — `rate` 를 안 적으면 껍데기가 `'none'` 으로 둡니다. "
                        "일부러 안 걸 것이면 `rate: 'none'` 으로 밝히세요",
                    )
                )

    # R2 · 응답을 직접 만들지 않는가.
    for pattern, label in FORBIDDEN_RESPONSE:
        for m in pattern.finditer(code):
            found.append(
                Finding(rel, line_of(code, m.start()), "R2", f"{label} 을 직접 만듭니다 — 계측 헤더가 빠집니다 (§1.1). `{{ body, status }}` 를 돌려주세요")
            )

    # R4b~c · 지켜야 하는 파라미터를 헬퍼로 읽는가.
    for seg, helpers in GUARDED_SEGMENTS.items():
        if seg not in segments:
            continue
        if not any(f"{h}(" in code for h in helpers):
            names = " 또는 ".join(f"`{h}`" for h in helpers)
            found.append(Finding(rel, 1, "R4", f"`[{seg}]` 를 {names} 없이 다룹니다"))

    # R4d · 지켜야 하는 파라미터를 `params` 에서 직접 꺼내지 않는가.
    #
    # ⚠️ **타입 자리를 잡으면 안 됩니다.** 라우트의 두 번째 인자는
    # `route: { params: Promise<{ case_token: string }> }` 라고 **반드시** 적어야
    # 하고, 그건 값을 읽는 것이 아닙니다. 그래서 「값이 나오는 모양」 둘만 봅니다.
    for seg in GUARDED_SEGMENTS:
        for pattern in (
            # const { case_token } = await route.params
            rf"\{{[^{{}}]*\b{seg}\b[^{{}}]*\}}\s*=\s*(?:await\s+)?[\w.]*\bparams\b",
            # (await route.params).case_token
            rf"\bparams\s*\)?\s*\.\s*{seg}\b",
        ):
            for m in re.finditer(pattern, code):
                found.append(
                    Finding(
                        rel,
                        line_of(code, m.start()),
                        "R4",
                        f"`params` 에서 `{seg}` 를 직접 꺼냅니다 — 전용 헬퍼로 읽으세요",
                    )
                )

    return found


def main() -> int:
    ap = argparse.ArgumentParser(description="라우트 규약 검사")
    ap.add_argument("--root", default=None, help="저장소 뿌리 (기본: 이 스크립트의 두 단계 위)")
    args = ap.parse_args()

    root = Path(args.root).resolve() if args.root else Path(__file__).resolve().parents[2]
    routes = sorted(root.glob(ROUTE_GLOB))

    if not routes:
        print(f"라우트를 하나도 못 찾았습니다: {root / ROUTE_GLOB}")
        return 1

    findings: list[Finding] = []
    for path in routes:
        findings.extend(check_route(root, path))

    print(f"라우트 {len(routes)}개를 봤습니다.\n")
    if not findings:
        print("규약을 어긴 자리가 없습니다.")
        return 0

    by_rule: dict[str, list[Finding]] = {}
    for f in findings:
        by_rule.setdefault(f.rule, []).append(f)

    titles = {
        "R1": "껍데기를 지나지 않는 라우트",
        "R2": "응답을 직접 만드는 자리",
        "R3": "상한을 밝히지 않은 라우트",
        "R4": "경로 파라미터를 규약 밖으로 읽는 자리",
    }
    for rule in sorted(by_rule):
        print(f"[{rule}] {titles.get(rule, '')}")
        for f in by_rule[rule]:
            print(f"  {f.path}:{f.line}")
            print(f"      {f.message}")
        print()

    print(f"어긴 자리 {len(findings)}건.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
