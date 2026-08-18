# key-handler

**세션키를 만들고 지키며, 매핑을 봉하고 엽니다.** 층 C — 브라우저에서만 돕니다.

계약은 [PII 격리 경계](../../../spec/common/08-14-pii-boundary.md) 불변 규칙 1과
[모듈 경계](../../../spec/common/08-16-module-boundaries.md)이고, 근거는
[ADR-009](../../../decisions/009-restore-mapping-location.md)(매핑은 볼트에, 키는 클라이언트에)·
[ADR-027](../../../decisions/027-session-key-storage.md)(꺼낼 수 없는 키)입니다.

```ts
import { maskText } from "@/modules/pii-masker";
import {
  createSessionKey, indexedDbKeyStore, loadOrCreateKey, sealAll, openMapping,
} from "@/modules/key-handler";

const store   = indexedDbKeyStore();
const session = await loadOrCreateKey(store, caseToken, createSessionKey);

const { masked, mappings } = maskText(입력);
const entries = await sealAll(session, mappings);   // 볼트에 올릴 것
// session.keyId 만 서버로 (case.session_key_id). 키 자체는 절대 안 나갑니다

const 원문 = await openMapping(session, entries[0]);
```

## 절대 하지 않는 것

- **키를 서버·로그·DB로 보내기.** 이 모듈에는 `fetch`·XHR이 없고,
  키는 `extractable: false`라 **꺼내는 것 자체가 브라우저 수준에서 막혀 있습니다.**
- **키에서 파생한 값을 식별자로 쓰기.** `keyId`는 난수 ULID입니다 —
  파생값이 DB에 있으면 DB 유출이 볼트 유출로 이어져 저장소를 나눈 뜻이 사라집니다.
- **복원 실패를 조용히 넘기기.** 못 열면 던집니다. 빈 문자열을 내면 화면에 빈칸이 뜨는데,
  값이 없어서인지 못 열어서인지 사용자가 알 수 없습니다.

## 판단이 필요했던 자리

| 무엇 | 어떻게 | 왜 |
| --- | --- | --- |
| **키를 꺼낼 수 있게 할까** | **`extractable: false`** | XSS가 들어와도 키 자체를 실어 나갈 수 없습니다. 대가는 기기 이전 → [ADR-027](../../../decisions/027-session-key-storage.md) |
| **어디에 보관** | **IndexedDB** | `CryptoKey`가 구조화 복제로 저장돼, **꺼내지 않고** 넣었다 뺄 수 있습니다. `localStorage`는 문자열만 담아 키를 먼저 꺼내야 합니다 |
| **IndexedDB가 없으면** | **그 자리에서 던집니다** | 조용히 메모리로 떨어지면 새로고침 뒤 서류를 못 만드는데 **왜인지 아무도 모릅니다** |
| **IV** | **암호화마다 새로 뽑습니다** | 재사용하면 AES-GCM이 무너집니다. 같은 원문도 봉할 때마다 암호문이 달라집니다 |
| **`keyId` 형식** | **ULID (26자)** | `case.session_key_id`가 `CHAR(26)`이고 `case_id`와 같은 계열입니다 |
| **한 사건에 키 하나** | `loadOrCreateKey`가 **먼저 찾고** 없을 때만 만듭니다 | 두 번 만들면 먼저 봉해 둔 볼트 칸을 **영영 못 엽니다** |

## 아직 아닌 것

- ⬜ **볼트 read/write.** 엔드포인트 계약이 [API](../../../spec/common/08-14-api.md)에 아직 없습니다.
  이 모듈은 **봉하고 여는 것까지**이고, 나르는 것은 그 계약이 서면 붙습니다.

## 파일

| | |
| --- | --- |
| `crypto.ts` | 세션키 생성 · 봉하기 · 열기 (AES-GCM 256) |
| `keystore.ts` | 보관소 — IndexedDB · 메모리 · `loadOrCreateKey` |
| `ulid.ts` | 26자 식별자. 의존성을 늘리지 않으려고 여기 둡니다 |
| `types.ts` | `SessionKey` · `VaultEntry` · `KeyStore` |
| `*.test.ts` | 21건. `npm test` |
