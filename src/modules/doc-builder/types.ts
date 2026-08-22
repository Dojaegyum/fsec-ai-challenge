/**
 * doc-builder — 입출력 타입과 이 모듈이 요구하는 것.
 *
 * 정본: decisions/037-doc-guidance-not-generation.md (기재 안내로 좁힘)
 *       spec/frontend/08-14-screens.md `S-10` (화면이 무엇을 보여주나)
 *       spec/common/08-16-module-names.md 층 3 (기재 항목과 값을 짝지어 낸다)
 *       spec/common/08-20-automation-boundary.md (기재 안내는 되고 대신 제출은 안 됨)
 * 근거: ADR-037 · ADR-028
 *
 * **서류를 만들어 주지 않습니다.** 무엇을 어느 칸에 적는지 값과 함께 보여줄 뿐입니다.
 * 별지 제1호서식 원본이 2차 출처로만 확보됐고(`U-17`) 파일 제출 경로도 미확인이라
 * (`U-25`), **우리가 조판한 것은 법정 서식이 아닙니다.** 틀린 서류는 반려되고
 * 반려는 3영업일을 놓치는 것입니다.
 *
 * 절대 하지 않는 것: 문서를 조판하기 · 칸 목록을 코드에 박기 · 원문을 내보내기 ·
 * 「못 채운 칸」을 실패처럼 보이게 하기 · 채우는 순서를 정하기
 */

/**
 * 칸 하나의 상태 → S-10 화면이 쓰는 값 그대로.
 *
 * | 값 | 무슨 뜻 | 어디서 오나 |
 * | --- | --- | --- |
 * | `confirmed` | 사용자가 확인했거나 직접 입력한 값 | 슬롯 `confirmed` |
 * | `unread` | 증거에서 읽었지만 **아직 확인 안 됨** | 슬롯 `extracted` |
 * | `unknown` | 값이 없습니다. **직접 적으셔야 합니다** | 슬롯 없음·`empty`·`unknown` |
 * | `staff` | **신청인이 안 적는 칸** — 접수번호·접수일자 | 서식이 그렇게 정함 |
 */
export type FieldState = 'confirmed' | 'unread' | 'unknown' | 'staff'

/**
 * 서식의 칸 하나 — **정의**입니다. 값은 여기 없습니다.
 *
 * ⬜ **이 정의를 코드에 박지 않습니다.** ADR-037 이 *"필수 기재사항은 여전히
 * KB 에서 옵니다 … 화면이나 프롬프트에 하드코딩하지 않습니다"* 라고 정했고,
 * `S-10` 이 *"확보하면 KB 항목으로 등재하고 칸 이름을 그대로 부를 수 있습니다"*
 * 라고 적었습니다. **아직 KB 에 없습니다** — `src/kb/common.json` 에 절차 넷만
 * 있고 서식 칸 목록은 없습니다.
 */
export interface FormField {
  /** 화면이 쓰는 식별자 */
  readonly id: string
  /** **서식에 적힌 칸 이름 그대로.** 우리가 바꿔 부르면 실물과 대조가 안 됩니다 */
  readonly label: string
  /**
   * 이 칸을 채우는 슬롯. **없는 칸이 많습니다.**
   *
   * 서식이 요구하는 것 중 성명·생년월일·주소·개설점포·예금종별·환급받을 계좌는
   * 슬롯이 아예 없습니다 → docs/research/01-환급절차-기한.md §5.3.
   * ⬜ 슬롯으로 늘릴지 화면에서만 물을지가 아직 미정입니다.
   */
  readonly slotKey?: string
  /**
   * 값이 없을 때 보일 보조문. **여기서 지어내지 않습니다** — 정의와 함께 옵니다.
   *
   * 「통장 표지에 있습니다」처럼 **어디서 찾는지**를 알려주는 문장입니다.
   * 빈칸을 초라하게 두지 않는 것이 이 화면의 요구입니다 → S-10 핸드오프.
   */
  readonly hint?: string
  /** 신청인이 안 적는 칸인가. 서식이 「색상이 어두운 란」이라고 표시한 것 */
  readonly filledByStaff?: boolean
}

/**
 * 서식의 구획 하나.
 *
 * **순서는 서식 실물 그대로입니다.** 사용자가 실물과 1:1 로 대조하라고 그렇게
 * 둔 것이지 「이 순서로 하세요」가 아닙니다 → S-10.
 */
export interface FormSection {
  readonly id: string
  readonly name: string
  readonly fields: readonly FormField[]
}

/**
 * 서식 하나의 정의. ⬜ **KB 에서 옵니다** — 위 참고.
 *
 * 근거 네 칸을 함께 답니다. 없으면 화면에 근거를 못 답니다 → 불변 규칙 1.
 */
export interface FormDefinition {
  readonly formId: string
  /** 서식 이름. 「피해구제신청서(별지 제1호서식)」 */
  readonly title: string
  readonly sections: readonly FormSection[]
  readonly kbEntryId: string
  readonly kbVersion: string
  readonly sourceUrl: string
  /** `YYYY-MM-DD` */
  readonly effectiveFrom: string
  /** 첨부서류 안내처럼 서식에 인쇄된 문장 */
  readonly notes?: readonly string[]
}

/** 사건이 아는 값 하나 → 09-data-model.md §5 */
export interface CaseSlotValue {
  readonly slotKey: string
  readonly state: 'empty' | 'extracted' | 'confirmed' | 'unknown'
  /**
   * **토큰화된 값**입니다. 원문이 아닙니다.
   *
   * 서버에는 복호화 키가 없어 원문을 만들 수 없습니다. 화면에 뜨는 값의 복원은
   * `doc-filler` 가 **브라우저에서** 합니다 → 04-pii-boundary.md 규칙 6.
   */
  readonly valueMasked: string | null
}

/** 짝지어진 칸 하나 — 화면이 그대로 그립니다 */
export interface GuideField {
  readonly id: string
  readonly label: string
  readonly state: FieldState
  /**
   * 토큰화된 값. **원문이 아닙니다.**
   *
   * 화면은 이것을 가려진 칩으로 그리고, 열쇠가 있는 기기에서만 원문으로
   * 되돌립니다. 열쇠가 없으면 칩 그대로이고 **그 상태가 정상입니다**.
   */
  readonly valueMasked?: string
  /** 값이 없을 때의 보조문 */
  readonly hint?: string
}

export interface GuideSection {
  readonly id: string
  readonly name: string
  readonly fields: readonly GuideField[]
  /** 이 구획에서 값이 있는 칸 수. **없는 것을 세지 않습니다** — 아래 */
  readonly filled: number
  /** 신청인이 적어야 하는 칸 수 (`staff` 칸 제외) */
  readonly toWrite: number
}

export interface DocGuide {
  readonly formId: string
  readonly title: string
  readonly sections: readonly GuideSection[]
  /** 서식에 인쇄된 문장들 */
  readonly notes: readonly string[]
  /**
   * 근거. **없으면 안내를 내보내지 않습니다** → 불변 규칙 1.
   */
  readonly citation: {
    readonly kbEntryId: string
    readonly kbVersion: string
    readonly sourceUrl: string
    readonly effectiveFrom: string
  }
}

export interface BuildInput {
  /** ⬜ KB 에서 온 서식 정의 */
  readonly form: FormDefinition
  /** 사건이 지금 아는 값들 */
  readonly slots: readonly CaseSlotValue[]
}

export interface DocBuilder {
  /**
   * 기재 항목과 값을 짝지어 낸다.
   *
   * **문서를 조판하지 않습니다.** 돌려주는 것은 「어느 칸에 무엇을 적는지」이지
   * 파일이 아닙니다 → ADR-037.
   *
   * **정보가 없다고 멈추지 않습니다.** 값이 하나도 없어도 안내는 나갑니다 —
   * 서식이 요구하는 것 대부분은 애초에 사용자가 직접 적는 값입니다
   * → CLAUDE.md 불변 규칙 5.
   *
   * @throws KbError 서식 정의에 근거 네 칸이 없거나 칸이 하나도 없을 때.
   *         **근거 없는 안내를 내보내지 않습니다** → 불변 규칙 1.
   *         `planner` 가 같은 상황에 던지는 것과 **같은 예외**입니다 — 서식도
   *         KB 에서 오는 절차 지식이라 같은 종류의 사고입니다.
   */
  build(input: BuildInput): DocGuide
}
