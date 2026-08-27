-- 0007_org_public
--
-- 경유 서비스가 **아닌** 기관의 이름을 담습니다 — 경찰·검찰·금융감독원 같은 곳.
--
-- 왜: PII 경계의 「토큰화 제외 목록」에 *공공기관·수사기관명*이 들어 있는데
--     **그 데이터가 놓일 자리가 없었습니다.** `org` 는 `channel_id` 가 필수라
--     못 들어가고(04-기관정보.md §8 이 「org 테이블이 아니라 3순위 공통 KB
--     항목」으로 가른 자리), 그래서 NER 을 켜면 「금융감독원에 전화해서…」의
--     기관명이 `[이름-1]` 이 됩니다 → docs/research/05 U-35.
--
--     ⛔ **`org.channel_id` 를 nullable 로 여는 안을 버렸습니다.** 그 칸은
--     「이 기관은 어느 유형인가」이고, 열면 `allCandidates`·`org-repair`·유형
--     매칭이 전부 **「채널을 못 답하는 org 행」**을 다뤄야 합니다. 경찰청은
--     「어느 유형인지 모르는 경유 서비스」가 아니라 **경유 서비스가 아닙니다.**
--
--     코드 상수로 두는 안도 버렸습니다 — 이 데이터는 움직입니다(1394 가
--     2026-02-01 부터 대표번호이고 1566-1188 은 전환 중입니다). 그리고
--     제외 목록은 이미 `KB_VERSION` 에 묶여 있어(`allowedTermsFor` 가
--     `kbVersion.current()` 를 받습니다) 여기만 릴리스 밖에 두면 **버전을
--     되감아도 사전은 안 되감깁니다.**
--
-- 연락처를 안 담습니다: 창구 번호는 절차 항목(`kb_entry.body`)이 갖습니다.
--     두 곳에 같은 번호가 생기면 어느 쪽이 정본인지 없어집니다. 이 표가
--     갖는 것은 **「가리지 말 이름」**뿐입니다.
--
-- 열쇠가 `(org_id, kb_version)` 인 것은 `org` 와 같습니다 — 같은 릴리스
--     안에서만 덮어쓰고, 지난 릴리스의 표기는 그대로 남습니다.

BEGIN;

CREATE TABLE IF NOT EXISTS org_public (
  org_id      VARCHAR(32)   NOT NULL,   -- 예: fss, police-agency, kftc
  name        VARCHAR(100)  NOT NULL,   -- 정식 표기. 예: 금융감독원
  aliases     JSONB         NOT NULL,   -- 별칭·줄임말. 매칭에 쓴다
  source_url  VARCHAR(500)  NOT NULL,   -- 표기 근거. 비면 적재 거부
  verified_at DATE          NOT NULL,
  kb_version  VARCHAR(32)   NOT NULL,
  PRIMARY KEY (org_id, kb_version)
);

CREATE INDEX IF NOT EXISTS idx_org_public_version ON org_public (kb_version);

-- `IF NOT EXISTS` 라 다시 돌려도 안전합니다. 그래도 기록은 남겨야 합니다 —
-- 없으면 apply.sh 가 매번 다시 적용합니다
INSERT INTO schema_migrations (version) VALUES ('0007_org_public')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
