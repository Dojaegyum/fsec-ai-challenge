#!/usr/bin/env bash
#
# 아직 적용되지 않은 마이그레이션을 순서대로 적용합니다.
#
#   DATABASE_URL='postgresql://...' ./src/migrations/apply.sh
#   ./src/migrations/apply.sh --dry-run     무엇이 적용될지만 봅니다
#
# psql 만 씁니다. 의존성을 늘리지 않으려는 것입니다 — 스키마 정본이 이미
# PostgreSQL 방언으로 쓰여 있어(spec/backend/08-16-data-model.md) ORM 을 끼우면
# DDL 이 두 곳에 생깁니다.

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

if ! command -v psql >/dev/null 2>&1; then
  echo "psql 이 없습니다. PostgreSQL 클라이언트를 설치하세요." >&2
  exit 1
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL 이 비어 있습니다." >&2
  echo "  DATABASE_URL='postgresql://...' $0" >&2
  exit 1
fi

# 적용 이력을 읽습니다. 표가 아직 없으면 빈 결과로 두고 넘어갑니다 —
# 첫 마이그레이션이 그 표를 만듭니다
APPLIED="$(psql "$DATABASE_URL" -tAc \
  "SELECT version FROM schema_migrations ORDER BY version" 2>/dev/null || true)"

PENDING=0
for FILE in "$DIR"/[0-9]*.sql; do
  VERSION="$(basename "$FILE" .sql)"

  if grep -qxF "$VERSION" <<<"$APPLIED"; then
    continue
  fi

  PENDING=$((PENDING + 1))

  if $DRY_RUN; then
    echo "적용 예정: $VERSION"
    continue
  fi

  echo "적용: $VERSION"
  # ON_ERROR_STOP 이 없으면 중간에 실패해도 계속 돌아 절반만 적용됩니다.
  # 각 파일이 자기 BEGIN/COMMIT 을 갖고 있어 파일 단위로 전부 또는 전무입니다
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$FILE"
done

if [[ $PENDING -eq 0 ]]; then
  echo "적용할 것이 없습니다. 스키마가 최신입니다."
elif $DRY_RUN; then
  echo "— 미리보기였습니다. 실제로 적용하려면 --dry-run 없이 실행하세요."
else
  echo "마이그레이션 $PENDING 건 적용 완료."
fi
