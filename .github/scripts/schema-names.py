#!/usr/bin/env python3
"""표·칸 이름 검사 — 마이그레이션에 없는 이름으로 SQL 을 쓰는 자리를 막는다.

## 왜 있나

`case_vault` 를 `case_case_vault` 로 적은 채 통과했습니다 (2026-08-24).
타입 검사·시험·빌드가 전부 초록이었습니다 — **SQL 문자열은 TypeScript 에게
그냥 문자열**이고, 그 문장을 실제로 돌리는 시험이 하나도 없었기 때문입니다.
서버를 띄워 손으로 눌러 보고서야 나왔습니다.

이 검사기는 그 한 종류를 겨눕니다. 마이그레이션 파일이 **무엇을 만들었는지**
읽어 두고, `src/**/*.ts` 안의 ``sql`…` `` 을 훑어 거기 나오는 표와 칸이
그 목록에 있는지 봅니다. 사람이 눈으로 하던 대조를 CI 가 매번 합니다.

## 못 잡는 것 — 이걸 알고 쓰세요

이름만 봅니다. **문장의 뜻은 안 봅니다.**

  · 정렬 순서가 틀린 것 (같은 날 `ORDER BY` 로 대화가 거꾸로 나온 버그)
  · `WHERE` 가 빠져 남의 사건을 건드리는 것
  · 타입이 안 맞는 것

그건 DB 를 붙여 실제로 돌려 보는 시험이 잡습니다 → QA 계획 Task 9 ⑥ ⓒ.

그리고 **조각을 이어 붙인 문장은 칸을 못 봅니다.** ``sql`${select(q)} AND org_id …` ``
처럼 `FROM` 이 다른 조각에 있으면 어느 표인지 알 수 없어서, 표를 하나도 못 찾은
문장은 통째로 건너뜁니다 — **모르면서 아는 척하는 것보다 낫습니다.**
조각 쪽(`select` 안)은 그 자체가 하나의 `sql` 템플릿이라 거기서 검사됩니다.

근거: ADR-019 「정본을 먼저 고치고 새 마이그레이션을 더한다」 ·
      ADR-049 「볼트를 같은 Postgres 의 case_vault 스키마로」 ·
      RFC-001 「CI가 강제합니다」

로컬에서 (CI 와 같은 명령입니다):
    python .github/scripts/schema-names.py
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

# Windows 콘솔은 기본이 cp949 라 '—' 같은 글자에서 죽습니다.
# 로컬에서도 그대로 돈다는 것이 이 검사기의 전제이므로 출력 인코딩을 고정합니다.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8")

# ─────────────────────────────────────────────────────────────────────────────
# 설정
# ─────────────────────────────────────────────────────────────────────────────

MIGRATION_GLOB = "src/migrations/*.sql"
CODE_BASES = ("src",)
SKIP_DIRS = {"node_modules", ".next", "dist", "build", ".turbo", ".git"}

DEFAULT_SCHEMA = "public"

# 이 표들은 마이그레이션이 만들지 않아도 있는 것으로 봅니다.
# `information_schema`·`pg_catalog` 처럼 Postgres 가 들고 있는 것들입니다.
SYSTEM_SCHEMAS = {"pg_catalog", "information_schema", "pg_temp"}

# ON CONFLICT 의 가짜 표. 삽입 대상과 같은 칸을 가집니다
PSEUDO_TABLES = {"excluded"}

IDENT = r'(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)'
QNAME = rf"{IDENT}(?:\.{IDENT})?"

# 칸 이름 자리에 와도 칸이 아닌 것들. 함수는 뒤에 `(` 가 붙어 저절로 걸러지므로
# 괄호 없이 쓰는 것만 적습니다.
KEYWORDS = {
    # 문장
    "SELECT", "FROM", "WHERE", "INSERT", "INTO", "VALUES", "UPDATE", "SET",
    "DELETE", "RETURNING", "WITH", "AS", "ON", "USING", "JOIN", "LEFT",
    "RIGHT", "INNER", "OUTER", "FULL", "CROSS", "NATURAL", "LATERAL",
    "UNION", "INTERSECT", "EXCEPT", "ORDER", "GROUP", "BY", "HAVING",
    "LIMIT", "OFFSET", "FETCH", "FIRST", "NEXT", "ROWS", "ONLY", "WINDOW",
    "CONFLICT", "DO", "NOTHING", "CONSTRAINT",
    # 식
    "AND", "OR", "NOT", "NULL", "IS", "IN", "EXISTS", "BETWEEN", "LIKE",
    "ILIKE", "SIMILAR", "ANY", "SOME", "ALL", "DISTINCT", "ASC", "DESC",
    "NULLS", "LAST", "CASE", "WHEN", "THEN", "ELSE", "END", "CAST",
    "TRUE", "FALSE", "UNKNOWN", "DEFAULT", "FILTER", "OVER", "PARTITION",
    "CURRENT_DATE", "CURRENT_TIME", "CURRENT_TIMESTAMP", "LOCALTIME",
    "LOCALTIMESTAMP", "CURRENT_USER", "SESSION_USER", "COLLATE", "ESCAPE",
    # 자주 쓰는 타입 이름 (`::` 뒤는 따로 거르지만 `CAST(x AS int)` 도 있습니다)
    "INT", "INT2", "INT4", "INT8", "INTEGER", "BIGINT", "SMALLINT", "TEXT",
    "DATE", "TIMESTAMPTZ", "TIMESTAMP", "NUMERIC", "DECIMAL", "BOOLEAN",
    "BOOL", "JSONB", "JSON", "UUID", "REAL", "FLOAT", "CHAR", "VARCHAR",
    "INTERVAL", "BYTEA",
}

# CREATE TABLE 본문에서 칸이 아닌 줄
TABLE_ELEMENT_KEYWORDS = {
    "PRIMARY", "FOREIGN", "UNIQUE", "CHECK", "CONSTRAINT", "EXCLUDE", "LIKE",
}


# ─────────────────────────────────────────────────────────────────────────────
# 자잘한 것들
# ─────────────────────────────────────────────────────────────────────────────


def unquote(name: str) -> str:
    """`"case"` → `case`. Postgres 는 따옴표 없는 이름을 소문자로 접습니다."""
    name = name.strip()
    if name.startswith('"') and name.endswith('"') and len(name) >= 2:
        return name[1:-1]
    return name.lower()


def qualify(name: str) -> tuple[str, str]:
    """`case_vault.restore_mapping` → `('case_vault', 'restore_mapping')`"""
    parts = re.findall(IDENT, name)
    if len(parts) >= 2:
        return unquote(parts[-2]), unquote(parts[-1])
    return DEFAULT_SCHEMA, unquote(parts[-1] if parts else name)


def line_of(text: str, pos: int) -> int:
    return text.count("\n", 0, pos) + 1


def scrub(text: str) -> str:
    """주석·문자열·달러인용의 **속을** 지운다. 길이는 그대로 둡니다.

    `-- case_case_vault 로 적었었다` 같은 주석이 검사 대상이 되면 안 되고,
    `'assistant'` 같은 문자열도 칸 이름이 아닙니다.

    길이를 지키는 이유는 하나입니다 — 여기서 잰 위치가 곧 원본의 줄 번호라야
    사람이 그 줄로 바로 갈 수 있습니다.
    """
    out = list(text)
    n = len(out)

    def wipe(start: int, end: int) -> None:
        for k in range(max(0, start), min(n, end)):
            if out[k] != "\n":
                out[k] = " "

    i = 0
    while i < n:
        two = text[i : i + 2]
        if two == "--":
            j = text.find("\n", i)
            j = n if j < 0 else j
            wipe(i, j)
            i = j
            continue
        if two == "/*":
            j = text.find("*/", i + 2)
            j = n if j < 0 else j + 2
            wipe(i, j)
            i = j
            continue
        if text[i] == "'":
            j = i + 1
            while j < n:
                if text[j] == "'":
                    if j + 1 < n and text[j + 1] == "'":  # '' = 작은따옴표 한 개
                        j += 2
                        continue
                    j += 1
                    break
                j += 1
            wipe(i + 1, j - 1)
            i = j
            continue
        if text[i] == "$":
            m = re.match(r"\$[A-Za-z_]*\$", text[i:])
            if m:
                tag = m.group(0)
                j = text.find(tag, i + len(tag))
                j = n if j < 0 else j + len(tag)
                wipe(i + len(tag), j - len(tag))
                i = j
                continue
        i += 1
    return "".join(out)


def split_statements(text: str) -> list[tuple[int, str]]:
    """`;` 로 가릅니다. 문자열·달러인용은 이미 비워진 상태여야 합니다."""
    out: list[tuple[int, str]] = []
    start = 0
    for m in re.finditer(r";", text):
        out.append((start, text[start : m.start()]))
        start = m.end()
    tail = text[start:]
    if tail.strip():
        out.append((start, tail))
    return out


# ─────────────────────────────────────────────────────────────────────────────
# ① 마이그레이션이 무엇을 만들었나
# ─────────────────────────────────────────────────────────────────────────────


@dataclass
class Table:
    schema: str
    name: str
    columns: set[str] = field(default_factory=set)
    origin: str = ""

    @property
    def qname(self) -> str:
        return self.name if self.schema == DEFAULT_SCHEMA else f"{self.schema}.{self.name}"


@dataclass
class Finding:
    path: str
    line: int
    rule: str
    message: str


class Schema:
    def __init__(self) -> None:
        self.tables: dict[tuple[str, str], Table] = {}
        self.schemas: set[str] = {DEFAULT_SCHEMA} | SYSTEM_SCHEMAS

    def get(self, schema: str, name: str) -> Table | None:
        return self.tables.get((schema, name))

    def names(self) -> list[str]:
        return sorted(t.qname for t in self.tables.values())


def split_top_level(body: str) -> list[str]:
    """괄호 깊이 0 의 쉼표로 가릅니다 — `NUMERIC(15,0)` 을 쪼개면 안 됩니다."""
    parts: list[str] = []
    depth = 0
    buf: list[str] = []
    for ch in body:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append("".join(buf))
            buf = []
            continue
        buf.append(ch)
    if "".join(buf).strip():
        parts.append("".join(buf))
    return parts


def read_migrations(root: Path) -> tuple[Schema, list[Finding]]:
    schema = Schema()
    found: list[Finding] = []
    files = sorted(root.glob(MIGRATION_GLOB))

    for path in files:
        rel = path.relative_to(root).as_posix()
        raw = path.read_text(encoding="utf-8")
        text = scrub(raw)
        version = path.stem

        # M1 · 자기를 기록하지 않으면 apply.sh 가 **매번 다시 적용합니다.**
        #      0002 가 실제로 그랬습니다 — 조용히 어긋나는 종류입니다
        if not re.search(
            rf"INSERT\s+INTO\s+schema_migrations\b[^;]*{re.escape(version)}", raw, re.I | re.S
        ):
            found.append(
                Finding(rel, 1, "M1", f"자기를 기록하지 않습니다 — `VALUES ('{version}')` 한 줄이 필요합니다")
            )

        # M2 · 한 파일이 통째로 되거나 통째로 안 되어야 합니다
        if not re.search(r"^\s*BEGIN\s*;", text, re.I | re.M) or not re.search(
            r"^\s*COMMIT\s*;", text, re.I | re.M
        ):
            found.append(Finding(rel, 1, "M2", "`BEGIN;` … `COMMIT;` 로 감싸지 않았습니다"))

        for pos, st in split_statements(text):
            found.extend(apply_ddl(schema, st, rel, raw, pos, version))

    return schema, found


def apply_ddl(
    schema: Schema, st: str, rel: str, raw: str, pos: int, version: str
) -> list[Finding]:
    found: list[Finding] = []
    body = st.strip()
    if not body:
        return found
    line = line_of(raw, pos + (len(st) - len(st.lstrip())))

    m = re.match(rf"\s*CREATE\s+SCHEMA\s+(?:IF\s+NOT\s+EXISTS\s+)?({IDENT})", st, re.I)
    if m:
        schema.schemas.add(unquote(m.group(1)))
        return found

    m = re.match(
        rf"\s*CREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?({QNAME})\s*\((.*)\)",
        st,
        re.I | re.S,
    )
    if m:
        sch, name = qualify(m.group(1))
        table = schema.tables.setdefault((sch, name), Table(sch, name, origin=version))
        for part in split_top_level(m.group(2)):
            first = part.strip().split()
            if not first:
                continue
            head = first[0]
            if head.upper().strip('"') in TABLE_ELEMENT_KEYWORDS:
                continue
            table.columns.add(unquote(head))
        return found

    m = re.match(rf"\s*ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?({QNAME})\s+(.*)", st, re.I | re.S)
    if m:
        sch, name = qualify(m.group(1))
        table = schema.get(sch, name)
        if table is None:
            found.append(Finding(rel, line, "M3", f"없는 표를 고칩니다 — `{m.group(1)}`"))
            return found
        action = m.group(2)
        for add in re.finditer(
            rf"\bADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?({IDENT})", action, re.I
        ):
            table.columns.add(unquote(add.group(1)))
        for drop in re.finditer(
            rf"\bDROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?({IDENT})", action, re.I
        ):
            table.columns.discard(unquote(drop.group(1)))
        for ren in re.finditer(
            rf"\bRENAME\s+COLUMN\s+({IDENT})\s+TO\s+({IDENT})", action, re.I
        ):
            table.columns.discard(unquote(ren.group(1)))
            table.columns.add(unquote(ren.group(2)))
        ren_table = re.search(rf"\bRENAME\s+TO\s+({IDENT})", action, re.I)
        if ren_table and not re.search(r"\bRENAME\s+COLUMN\b", action, re.I):
            schema.tables.pop((sch, name), None)
            table.name = unquote(ren_table.group(1))
            schema.tables[(table.schema, table.name)] = table
        return found

    m = re.match(rf"\s*DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?({QNAME})", st, re.I)
    if m:
        sch, name = qualify(m.group(1))
        schema.tables.pop((sch, name), None)
        return found

    return found


# ─────────────────────────────────────────────────────────────────────────────
# ② 코드가 무엇을 부르나
# ─────────────────────────────────────────────────────────────────────────────

TAG_RE = re.compile(r"(?<![A-Za-z0-9_$.])sql\s*(?:<.*?>\s*)?`", re.S)

TOKEN_RE = re.compile(
    r"""
      (?P<str>'(?:[^']|'')*')
    | (?P<num>\d+(?:\.\d+)?)
    | (?P<ident>"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)
    | (?P<cast>::)
    | (?P<dot>\.)
    | (?P<open>\()
    | (?P<close>\))
    | (?P<ws>\s+)
    | (?P<other>.)
    """,
    re.X | re.S,
)


@dataclass
class Token:
    kind: str
    text: str
    pos: int

    @property
    def up(self) -> str:
        return self.text.upper()


def read_template(src: str, tick: int) -> tuple[str, int]:
    """여는 백틱 자리에서 시작해 템플릿 속을 돌려준다.

    `${…}` 는 **같은 길이의 공백**으로 덮습니다 — 글자 수를 지켜야 나중에
    잰 위치가 파일의 줄 번호와 그대로 맞습니다.
    """
    buf: list[str] = []
    i = tick + 1
    n = len(src)
    while i < n:
        c = src[i]
        if c == "\\":
            buf.append("  ")
            i += 2
            continue
        if c == "`":
            return "".join(buf), i + 1
        if c == "$" and i + 1 < n and src[i + 1] == "{":
            j = i + 2
            depth = 1
            while j < n and depth:
                ch = src[j]
                if ch in "'\"`":
                    j = skip_quoted(src, j)
                    continue
                if ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
                j += 1
            span = src[i:j]
            buf.append("".join(ch if ch == "\n" else " " for ch in span))
            i = j
            continue
        buf.append(c)
        i += 1
    raise ValueError("닫히지 않은 템플릿")


def skip_quoted(src: str, i: int) -> int:
    quote = src[i]
    j = i + 1
    n = len(src)
    while j < n:
        if src[j] == "\\":
            j += 2
            continue
        if src[j] == quote:
            return j + 1
        j += 1
    return n


def tokenize(text: str) -> list[Token]:
    out: list[Token] = []
    for m in TOKEN_RE.finditer(text):
        kind = m.lastgroup or "other"
        if kind == "ws":
            continue
        out.append(Token(kind, m.group(0), m.start()))
    return out


@dataclass
class TableRef:
    schema: str
    name: str
    raw: str
    pos: int
    alias: str | None = None


def collect_tables(tokens: list[Token]) -> tuple[list[TableRef], set[int]]:
    """`FROM`·`JOIN`·`INTO`·`UPDATE` 뒤의 이름을 표로 봅니다."""
    refs: list[TableRef] = []
    used: set[int] = set()
    i = 0
    while i < len(tokens):
        tok = tokens[i]
        if tok.kind != "ident" or tok.up not in {"FROM", "JOIN", "INTO", "UPDATE"}:
            i += 1
            continue
        # `ON CONFLICT … DO UPDATE SET` 의 UPDATE 는 표를 안 데려옵니다
        if tok.up == "UPDATE" and i > 0 and tokens[i - 1].up == "DO":
            i += 1
            continue
        # `IS [NOT] DISTINCT FROM x` 의 FROM 도 표가 아닙니다 —
        # 여기 걸리면 뒤에 오는 `ORDER` 를 표 이름으로 읽습니다 (실제로 그랬습니다)
        if tok.up == "FROM" and i > 0 and tokens[i - 1].up == "DISTINCT":
            i += 1
            continue

        j = i + 1
        if j >= len(tokens) or tokens[j].kind != "ident":
            i += 1
            continue  # `FROM (` 같은 하위질의는 안 봅니다

        parts = [tokens[j]]
        used.add(j)
        while j + 2 < len(tokens) and tokens[j + 1].kind == "dot" and tokens[j + 2].kind == "ident":
            used.add(j + 1)
            used.add(j + 2)
            parts.append(tokens[j + 2])
            j += 2

        raw = ".".join(p.text for p in parts)
        sch, name = qualify(raw)
        ref = TableRef(sch, name, raw, parts[0].pos)

        k = j + 1
        if k < len(tokens) and tokens[k].kind == "ident" and tokens[k].up == "AS":
            used.add(k)
            k += 1
        if (
            k < len(tokens)
            and tokens[k].kind == "ident"
            and tokens[k].up not in KEYWORDS
            and not (k + 1 < len(tokens) and tokens[k + 1].kind == "open")
        ):
            ref.alias = unquote(tokens[k].text)
            used.add(k)
            j = k

        refs.append(ref)
        i = j + 1
    return refs, used


def helper_columns(src: str, start: int, end: int) -> list[tuple[str, int]]:
    """``${sql(rows, 'case_id', 'token')}`` 의 따옴표 이름도 칸입니다.

    postgres.js 가 `INSERT … (case_id, token) VALUES …` 로 펴는 자리라,
    여기서 이름을 틀리면 똑같이 실행 때 터집니다.
    """
    out: list[tuple[str, int]] = []
    region = src[start:end]
    for m in re.finditer(r"(?<![A-Za-z0-9_$.])sql\s*\(([^()]*)\)", region):
        for q in re.finditer(r"'([^']+)'", m.group(1)):
            out.append((q.group(1), start + m.start(1) + q.start(1)))
    return out


def check_code(root: Path, schema: Schema) -> tuple[list[Finding], int]:
    found: list[Finding] = []
    seen: set[Path] = set()
    scanned = 0

    # `root.glob("src/**/*.ts")` 는 `node_modules` 를 통째로 걷습니다 —
    # 만 개 단위라 그것만으로 몇 분이 갑니다. 걷기 전에 가지를 칩니다
    paths: list[Path] = []
    for base in CODE_BASES:
        top = root / base
        if not top.is_dir():
            continue
        for dirpath, dirnames, filenames in os.walk(top):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
            for filename in filenames:
                if not filename.endswith((".ts", ".tsx")):
                    continue
                path = Path(dirpath) / filename
                if path in seen:
                    continue
                seen.add(path)
                paths.append(path)

    for path in sorted(paths):
        src = path.read_text(encoding="utf-8")
        if "sql`" not in src and not re.search(r"sql\s*<", src):
            continue
        rel = path.relative_to(root).as_posix()
        for m in TAG_RE.finditer(src):
            tick = m.end() - 1
            try:
                body, close = read_template(src, tick)
            except ValueError:
                continue
            scanned += 1
            found.extend(check_statement(schema, body, tick + 1, src, rel, close))
    return found, scanned


def check_statement(
    schema: Schema, body: str, offset: int, src: str, rel: str, close: int
) -> list[Finding]:
    found: list[Finding] = []
    text = scrub(body)
    tokens = tokenize(text)
    if not tokens:
        return found

    refs, used = collect_tables(tokens)
    tables: list[Table] = []
    insert_target: Table | None = None

    for ref in refs:
        line = line_of(src, offset + ref.pos)
        if ref.schema not in schema.schemas:
            found.append(
                Finding(rel, line, "S1", f"없는 스키마입니다 — `{ref.raw}` (마이그레이션에 `{ref.schema}` 가 없습니다)")
            )
            continue
        table = schema.get(ref.schema, ref.name)
        if table is None:
            near = closest(ref.name, [t.qname for t in schema.tables.values()])
            hint = f" — 혹시 `{near}` 인가요?" if near else ""
            found.append(Finding(rel, line, "S1", f"없는 표입니다 — `{ref.raw}`{hint}"))
            continue
        tables.append(table)
        if insert_target is None:
            insert_target = table

    if not tables:
        return found

    known: set[str] = set()
    for table in tables:
        known |= table.columns

    by_alias: dict[str, Table] = {}
    for ref, table in zip([r for r in refs if schema.get(r.schema, r.name)], tables):
        by_alias[table.name] = table
        if ref.alias:
            by_alias[ref.alias] = table
    for pseudo in PSEUDO_TABLES:
        if insert_target is not None:
            by_alias[pseudo] = insert_target

    for i, tok in enumerate(tokens):
        if tok.kind != "ident" or i in used:
            continue
        prev = tokens[i - 1] if i > 0 else None
        nxt = tokens[i + 1] if i + 1 < len(tokens) else None

        if nxt is not None and nxt.kind == "open":
            continue  # 함수 호출
        if prev is not None and prev.kind == "cast":
            continue  # `::date` 는 타입
        if prev is not None and prev.up == "AS":
            continue  # 내보내는 이름
        if nxt is not None and nxt.kind == "dot":
            continue  # 한정자 — 다음 바퀴에서 봅니다

        line = line_of(src, offset + tok.pos)

        if prev is not None and prev.kind == "dot":
            qual_tok = tokens[i - 2] if i >= 2 else None
            if qual_tok is None or qual_tok.kind != "ident":
                continue
            owner = by_alias.get(unquote(qual_tok.text))
            if owner is None:
                continue  # 모르는 한정자 — 표가 아니라 다른 것일 수 있습니다
            if unquote(tok.text) not in owner.columns:
                found.append(
                    Finding(
                        rel,
                        line,
                        "S2",
                        f"`{owner.qname}` 에 없는 칸입니다 — `{qual_tok.text}.{tok.text}`"
                        + hint_for(unquote(tok.text), owner.columns),
                    )
                )
            continue

        if tok.up in KEYWORDS:
            continue
        name = unquote(tok.text)
        if name in known:
            continue
        found.append(
            Finding(
                rel,
                line,
                "S2",
                f"`{'`·`'.join(t.qname for t in tables)}` 에 없는 칸입니다 — `{tok.text}`"
                + hint_for(name, known),
            )
        )

    for name, pos in helper_columns(src, offset, close):
        if insert_target is None:
            continue
        if unquote(name) in insert_target.columns:
            continue
        found.append(
            Finding(
                rel,
                line_of(src, pos),
                "S2",
                f"`{insert_target.qname}` 에 없는 칸입니다 — `sql(…, '{name}')`"
                + hint_for(unquote(name), insert_target.columns),
            )
        )

    return found


def closest(name: str, pool) -> str | None:
    import difflib

    hit = difflib.get_close_matches(name, list(pool), n=1, cutoff=0.7)
    return hit[0] if hit else None


def hint_for(name: str, pool) -> str:
    near = closest(name, pool)
    return f" — 혹시 `{near}` 인가요?" if near else ""


# ─────────────────────────────────────────────────────────────────────────────


def main() -> int:
    ap = argparse.ArgumentParser(description="표·칸 이름 검사")
    ap.add_argument("--root", default=None, help="저장소 뿌리 (기본: 이 스크립트의 두 단계 위)")
    ap.add_argument("--list", action="store_true", help="읽어 낸 표와 칸을 찍고 끝냅니다")
    args = ap.parse_args()

    root = Path(args.root).resolve() if args.root else Path(__file__).resolve().parents[2]

    schema, findings = read_migrations(root)
    if not schema.tables:
        print(f"마이그레이션에서 표를 하나도 못 읽었습니다: {root / MIGRATION_GLOB}")
        return 1

    if args.list:
        for key in sorted(schema.tables):
            table = schema.tables[key]
            print(f"{table.qname}  ({table.origin})")
            print(f"    {' '.join(sorted(table.columns))}")
        return 0

    code_findings, scanned = check_code(root, schema)
    findings.extend(code_findings)

    print(f"마이그레이션이 만든 표 {len(schema.tables)}개, 코드의 SQL {scanned}개를 봤습니다.\n")
    if not findings:
        print("마이그레이션에 없는 이름을 부르는 자리가 없습니다.")
        return 0

    titles = {
        "M1": "자기를 기록하지 않는 마이그레이션",
        "M2": "한 덩어리로 적용되지 않는 마이그레이션",
        "M3": "없는 표를 고치는 마이그레이션",
        "S1": "마이그레이션에 없는 표",
        "S2": "마이그레이션에 없는 칸",
    }
    by_rule: dict[str, list[Finding]] = {}
    for f in findings:
        by_rule.setdefault(f.rule, []).append(f)

    for rule in sorted(by_rule):
        print(f"[{rule}] {titles.get(rule, '')}")
        for f in by_rule[rule]:
            print(f"  {f.path}:{f.line}")
            print(f"      {f.message}")
        print()

    print(f"어긋난 자리 {len(findings)}건.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
