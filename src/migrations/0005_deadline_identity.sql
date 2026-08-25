-- 0005_deadline_identity
--
-- 같은 기한을 두 번 만들지 않게 열쇠를 답니다 → spec/backend/08-16-data-model.md §8.
--
-- 왜: 기한은 **플랜이 바뀔 때마다 다시 계산**됩니다(슬롯 답변·부산물 제출·플랜
--     재생성). 열쇠가 없으면 같은 단계의 같은 종류가 부를 때마다 한 줄씩 늘고,
--     화면은 「피해구제 서류 제출」을 다섯 번 보여줍니다.
--
--     (case_id, plan_step_id, kind) 이 기한 하나의 정체입니다 — 한 단계에
--     본 기한과 유예가 **각각 한 줄**이고(§8.1), 그 둘은 kind 로 갈립니다.
--
-- COALESCE 를 쓰는 이유: Postgres 의 UNIQUE 는 NULL 을 서로 다른 값으로 봅니다.
--     plan_step_id 가 NULL 인 기한(단계에 안 딸린 안내용)이 생기면 열쇠가
--     조용히 안 걸립니다. 지금은 그런 줄을 안 만들지만, 안 만든다는 사실에
--     열쇠의 유효성을 기대지 않습니다.
--
-- **void 는 빼고 셉니다.** 근거가 사라져 내린 기한이 같은 자리의 새 기한을
--     막으면 안 됩니다 — 기산 슬롯을 지웠다가 다시 채우는 것은 정상 흐름이고,
--     그때 새 줄이 못 들어가면 기한이 영영 안 돌아옵니다.

BEGIN;

-- 이미 쌓여 있는 중복을 내립니다. **지우지 않습니다** — 그 날짜를 한때
-- 안내했다는 사실까지 사라지면 되짚을 수 없습니다.
--
-- 제품 경로가 기한을 쓴 적이 없어(2026-08-25 기준 INSERT INTO deadline 이
-- 코드에 없었습니다) 여기 걸리는 것은 개발 중 손으로 심은 줄뿐입니다.
-- 무엇이 남을지는 computed_at 이 정합니다 — 가장 최근에 계산한 것.
UPDATE deadline d SET status = 'void', updated_at = now()
WHERE d.status <> 'void'
  AND EXISTS (
    SELECT 1 FROM deadline other
    WHERE other.case_id = d.case_id
      AND COALESCE(other.plan_step_id, '') = COALESCE(d.plan_step_id, '')
      AND other.kind = d.kind
      AND other.status <> 'void'
      AND (other.computed_at, other.deadline_id) > (d.computed_at, d.deadline_id)
  );

CREATE UNIQUE INDEX IF NOT EXISTS uk_deadline_identity
  ON deadline (case_id, COALESCE(plan_step_id, ''), kind)
  WHERE status <> 'void';

INSERT INTO schema_migrations (version) VALUES ('0005_deadline_identity')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
