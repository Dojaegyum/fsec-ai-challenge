-- 0009_message_referenced
--
-- 답이 가리킨 단계·기한을 message 에 남깁니다
-- → spec/backend/08-16-data-model.md §9 `referenced_steps` · `referenced_deadlines` · ADR-065.
--
-- 왜: §3.9(POST /messages) 응답에는 referenced_steps 가 있어 라이브 턴에서는 답이
--     가리킨 단계로 작업 패널이 열리는데, §3.12(GET /messages 대화 이력)에는 그 칸이
--     없었습니다. 내릴 값이 저장되지 않아서입니다 — 새로고침·재방문 뒤에는 같은
--     대화인데 챗↔단계 연결이 사라졌습니다(GitHub #41).
--
--     citations 에서 되짚을 수 없습니다. `case-N` 은 그 턴 프롬프트가 발급한 번호라
--     다음 턴에는 다른 것을 가리킵니다(§9.3). 그래서 §3.9 를 만들 때 확정된
--     step_id·deadline_id 배열을 그대로 남깁니다.
--
-- NULL 인 이유: 사용자 줄에는 붙지 않고(§3.12), 이 마이그레이션 전에 쌓인 비서
--     줄도 값이 없습니다. 읽는 쪽이 NULL 을 빈 배열로 내립니다 — 칸을 빼지 않습니다.
--     JSONB 인 이유는 citations 와 같은 자리이고, 열쇠가 ULID 문자열 배열이라
--     정규화할 표가 없어서입니다. 외래키를 걸지 않습니다 — 플랜이 다시 생성되면
--     그 단계가 사라질 수 있고, 이력은 「그때 무엇을 가리켰나」입니다(재검증 안 함 → ADR-065).

BEGIN;

ALTER TABLE message ADD COLUMN IF NOT EXISTS referenced_steps     JSONB NULL;
ALTER TABLE message ADD COLUMN IF NOT EXISTS referenced_deadlines JSONB NULL;

-- `IF NOT EXISTS` 라 다시 돌려도 안전합니다. 그래도 기록은 남겨야 합니다 —
-- 없으면 apply.sh 가 매번 다시 적용합니다
INSERT INTO schema_migrations (version) VALUES ('0009_message_referenced')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
