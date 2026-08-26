-- 0006_plan_step_actor_agency
--
-- plan_step.actor 에 agency 를 더합니다 → spec/backend/08-16-data-model.md §6.
--
-- 왜: 채권소멸공고(2개월)·환급금 결정은 금융감독원이 진행합니다. 여섯 값
--     (victim·police·bank·prosecutor·carrier·issuer) 중 어느 것도 아닙니다.
--     victim 으로 두면 화면이 「당신이 해야 할 것」으로 그리고, 정본이 바로 그
--     오인을 경고합니다(§6 「actor 만 보고 wait 으로 단정하지 마세요」의 반대 방향).
--
--     deadline.owner 는 이미 agency 를 갖고 있습니다(§11.4.2 「기관이 진행함」).
--     같은 뜻을 단계 쪽에서만 못 적던 것을 맞춥니다.
--
-- 이름: 0001 이 CHECK 를 이름 없이 걸어 Postgres 가 plan_step_actor_check 로
--     지었습니다. 0003 이 case_slot 에서 한 것과 같은 방식입니다.

BEGIN;

ALTER TABLE plan_step DROP CONSTRAINT IF EXISTS plan_step_actor_check;

ALTER TABLE plan_step ADD CONSTRAINT plan_step_actor_check
  CHECK (actor IN ('victim','police','bank','prosecutor','carrier','issuer','agency'));

-- 위 두 줄은 DROP IF EXISTS + ADD 라 다시 돌려도 안전합니다. 그래도
-- 기록은 남겨야 합니다 — 없으면 apply.sh 가 매번 다시 적용합니다
INSERT INTO schema_migrations (version) VALUES ('0006_plan_step_actor_agency')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
