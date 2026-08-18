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

**아직 비어 있습니다.** KB 구축은 근거 확인이 선행돼야 합니다 —
[docs/research/04-기관정보.md](../../docs/research/04-기관정보.md)가 연락처를 전부 비워 둔 상태입니다.

## 버전은 파일에 쓰지 않습니다

`kb_version`·`released_at`은 적재기가 찍습니다. 파일에는 `effective_from`·`verified_at`만 씁니다.
