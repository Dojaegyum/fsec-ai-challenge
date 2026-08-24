-- 0004_vault_schema
--
-- 복원 매핑 볼트를 같은 Postgres 의 `case_vault` 스키마에 만듭니다
-- → decisions/049-vault-in-postgres.md
--
-- 왜 같은 인스턴스인가: 볼트에 들어가는 것은 AES-GCM 암호문이고 복호화 키는
--     브라우저 IndexedDB 에만 있습니다(ADR-009 · ADR-027). `case.session_key_id` 도
--     식별자만 담습니다 — 키가 DB 에 없으므로 DB 가 통째로 유출돼도 볼트는 안 열립니다.
--     ADR-010 이 분리로 막으려던 사고가 이 구조에서는 일어나지 않습니다.
--
-- 왜 별도 스키마인가: `public` 에 섞으면 「무엇이 볼트인가」가 이름에서 사라집니다.
--     가르는 비용은 거의 0 입니다.
--
-- ⚠️ **`vault` 라고 짓지 마세요 — 이미 있습니다.** Supabase 가 `supabase_vault` 확장을
--    그 이름으로 깔아 두고(소유자 `supabase_admin`, 안에 `secrets`·`decrypted_secrets`)
--    관리합니다. 거기 우리 표를 얹으면 권한이 막히거나 확장 갱신과 부딪힙니다.
--    그래서 `case_vault` 입니다.
--
-- ⚠️ **여기에 원문을 넣는 칼럼을 만들지 마세요.** `ciphertext` 하나뿐이고,
--    서버는 그것을 열 수 없습니다. `token` 만 평문입니다 — 조회 키로 써야 하고
--    `[계좌-1]` 자체는 개인정보가 아닙니다.

BEGIN;

CREATE SCHEMA IF NOT EXISTS case_vault;

CREATE TABLE IF NOT EXISTS case_vault.restore_mapping (
  case_id     CHAR(26)     NOT NULL,
  -- `[계좌-1]` — 평문입니다. 조회 키로 씁니다
  token       TEXT         NOT NULL,
  -- base64(iv ‖ AES-GCM 암호문). **서버는 이것을 열 수 없습니다**
  ciphertext  TEXT         NOT NULL,
  stored_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),

  -- 같은 토큰을 다시 보내면 덮어씁니다 → 08-14-api.md §3.11.
  -- AES-GCM 은 매번 다른 IV 를 쓰므로 같은 값이라도 암호문이 달라집니다 —
  -- 다르다고 해서 다른 값이 아닙니다
  PRIMARY KEY (case_id, token)
);

-- 파기가 사건 단위로 지웁니다 → case-purger. 기본키의 첫 칸이 case_id 라
-- 별도 인덱스가 필요 없습니다.

-- 사건 표를 외래키로 걸지 않습니다.
--
-- 볼트는 사건 DB 와 **다른 층**이고(ADR-010 의 세 층 구분은 그대로입니다),
-- 파기 순서가 「볼트 → 사건」이라 외래키가 있으면 그 순서를 DB 가 강제하게
-- 됩니다. 지금은 case-purger 가 순서를 쥐고 remains() 로 검증합니다.

INSERT INTO schema_migrations (version) VALUES ('0004_vault_schema')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
