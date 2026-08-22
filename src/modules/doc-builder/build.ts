/**
 * 기재 항목과 값을 짝짓는 자리.
 *
 * 계약: decisions/037-doc-guidance-not-generation.md · spec/frontend/08-14-screens.md `S-10`
 *
 * ## 이 모듈이 갖지 않는 것
 *
 * **서식의 칸 목록을 갖지 않습니다.** ADR-037 이 *"필수 기재사항은 여전히 KB 에서
 * 옵니다 … 화면이나 프롬프트에 하드코딩하지 않습니다"* 라고 정했습니다.
 * 여기 있는 것은 **짝짓는 규칙**뿐이고, 무엇을 짝지을지는 밖에서 옵니다.
 *
 * 칸 이름을 여기 적으면 서식이 개정될 때 코드 배포가 따라옵니다. 그리고 지금
 * 우리가 가진 서식은 **2차 출처**라(`U-17`) 1차 대조가 남아 있습니다 —
 * 바뀔 것을 코드에 박으면 안 됩니다.
 *
 * ## 못 채운 칸을 실패처럼 보이게 하지 않습니다
 *
 * 서식이 요구하는 것 중 성명·생년월일·주소·개설점포·예금종별·환급받을 계좌는
 * **슬롯이 아예 없습니다** → docs/research/01-환급절차-기한.md §5.3.
 * 환급받을 계좌는 **원래 알 수 없는 값**이고, 그 구획이 `0` 으로 뜨면 우리가
 * 실패한 것처럼 읽힙니다.
 *
 * 그래서 세는 것이 둘입니다 — **값이 있는 칸**과 **사용자가 적어야 하는 칸**.
 * 화면이 「전부 직접 적습니다」로 말할 수 있게 하려는 것입니다
 * → CLAUDE.md 불변 규칙 5 의 화면판.
 *
 * ## 원문을 다루지 않습니다
 *
 * 값은 **토큰화된 상태** 그대로 나갑니다. 서버에는 복호화 키가 없어 원문을
 * 만들 수 없고, 만들면 안 됩니다 → 04-pii-boundary.md 규칙 6.
 * 복원은 `doc-filler` 가 브라우저에서 합니다.
 */

import { KbError } from '@/lib/errors'

import type {
  BuildInput,
  CaseSlotValue,
  DocBuilder,
  DocGuide,
  FieldState,
  FormField,
  GuideField,
  GuideSection,
} from './types'

/**
 * 슬롯 상태를 칸 상태로.
 *
 * **`extracted` 를 `confirmed` 로 올리지 않습니다.** 증거에서 읽은 값은 사용자가
 * 확인하기 전까지 「확인해 주세요」로 남아야 합니다 — 잘못 읽은 계좌번호를
 * 확인된 값으로 보여주면 그대로 서류에 옮겨 적습니다.
 */
function stateOf(slot: CaseSlotValue | undefined): FieldState {
  if (!slot) return 'unknown'
  // 「모름」은 값이 아닙니다. 다시 묻지도 않지만 채워진 것도 아닙니다
  if (slot.state === 'empty' || slot.state === 'unknown') return 'unknown'
  // **개인정보인지 확인 전이면 없는 값과 같습니다** → ADR-041 · 09-data-model.md §5.2.
  // 여기서 안 걸러내면 마지막 줄이 `'unread'` 로 떨어뜨리고 `valueMasked` 까지
  // 실려 나갑니다 — 확인받지 않은 계좌번호가 「읽어 둔 값」으로 서류에 옮겨집니다.
  // `slot-checker` 도 같은 이유로 이 상태를 채움에서 뺍니다(check.ts `tierStatus`)
  if (slot.state === 'pii_pending') return 'unknown'
  // **공백만 있는 것은 값이 아닙니다.** 그냥 두면 화면이 그 칸을 「확인된 값」으로
  // 그리고, 「통장 표지에 있습니다」 같은 보조문까지 떼어 버립니다 —
  // 사용자는 이미 채워진 줄 알고 비운 채 냅니다. 필수 기재사항 누락은 반려이고
  // 반려는 3영업일 상실입니다.
  // 같은 파일의 근거 검사도 `trim()` 을 쓰고, 이웃 모듈들도 그렇습니다
  if (!slot.valueMasked || slot.valueMasked.trim().length === 0) return 'unknown'
  return slot.state === 'confirmed' ? 'confirmed' : 'unread'
}

function pair(
  field: FormField,
  slots: ReadonlyMap<string, CaseSlotValue>,
): GuideField {
  // 신청인이 안 적는 칸은 값을 찾지 않습니다 — 서식이 「색상이 어두운 란」으로
  // 표시한 자리이고, 접수처가 채웁니다
  if (field.filledByStaff) {
    return {
      id: field.id,
      label: field.label,
      state: 'staff',
      ...(field.hint ? { hint: field.hint } : {}),
    }
  }

  const slot = field.slotKey ? slots.get(field.slotKey) : undefined
  const state = stateOf(slot)

  return {
    id: field.id,
    label: field.label,
    state,
    // 값이 없을 때만 보조문을 답니다 — 있는데도 「직접 적으세요」가 뜨면 헷갈립니다
    ...(state === 'unknown' && field.hint ? { hint: field.hint } : {}),
    ...(state !== 'unknown' && slot?.valueMasked
      ? { valueMasked: slot.valueMasked }
      : {}),
  }
}

export function createDocBuilder(): DocBuilder {
  return {
    build(input: BuildInput): DocGuide {
      const { form, slots } = input

      assertUsable(form)

      const bySlot = new Map<string, CaseSlotValue>()
      for (const one of slots) bySlot.set(one.slotKey, one)

      const sections: GuideSection[] = form.sections.map((section) => {
        const fields = section.fields.map((field) => pair(field, bySlot))

        return {
          id: section.id,
          name: section.name,
          fields,
          filled: fields.filter(
            (one) => one.state === 'confirmed' || one.state === 'unread',
          ).length,
          // 신청인이 적을 칸만 셉니다. 접수처가 채우는 칸을 「할 일」로 세면
          // 사용자가 못 하는 일까지 자기 몫으로 읽습니다
          toWrite: fields.filter((one) => one.state !== 'staff').length,
        }
      })

      return {
        formId: form.formId,
        title: form.title,
        sections,
        notes: form.notes ?? [],
        citation: {
          kbEntryId: form.kbEntryId,
          kbVersion: form.kbVersion,
          sourceUrl: form.sourceUrl,
          effectiveFrom: form.effectiveFrom,
        },
      }
    },
  }
}

/**
 * 근거 없는 안내를 내보내지 않는다 → CLAUDE.md 불변 규칙 1.
 *
 * `plan_step` 이 근거 네 칸이 비면 적재를 거부하는 것과 같은 자리입니다
 * → 09-data-model.md §6. **서식도 절차 지식이라 같은 규칙을 받습니다.**
 *
 * 특히 `effective_from` 이 중요합니다. 서식은 개정되고, 어느 개정본을 보고
 * 안내했는지가 남아야 나중에 「왜 이렇게 안내했나」를 재현할 수 있습니다.
 */
function assertUsable(form: BuildInput['form']): void {
  const missing = (
    [
      ['kbEntryId', form.kbEntryId],
      ['kbVersion', form.kbVersion],
      ['sourceUrl', form.sourceUrl],
      ['effectiveFrom', form.effectiveFrom],
    ] as const
  )
    .filter(([, value]) => !value || value.trim().length === 0)
    .map(([name]) => name)

  if (missing.length > 0) {
    // **이웃과 같은 예외를 씁니다.** `planner` 가 「적재된 KB 항목에 근거 네 칸이
    // 없다」에 `KbError` 를 던집니다(plan.ts:179) — 서식도 KB 에서 오는 절차
    // 지식이라 같은 종류의 사고입니다. 새 코드를 만들면 감사·모니터링에서
    // 같은 사고가 둘로 갈려 집계됩니다
    throw new KbError('서식 정의에 근거가 없습니다', {
      formId: form.formId,
      missing,
    })
  }

  const fields = form.sections.reduce(
    (total, section) => total + section.fields.length,
    0,
  )
  if (fields === 0) {
    // 칸이 하나도 없는 안내는 「무엇을 적는지」를 못 말합니다
    throw new KbError('서식 정의에 칸이 없습니다', { formId: form.formId })
  }
}

