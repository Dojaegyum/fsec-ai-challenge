/**
 * 사용자가 질문에 답한 것을 받아 저장하고 플랜을 다시 만드는 흐름.
 *
 * 정본: spec/common/08-14-api.md §3.5
 * 근거: ADR-040(쓰기도 경계를 지난다) · ADR-041(거부 대신 되묻기) ·
 *       CLAUDE.md 불변 규칙 5(「모름」은 실패가 아니다)
 *
 * ## ⚠️ 쓰기도 경계를 지납니다
 *
 * 사용자가 타이핑한 값에 계좌번호가 들어 있을 수 있습니다. 그대로 저장하면
 * **저장소가 유출되는 순간 그대로 읽힙니다** — 볼트를 따로 둔 의미가
 * 없어집니다 → ADR-040.
 *
 * ## 거부하지 않고 되묻습니다 → ADR-041
 *
 * 개인정보 후보를 찾으면 **저장을 미루고 사용자에게 확인합니다.** 거부하면
 * 사용자는 무엇이 문제인지 모른 채 막히고, 그냥 저장하면 경계가 깨집니다.
 *
 * 확인 전에는 `pii_pending` 이고, **그 상태는 채워진 것으로 안 셉니다** —
 * 확인 전에는 없는 값과 같습니다. 다만 **플랜을 막지는 않습니다.**
 * T0 와 유형 기본은 그대로 나갑니다.
 */

import 'server-only'

import type { Container } from '@/lib/container'
import { BadRequestError } from '@/lib/http'

import { tierOf, valueTypeOf } from '@/modules/slot-checker'

import { readCasePlan } from './regenerate-plan'

/** 사용자가 할 수 있는 것 → §3.5 */
export type SlotAction = 'answer' | 'unknown' | 'mask' | 'keep'

export interface AnswerResult {
  readonly slotKey: string
  readonly state: string
  /** **토큰화된 값.** 「모름」이면 `null` */
  readonly value: string | null
  /** 개인정보 후보가 있어 확인이 필요할 때만 */
  readonly piiConfirm: {
    readonly found: readonly { kind: string; text: string }[]
  } | null
  readonly planRegenerated: boolean
}

/**
 * 답 하나를 받는다.
 *
 * **「모름」도 정상입니다** → 불변 규칙 5. 값이 없어도 플랜은 계속 나갑니다.
 */
export async function answerSlot(
  input: {
    readonly caseId: string
    readonly slotKey: string
    readonly action: SlotAction
    readonly value?: string
  },
  container: Container,
): Promise<AnswerResult> {
  const tier = tierOf(input.slotKey)
  // `case_slot.value_type` 이 필수입니다. 정본은 slot-checker 의 표 하나입니다
  const valueType = valueTypeOf(input.slotKey)

  // ── 「모름」 ────────────────────────────────────────────────────────
  if (input.action === 'unknown') {
    await container.slotWrite.write({
      caseId: input.caseId,
      slotKey: input.slotKey,
      tier,
      valueType,
      // **실패가 아니라 정상 상태입니다.** 다시 묻지 않는다는 뜻이기도 합니다
      state: 'unknown',
      valueMasked: null,
      source: 'user',
    })
    return {
      slotKey: input.slotKey,
      state: 'unknown',
      value: null,
      piiConfirm: null,
      planRegenerated: false,
    }
  }

  const raw = input.value
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new BadRequestError('value 가 없습니다', { param: 'value' })
  }

  // ── 경계 ───────────────────────────────────────────────────────────
  // **사용자가 타이핑한 글입니다** — 전사문이 아니므로 숫자 규칙을 켜지
  // 않습니다. 여기서 켜면 멀쩡한 금액까지 가려집니다
  const masked = await container.piiTokenizer.tokenize(raw)

  // ── 「아니에요, 개인정보가 아닙니다」 → ADR-041 ④ ──────────────────
  //
  // **과차단을 푸는 것**입니다. ADR-041 ④ 가 둘을 갈랐습니다 —
  //
  //   「`[기관-1]` 은 국민은행이에요」  ✅ 허용 목록으로 되돌리는 것
  //   「제 계좌번호 그냥 보내세요」      ❌ 불변 규칙 2 는 안 깨집니다
  //
  // 그 구분이 `allowedTerms` 의 뜻에 이미 들어 있습니다 — **모델이 집은
  // 것에만 걸리고, 정규식이 잡은 것에는 안 걸립니다**(`tokenize.ts` 의
  // `nerToSpans`). 그래서 계좌·주민번호·카드·전화는 사용자가 「아니에요」를
  // 골라도 **그대로 가려집니다.** 그게 맞는 동작입니다.
  if (input.action === 'keep') {
    const rechecked = await container.piiTokenizer.tokenize(raw, {
      allowedTerms: [raw],
    })
    await container.slotWrite.write({
      caseId: input.caseId,
      slotKey: input.slotKey,
      tier,
      valueType,
      state: 'confirmed',
      valueMasked: rechecked.masked,
      source: 'user',
    })
    return {
      slotKey: input.slotKey,
      state: 'confirmed',
      value: rechecked.masked,
      piiConfirm: null,
      planRegenerated: true,
    }
  }

  // ── 개인정보 후보가 있으면 저장을 미룬다 → ADR-041 ─────────────────
  if (input.action === 'answer' && masked.added.length > 0) {
    await container.slotWrite.write({
      caseId: input.caseId,
      slotKey: input.slotKey,
      tier,
      valueType,
      // **확인 전에는 없는 값과 같습니다** — 채워진 것으로 안 셉니다
      state: 'pii_pending',
      // ⚠️ 미뤄도 **원문은 안 넣습니다.** 가린 것을 넣습니다
      valueMasked: masked.masked,
      source: 'user',
    })
    return {
      slotKey: input.slotKey,
      state: 'pii_pending',
      // 확인 전에는 값을 안 내보냅니다 → ADR-041
      value: null,
      piiConfirm: {
        // **원문이 아니라 무엇을 찾았는지**만. 화면이 「이게 계좌번호 맞나요」를
        // 물으려면 그 값을 보여줘야 하는데, 그 값은 **브라우저에 이미 있습니다**
        found: masked.added.map((one) => ({ kind: one.kind, text: one.token })),
      },
      planRegenerated: false,
    }
  }

  // ── 개인정보가 없거나 「가릴게요」 ─────────────────────────────────
  await container.slotWrite.write({
    caseId: input.caseId,
    slotKey: input.slotKey,
    tier,
    valueType,
    state: 'confirmed',
    valueMasked: masked.masked,
    source: 'user',
  })

  return {
    slotKey: input.slotKey,
    state: 'confirmed',
    value: masked.masked,
    piiConfirm: null,
    planRegenerated: true,
  }
}

/** 답한 뒤의 상태 — 다음 질문과 플랜 갱신 여부를 화면에 알려줍니다 */
export async function afterAnswer(caseId: string, container: Container) {
  return readCasePlan(caseId, { container, store: container.ports.casePlan })
}
