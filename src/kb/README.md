# 매뉴얼 KB 원본

**여기가 원본이고, `kb_entry`·`org` 테이블은 여기서 적재된 사본입니다.**
DB에 직접 INSERT 하지 마세요.

작성 규약은 [RFC-002](../../rfc/002-kb-authoring.md), 필드 구조는
[spec/backend/08-16-data-model.md](../../spec/backend/08-16-data-model.md) §11.4입니다.

## 파일

| 파일 | 무엇 |
| --- | --- |
| `common.json` | `track=victim` · `channel_id` NULL — 전 유형 공통 |
| `frozen-account.json` | `track=frozen_account` — 통장묶기 |
| `ch-*.json` | 경유 서비스 유형별. 기관 전용 항목도 해당 유형 파일에 |
| `org.json` | 기관 마스터 — 연락처·별칭 |

**`common.json` 만 채워져 있습니다.** 나머지는 근거 확인이 선행돼야 합니다 —
[docs/research/04-기관정보.md](../../docs/research/04-기관정보.md)가 연락처를 전부 비워 둔 상태입니다.

## 적재기

```
cd src
npm run kb:load -- --version 2026.08.1 --dry-run   # 무엇이 실릴지만 봅니다
npm run kb:load -- --version 2026.08.1             # 실제로 적재합니다
```

- **검증에 하나라도 걸리면 통째로 거부합니다** ([§11.4.5](../../spec/backend/08-16-data-model.md#1145-적재-시-검증)).
  절반만 실으면 절반이 최신이고 절반이 옛것입니다.
- **이미 있는 버전은 덮지 않습니다.** 릴리스된 버전이 조용히 바뀌면
  「그때 무엇을 안내했나」가 사라집니다 ([ADR-045](../../decisions/045-kb-release-pin.md)).
  정말 덮어야 하면 `--overwrite`.
- 적재한 버전을 실제로 쓰려면 **`KB_VERSION` 을 그 값으로** 두세요. 안 그러면
  안내를 만들지 않습니다.
- 접속 문자열은 `DATABASE_URL` → `src/.env.local` 순으로 찾습니다.

**판정은 [`lib/kb-load.ts`](../lib/kb-load.ts) 가 합니다** — 스크립트는 파일을 읽고
DB 에 넣는 것만 합니다. 검증을 스크립트에 두면 `npm test` 가 안 봅니다.

## 버전은 파일에 쓰지 않습니다

`kb_version`·`released_at`은 적재기가 찍습니다. 파일에는 `effective_from`·`verified_at`만 씁니다.
