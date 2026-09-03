# doc-filler 를 폐기한다 — 기재 안내 화면은 셸 소유, plan-viewer 는 어휘의 정본으로 남긴다

- 상태: **채택**
- 날짜: 2026-09-03
- 결정: @Dojaegyum
- 관련 문서: [ADR-037](037-doc-guidance-not-generation.md) (기재 안내로 좁힌 결정 — **유지**, 단 「doc-filler 는 그대로 남습니다」 행만 이 문서가 대체) ·
  [ADR-023](023-frontend-module-names.md) (층 C 명명 — 이 결정으로 「작업하는 자리」가 하나 줄어듦) ·
  [ADR-063](063-chat-centered-layout.md) (챗 중심 재편 — 할 일 레일 `todo.tsx` 신설) ·
  [모듈 명칭](../spec/common/08-16-module-names.md) · [모듈 경계](../spec/common/08-16-module-boundaries.md) (이 결정으로 개정) ·
  [PII 격리 경계](../spec/common/08-14-pii-boundary.md) (**안 바뀝니다** — 복원은 여전히 브라우저에서만)

## 맥락

`doc-filler` 는 [ADR-037](037-doc-guidance-not-generation.md)이 F-08 을 「초안 생성 → 기재 안내」로
좁힐 때 「값 복원은 브라우저에서만」이라는 이유로 남겨 둔 이름입니다. 그 뒤로:

- **폴더만 있습니다.** `src/modules/doc-filler/` 는 `.gitkeep` 하나입니다 — 층 C 12개 중
  유일하게 코드가 0 인 모듈로, 구현 상태 주석과 QA 계획이 계속 "막혀 있음"으로 세고 있습니다
  ([layer-c-viewers](../docs/plans/08-22-layer-c-viewers.md) 「doc-filler 는 이 계획에서 뺐습니다」).
- **남은 일이 모듈감이 아닙니다.** 같은 계획서가 적었듯 실제로 할 일은
  「`valueMasked` 를 원문으로 되돌리고 복사시키는 것」 하나입니다. 그런데 모듈 경계 표에서
  **모든 자리의 복원은 이미 `pii-restorer` 의 몫**이고, 키는 `key-handler` 가 쥡니다.
  doc-filler 가 생기면 복원 책임이 두 이름으로 갈라집니다.
- **화면은 이미 셸에 서 있습니다.** `src/app/c/[token]/doc.tsx` 가 구획·복사·`unread` 표시·
  클립보드 폴백까지 갖고 있고, 머리 주석만 층 C 소속을 `doc-filler` 로 가리키고 있습니다.

## 결정

1. **`doc-filler` 를 폐기합니다.** `src/modules/doc-filler/` 폴더를 지우고, 층 C 는 11개가 됩니다.
2. **기재 안내 화면(S-10)은 셸 소유로 명시합니다** — `src/app/c/[token]/doc.tsx`.
   화면에 뜨는 값의 복원은 `pii-restorer`(+`key-handler`) 를 부르는 것으로, 새 이름을 만들지 않습니다.
   `doc-builder`(층 3) 의 `DocGuide` 계약과 「summarize 를 브라우저가 다시 세지 않는다」는
   layer-c-viewers 의 주의는 그대로 유효합니다 — 소유자가 모듈에서 셸로 바뀔 뿐입니다.
3. **`plan-viewer` 는 폐기하지 않습니다.** ADR-063 으로 플랜 보드(S-07)가 개발 경로 전용이
   됐지만, `plan-viewer` 는 **단계 상태 어휘(`tagOf`·`toneOf`)와 정렬 판정(`order`)의 정본
   모듈로 남습니다.** 할 일 레일 `todo.tsx` 가 자체 `MARK` 상수로 태그 어휘를 중복 정의하던
   것을 **`tagOf` 를 쓰도록 재배선**했습니다 — 어휘가 두 곳에 있으면 §S-07 어휘 개정 때
   레일과 보드가 어긋납니다. (재배선에서 `in_progress` 의 태그는 어휘 표 그대로
   빈 문자열이고 서버가 준 D-day 가 그 자리를 대신합니다 — 레일 전용 낱말을 만들지 않았습니다.)

| | 이전 | 이후 |
| --- | --- | --- |
| `doc-filler` | 층 C 모듈(빈 폴더) | **폐기** — 폴더 삭제 |
| 기재 안내 화면 | `doc-filler` 소속으로 표기 | **셸(`doc.tsx`) 소유** — 복원은 `pii-restorer`·`key-handler` 호출 |
| `plan-viewer` | 보드 렌더 + 어휘 + 정렬 | **어휘·정렬 판정의 정본** (보드 렌더는 개발 경로 전용으로 유지) |
| `todo.tsx` 태그 | 자체 `MARK` 상수 | **`plan-viewer` 의 `tagOf`** 를 사용 |
| 층 C 개수 | 12 | **11** |

### 안 바뀌는 것 — 이 결정의 경계

- **[ADR-037](037-doc-guidance-not-generation.md) 은 유지됩니다.** 기재 안내(문서 미생성) ·
  `.docx` P2 · 재검토 트리거 전부 그대로입니다. 그 문서의 「doc-filler 는 그대로 남습니다」
  행만 이 문서가 대체합니다.
- **PII 경계는 그대로입니다.** 「안내 패널에 뜨는 값의 복원은 브라우저에서만」이라는 제약은
  이름이 아니라 `pii-restorer` 의 「브라우저 밖에서 복원하기 금지」가 지킵니다.
- **「서버가 만든 완성 문서를 받지 않는다」는 금지도 그대로입니다** — doc-filler 행에 있던
  이 금지는 셸(`doc.tsx`) 머리 주석이 집니다.

## 탈락한 대안

| 대안 | 왜 탈락 |
| --- | --- |
| doc-filler 를 구현해 채우기 | 남은 일이 `pii-restorer` 호출 + 복사뿐 — 모듈 하나 값이 안 나오고 복원 책임이 갈라집니다 |
| 빈 폴더로 계속 두기 (현상 유지) | 인벤토리·QA 집계가 계속 "12 중 11"을 세고, 구현 상태 주석이 늙어 갑니다 |
| plan-viewer 도 함께 폐기 | 어휘·정렬 판정이 `todo.tsx` 상수로 내려가면 §S-07 어휘의 정본이 화면 파일 안에 숨습니다 — ADR-063 이 죽인 것은 보드 배치이지 판정이 아닙니다 |
