-- 0003_case_slot_pii_pending
--
-- 슬롯 상태에 pii_pending 을 더합니다 → decisions/041-pii-confirm-with-user.md
--
-- 왜: extracted 와 pii_pending 은 둘 다 「확인 전」이지만 묻는 것이 다릅니다.
--     extracted   = 이 값이 맞나요?      (기계가 잘못 읽었을 수 있다)
--     pii_pending = 이건 개인정보인가요?  (가렸는데 아닐 수 있다)
--
--     실측에서 3333-01-2345678 이 「3333년 1월 23일」로 전사됐는데, 자연스러운
--     날짜라 신뢰도가 낮게 나올 이유가 없습니다 — extracted 로는 안 잡힙니다.
--
-- pii_pending 은 confirmed 가 아니므로 기한 계산·슬롯 충족 판정에 안 들어갑니다.
-- 확인 전에는 없는 값과 같습니다.

BEGIN;

ALTER TABLE case_slot DROP CONSTRAINT IF EXISTS case_slot_state_check;

ALTER TABLE case_slot ADD CONSTRAINT case_slot_state_check
  CHECK (state IN ('empty', 'extracted', 'pii_pending', 'confirmed', 'unknown'));

COMMIT;
