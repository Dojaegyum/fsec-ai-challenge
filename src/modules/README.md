# modules — 도메인 모듈

**폴더 이름은 여기서 정하지 않습니다.** [모듈 명칭](../../spec/common/08-16-module-names.md)이 정본이고,
이 폴더의 이름들은 거기서 온 것입니다 → [ADR-019](../../decisions/019-module-code-sync.md).

**서른둘 전부 코드가 있습니다** (2026-09-04 확인 — 폴더마다 `index.ts`·`types.ts`·`README.md`).
~~대부분은 아직 껍데기(`.gitkeep`)입니다.~~ 마지막 껍데기였던 `doc-filler` 는 [ADR-064](../../decisions/064-doc-filler-retired.md) 로
폴더째 폐기됐습니다 — 정본도 32 입니다.

**층 경계가 코드에 있습니다** — 서버 모듈 21개의 `index.ts` 는 `import "server-only"` 로, 브라우저에서만 도는
뷰어·핸들러 7개는 `import "client-only"` 로 시작합니다(ADR-028 「다섯」 · [RFC-001](../../rfc/001-repo-structure.md) 개정 이력 2026-09-04).
어느 표식도 없는 넷(`pii-masker`·`key-handler`·`pii-restorer`·`work-handler`)은 판정 함수와 타입이 본체입니다.
`tsx` 스크립트(`kb:load`·`migrate`·`probe:*`)는 `--conditions=react-server` 로 `server-only` 를 비웁니다.

**코드가 있다고 조립됐다는 뜻은 아닙니다.** 아래 「조립」 열은 `src/modules/` 밖에서 가져다 쓰는 파일이 있는지입니다(시험 제외).

| 층 | 모듈 | 조립 (2026-09-04) |
| --- | --- | --- |
| 1 · 증거가 들어올 때 | `case-intake` `transcriber` `pii-tokenizer` `case-reader` `slot-extractor` | `case-reader` 는 **아무 데서도 안 부릅니다**, `slot-extractor` 는 `lib/questions.ts` 가 타입만 씁니다 — 코드는 있고 배선이 없습니다 |
| 2 · 사용자가 말할 때 | `chat-receiver` `kb-finder` `prompt-builder` `citation-checker` `chat-publisher` · `pii-restorer`(브라우저) | 전부 배선됨 |
| 3 · 사건 상태가 바뀔 때 | `slot-checker` `planner` `date-checker` `completion-checker` `doc-builder` | `doc-builder` 는 **아무 데서도 안 부릅니다** — 기재 안내 화면(S-10)은 셸 `src/app/c/[token]/doc.tsx` 가 `GET …/doc-guide` 계약 없이 서 있습니다(ADR-064) |
| 4 · 하루 1회 | `kb-collector` `kb-reviewer` `reminder-sender` `case-purger` | `kb-collector`·`kb-reviewer` 는 **아무 데서도 안 부릅니다**. 크론 둘은 `/api/cron/reminders`·`/api/cron/purge` 가 부릅니다 |
| 층 없음 | `retry-checker` `audit-logger` | 배선됨 |
| C · 브라우저 | `pii-masker` `key-handler` `case-opener` `poll-checker` `file-sender` `transcript-viewer` `plan-viewer` `deadline-viewer` `chat-handler` `work-handler` | 전부 셸(`src/app/`)이 가져다 씁니다 |

「배선 없음」은 **구현 전이 아니라 조립 전**입니다 — 문서 넷이 이것을 현재형으로 적어 생긴 혼선은
[문서 손질 백로그 4절 ④](../../docs/plans/08-26-doc-gardening.md) 에 있습니다. 무엇을 하는 모듈인지는 아래 인벤토리로 읽으세요.

**폴더 하나의 파일 골격은 [RFC-001](../../rfc/001-repo-structure.md)이 정합니다.**

**모듈은 필요한 외부 자원을 직접 만들지 않고 인터페이스로 선언해 받습니다** →
[ADR-028](../../decisions/028-runtime-and-module-shape.md). NER 모델·볼트 제품·공휴일 출처가
아직 미정이어도 그 자리를 인터페이스로 두면 모듈을 완성할 수 있습니다.

**저장소 접근과 LLM 호출에는 모듈 이름이 없습니다.** 도메인 판단을 하지 않는 자원 접근이라
동작 단위가 아닙니다. 구현은 `src/lib/` 에 있고, 인터페이스는 그것을 쓰는 모듈이 소유합니다.

## 규칙 셋

1. **정본에 없는 이름으로 폴더를 만들 수 없습니다.** 새 모듈이 필요하면
   `spec/common/08-16-module-names.md`에 먼저 추가하고([ADR-014](../../decisions/014-module-names.md)도 함께 갱신),
   그다음 폴더를 만듭니다. 지어 쓰면 CI(`module-sync`)가 막습니다.
2. **정본에 있는데 폴더가 비어 있는 것은 정상입니다.** 아직 구현 전이라는 뜻입니다.
3. **여기 밖은 자유입니다.** 공용 유틸·UI 컴포넌트·라우트는 모듈이 아니므로 이 규칙에 걸리지 않습니다.

## 이 폴더에 무엇이 있는지 보려면

역할·층·서버인지 브라우저인지는 **정본을 읽어 답하는 도구**가 있습니다. 여기 적어두면 정본이 둘이 됩니다.

```bash
python .claude/skills/module-inventory/scripts/inventory.py module
python .claude/skills/module-inventory/scripts/inventory.py --find slot
```

## 주의 — 여기 있다고 전부 서버 코드가 아닙니다

**절반 가까이가 브라우저 모듈입니다** — 정본의 **층 C** 열(`pii-masker` `key-handler` `case-opener`
`poll-checker` `file-sender` `transcript-viewer` `plan-viewer` `deadline-viewer` `chat-handler`
`work-handler`)과, 층 2에 있는 `pii-restorer`까지 열하나입니다 (doc-filler 는 폐기 — ADR-064)
→ [ADR-023](../../decisions/023-frontend-module-names.md).

`pii-restorer`는 **브라우저에서만** 도는 모듈입니다. 서버에는 복호화 키가 없어 복원 자체가 불가능합니다
→ [PII 격리 경계](../../spec/common/08-14-pii-boundary.md) · [ADR-009](../../decisions/009-restore-mapping-location.md).
**서버에 복원 함수를 만들면 규칙 위반입니다.**

어느 모듈이 어디서 도는지는 인벤토리의 `↳ 어디서` 줄에 나옵니다.
