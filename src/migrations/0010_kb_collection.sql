-- 0010_kb_collection
--
-- 수집 파이프라인 표 셋 — 원문 보존 · 검수 큐 · 감시 소스
-- → spec/backend/08-16-data-model.md §12 (DDL 의 정본 · ADR-019) · ADR-012 · ADR-072.
--
-- 왜: `kb-collector`·`kb-reviewer` 는 2026-08 에 만들어졌는데 표가 없어 어디서도 부르지
--     못했습니다. 절차 지식을 KB 로 뺀 것(불변 규칙 1)의 나머지 절반 — 「그 KB 가 낡는
--     것을 누가 알아채는가」 — 가 이 표 셋입니다. 수집기는 `kb_entry` 를 건드리지 않습니다.
--     사람 승인을 거쳐 파일을 고치고 적재기가 릴리스합니다(RFC-002).
--
-- `uk_source_hash` 가 변경 감지 장치입니다 — 같은 내용을 다시 가져오면 삽입이 실패하고,
-- 삽입에 성공하면 그것이 곧 변경입니다. 앞엣것과 견주는 코드를 따로 두지 않습니다(§12.1).
--
-- `IF NOT EXISTS` 인 이유: 공유 DB 에 `source_snapshot` 이 이미 있었습니다(2026-09-06 확인 · 열·제약이
-- 명세와 같음 — 모듈을 만들던 8월에 손으로 만든 것으로 보입니다). 있으면 건너뛰고 없는 것만 만듭니다.

BEGIN;

CREATE TABLE IF NOT EXISTS source_snapshot (
  snapshot_id   CHAR(26)      NOT NULL,
  source_type   TEXT          NOT NULL
                CHECK (source_type IN ('law','pre_notice','press','manual')),
  source_key    VARCHAR(255)  NOT NULL,  -- law:    법령ID:조문번호:조문가지번호
                                         -- press:  게시글 URL
                                         -- manual: org_id:field
  fetched_at    TIMESTAMPTZ(3) NOT NULL,
  content       TEXT          NOT NULL,  -- 원문 그대로
  content_hash  CHAR(64)      NOT NULL,  -- SHA-256
  meta          JSONB         NOT NULL,  -- 시행일·공포일·부처·게시일 등
  PRIMARY KEY (snapshot_id),
  CONSTRAINT uk_source_hash UNIQUE (source_key, content_hash)
);
CREATE INDEX IF NOT EXISTS idx_source_snapshot_time ON source_snapshot (source_key, fetched_at);

CREATE TABLE IF NOT EXISTS source_change (
  change_id       CHAR(26)      NOT NULL,
  source_key      VARCHAR(255)  NOT NULL,
  snapshot_before CHAR(26)      NULL,     -- 최초 수집이면 NULL
  snapshot_after  CHAR(26)      NOT NULL,
  detected_at     TIMESTAMPTZ(3) NOT NULL,
  dedupe_key      VARCHAR(255)  NULL,     -- 같은 제도 변경을 묶는 키
  impact          JSONB         NULL,     -- LLM 영향 분석 (아직 채우는 곳 없음 · §12.2)
  review_status   TEXT          NOT NULL DEFAULT 'pending'
                  CHECK (review_status IN ('pending','approved','rejected','deferred')),
  reviewed_by     VARCHAR(64)   NULL,
  reviewed_at     TIMESTAMPTZ(3) NULL,
  review_note     TEXT          NULL,
  released_version VARCHAR(32)  NULL,     -- 승인 후 반영된 KB 버전
  PRIMARY KEY (change_id)
);
CREATE INDEX IF NOT EXISTS idx_source_change_status ON source_change (review_status, detected_at);
CREATE INDEX IF NOT EXISTS idx_source_change_dedupe ON source_change (dedupe_key);

CREATE TABLE IF NOT EXISTS source_registry (
  source_key_prefix VARCHAR(255) NOT NULL, -- 예: law:011359
  source_type       TEXT         NOT NULL
                    CHECK (source_type IN ('law','pre_notice','press','manual')),
  watch_method      TEXT         NOT NULL
                    CHECK (watch_method IN ('api','rss','board','human')),
  interval_days     INT          NULL,     -- human 이면 NULL
  last_success_at   TIMESTAMPTZ(3) NULL,
  last_seen_date    DATE         NULL,     -- board: 마지막으로 수집한 게시물 날짜
  last_error        VARCHAR(500) NULL,
  PRIMARY KEY (source_key_prefix)
);

-- 감시 소스 둘 — KB 32 항목의 `legal_basis` 가 인용하는 법과 그 시행령. 국가법령정보 API 는
-- 언제 불러도 전체를 주므로 하루 1회면 놓칠 것이 없습니다(§12.4). 법령ID 는 2026-09-06 에
-- lawSearch 로 확인했습니다 → ADR-072.
INSERT INTO source_registry (source_key_prefix, source_type, watch_method, interval_days) VALUES
  ('law:011359', 'law', 'api', 1),   -- 전기통신금융사기 피해 방지 및 피해금 환급에 관한 특별법
  ('law:011448', 'law', 'api', 1)    -- 같은 법 시행령
  ON CONFLICT (source_key_prefix) DO NOTHING;

-- 다시 돌려도 안전합니다. 그래도 기록은 남겨야 합니다 — 없으면 apply.sh 가 매번 다시 적용합니다
INSERT INTO schema_migrations (version) VALUES ('0010_kb_collection')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
