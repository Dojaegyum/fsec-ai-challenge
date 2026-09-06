-- 0011_rate_limit_window
--
-- 속도 제한 카운터를 담는 표 하나 — 창(window) 하나가 한 줄입니다.
-- → spec/backend/08-16-data-model.md §16 · spec/common/08-14-api.md §1.3 · ADR-085.
--
-- 왜: 카운터가 프로세스 메모리에 있어서 Vercel 이 요청을 여러 인스턴스에 나누면 한
--     카운터에 모이지 않았습니다. 2026-09-06 QA 에서 없는 링크 14건을 같은 순간 보내니
--     전부 404 로 답했고 429 는 하나도 없었습니다 — 「IP당 분당 10회」가 지켜진 적이
--     없습니다. 표 하나면 인스턴스가 몇이든 한 곳에서 셉니다.
--
-- `count` 는 예약어가 아니지만 집계 함수와 이름이 같습니다. 칼럼으로 쓰는 데는
-- 문제가 없고(`rate_limit_window.count`), 코드도 정규화한 이름 하나만 씁니다.
--
-- 파기: 사건 데이터가 아니라 **창이 끝나면 버리는 값**입니다. `purge` 크론이 하루 한 번
--       `reset_at` 이 지난 줄을 지웁니다 — 인덱스는 그 삭제를 위한 것입니다.

BEGIN;

CREATE TABLE IF NOT EXISTS rate_limit_window (
  key      TEXT          NOT NULL,  -- `{갈래}:{대상}` — 예: notFound:203.0.113.9
  count    INTEGER       NOT NULL,  -- 이 창에서 몇 번째인가. 이번 것을 포함합니다
  reset_at TIMESTAMPTZ   NOT NULL,  -- 이 창이 끝나는 시각. 지났으면 다음 요청이 1 로 되돌립니다
  PRIMARY KEY (key)
);
CREATE INDEX IF NOT EXISTS idx_rate_limit_window_reset ON rate_limit_window (reset_at);

-- 다시 돌려도 안전합니다. 그래도 기록은 남겨야 합니다 — 없으면 apply.sh 가 매번 다시 적용합니다
INSERT INTO schema_migrations (version) VALUES ('0011_rate_limit_window')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
