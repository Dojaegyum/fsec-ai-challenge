-- 0008_notify_email_and_reminder_sent
--
-- 알림용 이메일이 놓일 칸과, 보낸 알림을 기억하는 표를 만듭니다
-- → spec/backend/08-16-data-model.md §2 `notify_email` · §8.4 `reminder_sent`.
--
-- 왜: ADR-021 이 「알림용 이메일 하나만 선택 입력」으로 정하고 저장 위치를
--     「백엔드 계약(TODO)」으로 남겨 두었는데, 그 사이에 /start 화면은 이메일
--     칸을 그려 두고 있었습니다 — 타이핑해도 아무 데도 안 갔습니다(QA 계획
--     Task 9 ⑤). reminder-sender 도 「이미 보낸 건 아닌가」를 판단해야 하는데
--     발송 이력이 놓일 자리가 없어 SentLog 인터페이스로만 있었습니다.
--
-- notify_email 은 검증하지 않습니다(ADR-021 — 형식 검사가 곧 관문입니다).
--     254 는 형식이 아니라 칸의 크기입니다(RFC 5321 경로 상한에서 온 관례 값).
--     평문으로 저장되는 유일한 연락처이고, 사건 행과 함께 파기됩니다(§14).
--
-- reminder_sent.dedupe_key 는 「무엇을 알렸는지」가 곧 열쇠입니다 — 알릴 것이
--     늘면 열쇠가 바뀌어 새 메일이 나가고, 그대로면 안 나갑니다. 형식의 정본은
--     reminder-sender 코드라 여기 적지 않습니다. 가변 길이라 TEXT 입니다.
--
-- ON DELETE CASCADE 는 파기 연쇄입니다: 사건이 파기되면 발송 이력도 함께
--     사라져, 파기 시점이 없는 데이터가 안 생깁니다(04-pii-boundary.md 규칙 3).

BEGIN;

ALTER TABLE "case" ADD COLUMN IF NOT EXISTS notify_email VARCHAR(254) NULL;

CREATE TABLE IF NOT EXISTS reminder_sent (
  dedupe_key  TEXT           NOT NULL,   -- 무엇을 알렸는지의 열쇠. reminder-sender 가 만든다
  case_id     CHAR(26)       NOT NULL,
  sent_at     TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (dedupe_key),
  CONSTRAINT fk_reminder_sent_case FOREIGN KEY (case_id)
    REFERENCES "case"(case_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reminder_sent_case ON reminder_sent (case_id);

-- `IF NOT EXISTS` 라 다시 돌려도 안전합니다. 그래도 기록은 남겨야 합니다 —
-- 없으면 apply.sh 가 매번 다시 적용합니다
INSERT INTO schema_migrations (version) VALUES ('0008_notify_email_and_reminder_sent')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
