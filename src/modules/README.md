# modules — 도메인 모듈

**폴더 이름은 여기서 정하지 않습니다.** [모듈 명칭](../../spec/common/08-16-module-names.md)이 정본이고,
이 폴더의 이름들은 거기서 온 것입니다 → [ADR-019](../../decisions/019-module-code-sync.md).

대부분은 아직 **껍데기**(`.gitkeep`)입니다. 구현이 시작되면 각 폴더가 채워집니다.

| 채워진 모듈 | |
| --- | --- |
| [`pii-masker/`](pii-masker/) | 나가기 전 계좌·주민번호·카드·전화를 가린다 (층 C) |
| [`key-handler/`](key-handler/) | 세션키를 만들고 지키며, 매핑을 봉하고 연다 (층 C) |
| [`pii-restorer/`](pii-restorer/) | 복원해도 되는지 심사하고 되돌린다 (층 C) |
| [`retry-checker/`](retry-checker/) | 예외의 `retryable` 로 재시도 판단 (층 없음) |
| [`citation-checker/`](citation-checker/) | 인용 셋 확인, 갈래 셋 판정 (층 2) |
| [`prompt-builder/`](prompt-builder/) | 블록 조립·참조 번호 발급·격리 태그 (층 2) |
| [`chat-publisher/`](chat-publisher/) | 갈래를 한 형태로, 판단 근거 분리, 잔여 PII 검사 (층 2) |
| [`slot-checker/`](slot-checker/) | T1 충족 판정, 다음 질문 1문항 (층 3) |
| [`date-checker/`](date-checker/) | 법정 기한을 규칙으로 계산, 잔여일 추적 (층 3) |
| [`completion-checker/`](completion-checker/) | 부산물로 완료 판정 L1·L2·L3 (층 3) |
| [`audit-logger/`](audit-logger/) | 해시 사슬로 기록, 사후 조작 검출 (층 없음) |

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

**절반 가까이가 브라우저 모듈입니다** — 정본의 **층 C** 열하나(`pii-masker` `key-handler` `case-opener`
`poll-checker` `file-sender` `transcript-viewer` `plan-viewer` `deadline-viewer` `chat-handler`
`work-handler` `doc-filler`)와, 층 2에 있는 `pii-restorer`까지 열둘입니다
→ [ADR-023](../../decisions/023-frontend-module-names.md).

`pii-restorer`는 **브라우저에서만** 도는 모듈입니다. 서버에는 복호화 키가 없어 복원 자체가 불가능합니다
→ [PII 격리 경계](../../spec/common/08-14-pii-boundary.md) · [ADR-009](../../decisions/009-restore-mapping-location.md).
**서버에 복원 함수를 만들면 규칙 위반입니다.**

어느 모듈이 어디서 도는지는 인벤토리의 `↳ 어디서` 줄에 나옵니다.
