-- 0002_case_link_token
--
-- 링크 토큰을 case_id 와 분리합니다 → decisions/039-link-token.md
--
-- 왜: case_id 는 ULID 이고 앞자리가 생성 시각입니다. 그대로 URL 토큰이 되면
--     하나를 알 때 비슷한 시각의 사건을 좁혀서 찔러볼 수 있습니다. 계정이 없어
--     주소를 아는 사람이 곧 주인이므로(ADR-021), 이 값이 사실상 비밀번호입니다.
--
-- 값: CSPRNG 128비트 · Crockford Base32(I·L·O·U 제외) · 26자
--     **애플리케이션이 만듭니다.** DB 기본값을 두지 않는 이유는 Postgres 기본
--     설치에 Crockford Base32 인코더가 없고, gen_random_bytes 를 문자열로 옮기는
--     SQL 을 손으로 쓰면 알파벳을 틀려도 아무도 모르기 때문입니다.

BEGIN;

ALTER TABLE "case" ADD COLUMN link_token CHAR(26);

-- ⚠️ 기존 행이 있으면 여기서 채운 뒤에 NOT NULL 로 올려야 합니다.
--    대회 시점에는 실사용 사건이 없어 비어 있습니다. 행이 있는 채로 아래를
--    돌리면 실패하고, 그게 맞는 동작입니다 — 조용히 넘어가면 토큰 없는 사건이
--    남고 그 사건은 영영 열 수 없습니다.
ALTER TABLE "case" ALTER COLUMN link_token SET NOT NULL;

CREATE UNIQUE INDEX idx_case_link_token ON "case" (link_token);

COMMIT;
