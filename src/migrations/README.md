# migrations — 스키마를 실제 데이터베이스에 옮기는 자리

**스키마의 정본은 [09-data-model.md](../../spec/backend/08-16-data-model.md)입니다.**
여기 있는 것은 그 정본을 실행 가능한 형태로 옮긴 것이고, **여기서 스키마를 새로 정하지 않습니다.**

[ADR-019](../../decisions/019-module-code-sync.md)가 **DDL이 바뀌면 마이그레이션이 함께 와야 한다**고
정했고, `module-sync` 검사가 이 폴더가 생긴 뒤부터 그것을 봅니다.

## 파일 이름

```
NNNN_{slug}.sql
```

- `NNNN`은 네 자리 순번. **재사용하지 않습니다.**
- `slug`은 영문 kebab이 아니라 `snake_case`입니다 — SQL 쪽 관례에 맞춥니다.
- 순번이 곧 적용 순서입니다.

| | |
| --- | --- |
| `0001_initial_schema.sql` | 테이블 14개 · 인덱스 18개 · 트리거 4개 · 공용 함수 1개 |

## 쓰는 법

**`DIRECT_URL` 을 넣으세요.** `DATABASE_URL` 이 아닙니다 — 아래 「접속 문자열이 둘인 이유」.

```bash
cd src
set -a && . ./.env.local && set +a
DATABASE_URL="$DIRECT_URL" ./migrations/apply.sh --dry-run   # 무엇이 적용될지
DATABASE_URL="$DIRECT_URL" ./migrations/apply.sh             # 실제로 적용
```

### 접속 문자열이 둘인 이유

| | 어디에 | 왜 |
| --- | --- | --- |
| `DATABASE_URL` | 앱 | 트랜잭션 풀러(6543). 서버리스는 연결이 짧게 많이 생겨 모아 써야 합니다 |
| `DIRECT_URL` | **마이그레이션** | **세션 풀러(5432).** DDL 은 한 연결에 머물러야 해서 트랜잭션 풀러로 못 보냅니다 |

> ⚠️ **`DIRECT_URL` 은 「직접 연결」이 아니라 세션 풀러입니다.**
> Supabase 의 직접 연결(`db.{ref}.supabase.co:5432`)은 **IPv6 전용**이라
> IPv4 만 되는 환경에서 `Network is unreachable` 로 실패합니다 (2026-08-20 실측).
> 세션 풀러는 같은 호스트를 IPv4 로 열어 주고 DDL 도 통과합니다.

적용된 것은 `schema_migrations` 표에 남아, 다시 돌려도 건너뜁니다.

## `psql` 만 쓰는 이유

스키마 정본이 이미 **PostgreSQL 방언**으로 쓰여 있습니다. 여기에 ORM(Prisma·Drizzle 등)을
끼우면 **DDL이 두 곳에 생깁니다** — 정본과 ORM 스키마가 갈라지고, 어느 쪽이 맞는지
알 수 없게 됩니다. 그 위험이 얻는 것보다 큽니다.

트랜잭션은 **파일 단위**입니다. 각 파일이 자기 `BEGIN`·`COMMIT`을 갖고 있어,
중간에 실패하면 그 파일은 통째로 없던 일이 됩니다.

## 스키마를 바꿀 때

1. **[09-data-model.md](../../spec/backend/08-16-data-model.md)를 먼저 고칩니다.** 정본이 그쪽입니다.
2. 바뀐 만큼만 새 파일(`0002_...sql`)을 더합니다. **기존 파일을 고치지 않습니다** —
   이미 적용된 데이터베이스에는 그 변경이 닿지 않습니다.
3. `module-sync` 검사가 DDL 변경과 마이그레이션이 함께 왔는지 봅니다.

## 아직 아닌 것

- ⬜ **되돌리기(rollback)가 없습니다.** 앞으로만 갑니다. 대회 기간에는 스키마를 되돌릴 일보다
  앞으로 고칠 일이 많고, 되돌리기를 쓰려면 각 변경의 역방향을 손으로 적어야 합니다.
  실서비스 전에 필요해지면 그때 넣습니다.
- ~~아직 실제 데이터베이스에 적용해 보지 않았습니다~~ → **2026-08-20 적용 완료.**
  Supabase Postgres 17.6 · `ap-northeast-2`(서울). 표 14개 + `schema_migrations`,
  인덱스 37개, 트리거 4개가 올라갔고 삽입·연쇄 삭제까지 확인했습니다.
