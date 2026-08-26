#!/usr/bin/env bash
# CI 워크플로 여덟이 하는 일을 손으로 그대로 — **Actions 가 안 돌 때.**
#
#   bash .github/scripts/gates.sh
#
# 각 워크플로의 `run:` 줄을 그대로 옮긴 것입니다. **여기서 통과하면 CI 에서도
# 통과해야 하고**, 아니면 둘 중 하나가 어긋난 것입니다 — 그 자체가 신호입니다.
#
# ## 왜 이 파일이 생겼나
#
# 2026-08-26 오후에 GitHub Actions 가 멈췄습니다. 러너가 안 붙어 검사가 `queued`
# 인 채로 남거나 0초 만에 `startup_failure` 로 떨어졌고, **검사 0개로 머지된 PR 이
# 생겼습니다.** 「CI 가 문지기」라는 전제가 깨지면 그날의 안전망이 통째로 없어집니다.
#
# 러너가 죽어도 **검사 자체는 우리 것**입니다. 이 파일은 그것을 손에 들려 줍니다.
#
# ⚠️ **CI 를 대신하지 않습니다.** 이건 사람이 머지 전에 한 번 도는 것이고,
#    Actions 가 살아나면 그쪽이 다시 문지기입니다.
#
# ## `--base` 를 주면 두 검사가 더 봅니다
#
# ADR 불변성(지워진 ADR)과 스키마↔마이그레이션 짝은 **변경 범위**가 있어야
# 볼 수 있습니다. 안 주면 그 둘만 건너뛰고 나머지는 그대로 돕니다.
#
#   bash .github/scripts/gates.sh origin/main
set -u
cd "$(git rev-parse --show-toplevel)" || exit 1

BASE_REF="${1:-}"
BASE=""
HEAD=""
if [ -n "$BASE_REF" ]; then
  BASE=$(git merge-base "$BASE_REF" HEAD 2>/dev/null) || BASE=""
  HEAD=$(git rev-parse HEAD)
fi

pass=0
fail=0

run() {
  local name="$1"
  shift
  local out
  if out=$("$@" 2>&1); then
    printf '  ✓ %s\n' "$name"
    pass=$((pass + 1))
  else
    printf '  ✗ %s\n' "$name"
    printf '%s\n' "$out" | tail -20 | sed 's/^/      /'
    fail=$((fail + 1))
  fi
}

echo "# 로컬 게이트 — $(git log --oneline -1)"
[ -n "$BASE" ] && echo "# 비교 기준 ${BASE_REF} (${BASE:0:8})"
echo

if [ -n "$BASE" ]; then
  run "doc-integrity" python .github/scripts/doc-integrity.py --base "$BASE" --head "$HEAD"
  run "module-sync" python .claude/skills/module-inventory/scripts/inventory.py \
    --check --base "$BASE" --head "$HEAD"
else
  run "doc-integrity" python .github/scripts/doc-integrity.py
  run "module-sync" python .claude/skills/module-inventory/scripts/inventory.py --check
fi

run "route-contract" python .github/scripts/route-contract.py
run "schema-names" python .github/scripts/schema-names.py
run "services-check" python -m unittest discover -s services/transcriber -t .

cd src || exit 1
run "typecheck" npx tsc --noEmit
run "test" npx vitest run
run "build" npm run build

echo
echo "통과 ${pass} · 실패 ${fail}"
[ "$fail" -eq 0 ] || exit 1
