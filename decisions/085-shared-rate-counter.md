# ADR-085. 속도 제한 카운터는 Postgres 표에 센다 — 인스턴스마다 따로 세는 메모리 카운터를 대체

- 상태: **채택**
- 날짜: 2026-09-06
- 결정: @kth9245
- 관련 문서: [API 계약](../spec/common/08-14-api.md) §1.3 · [데이터 모델](../spec/backend/08-16-data-model.md) · `src/lib/rate-limit.ts` · `src/lib/rate-limit-pg.ts` · `src/migrations/0011_rate_limit_window.sql`

## 맥락

§1.3 은 「사건 조회 실패(404) IP당 분당 10회」를 열거 방어로 약속한다. 2026-09-06 QA 에서 없는 링크 14건을 같은 순간 보내니
전부 404 로 0.3초 안에 답했고 429 는 없었다. 카운터가 프로세스 메모리에 있어(`container.ts` 「프로세스 메모리입니다」) Vercel 이
요청을 여러 인스턴스에 나누면 한 카운터에 모이지 않는다.

## 결정

표 `rate_limit_window(key text primary key, count integer not null, reset_at timestamptz not null)` 하나에
`INSERT … ON CONFLICT (key) DO UPDATE … RETURNING` 한 문장으로 증가와 조회를 함께 한다(창이 끝났으면 1 로 시작).
DATABASE_URL 이 있으면 이 카운터, 없으면 메모리 카운터. 설정 현황(`config-report`)의 「속도 제한 저장소」가 `shared` 로 바뀐다.
끝난 창은 `purge` 크론이 하루 한 번 지운다.

## 탈락시킨 대안

- **Redis/Upstash** — 새 자원·비밀이 하나 늘고 접수 전에 붙일 시간이 없다. Postgres 는 이미 있다.
- **메모리인 채로 두기** — §1.3 이 *"볼트를 따라 Postgres 로 가지 마세요"* 라고 적어 둔 자리다(쓰기가 요청마다 한 번 더
  는다). 그 경고를 여기서 뒤집는다. 약속한 상한이 **한 번도 지켜진 적이 없는 것**이 쓰기 한 번보다 무겁고, 창으로 세는
  여섯 갈래는 사람이 손으로 낼 수 있는 속도보다 훨씬 위라 실제 쓰기 증가폭은 요청당 한 줄의 upsert 다.
