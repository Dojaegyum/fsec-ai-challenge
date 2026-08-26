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

import { channelForOption } from '@/lib/questions'
import { matchOrg } from '@/lib/org-match'

import { tierOf, valueTypeOf } from '@/modules/slot-checker'

import { readCasePlan, regeneratePlan } from './regenerate-plan'

import type { DeadlineChange } from '@/lib/db'
import type { NextQuestion } from '@/modules/slot-checker'

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
    await recordChannel(input.caseId, input.slotKey, raw, rechecked.masked, container)

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
  //
  // **기관 정규화를 먼저 합니다.** 그 결과가 슬롯 상태를 가릅니다 — 말한 곳을
  // 못 알아봤으면 `confirmed` 로 닫으면 안 됩니다. 닫으면 슬롯 체커가 다시
  // 묻지 않고(질문 대상은 `empty` 와 기관 재확인뿐), 사용자는 아무 말도 못
  // 들은 채 유형 기본 절차로 떨어집니다 → §11.4.4 ①
  const { orgUnresolved } = await recordChannel(
    input.caseId,
    input.slotKey,
    raw,
    masked.masked,
    container,
  )

  // 값은 남깁니다 — 사용자가 그렇게 말한 것은 사실입니다. 다만 **어느 기관인지
  // 정해지지 않았으므로 확인 전**입니다
  const state = orgUnresolved ? 'extracted' : 'confirmed'

  await container.slotWrite.write({
    caseId: input.caseId,
    slotKey: input.slotKey,
    tier,
    valueType,
    state,
    valueMasked: masked.masked,
    source: 'user',
  })

  return {
    slotKey: input.slotKey,
    state,
    value: masked.masked,
    piiConfirm: null,
    planRegenerated: true,
  }
}

/**
 * 답이 경유 서비스·기관을 정하면 `case_channel` 에 적는다 → §4 · §4.1.
 *
 * ⚠️ **2026-08-25 까지 이 자리가 없었습니다.** 사용자가 「시중은행 계좌이체」를
 * 골라도 그 라벨 문자열이 슬롯에만 남고 `case_channel` 은 비어 있었습니다.
 * 그래서 **유형별 KB 가 조회에 안 걸리고**(§11.2 2순위) **번호도 안 붙었습니다.**
 * `channelForOption` 은 만들어져 있었는데 부르는 자리가 없었습니다.
 *
 * ## 매칭은 원문으로, 저장은 가린 값으로
 *
 * 「국민은행」은 개인정보가 아니지만(§4.1 · ADR-011) 2차 모델이 기관명을 집을 수
 * 있습니다. 가린 값으로 매칭하면 `[기관-1]` 과 별칭을 견주게 되어 **늘 실패**하고,
 * 원문을 저장하면 경계가 깨집니다. 그래서 **견주는 것은 원문, 표에 남기는 것은
 * 가린 값**입니다 — 나온 `org_id` 자체는 개인정보가 아닙니다.
 *
 * **실패해도 답 저장을 되돌리지 않습니다.** 기관을 못 찾는 것은 정상이고
 * (§4.1 *"못 찾아도 진행합니다"*), 유형 기본 절차는 그대로 나갑니다.
 */
async function recordChannel(
  caseId: string,
  slotKey: string,
  raw: string,
  masked: string,
  container: Container,
): Promise<{ readonly orgUnresolved: boolean }> {
  // **못 알아본 것만 참입니다.** 유형을 아직 모르거나 이 답이 기관이 아니거나
  // 여기서 터진 경우는 전부 거짓입니다 — 되물어도 사용자가 고를 것이 없습니다
  const resolved = { orgUnresolved: false }
  const unresolved = { orgUnresolved: true }

  try {
    if (slotKey === 'channel') {
      // 화면이 보내는 것은 사람이 읽는 라벨입니다. **8유형 밖의 값을 만들지
      // 않습니다** — 표에 없으면 답으로 못 받은 것으로 둡니다 (questions.ts)
      const channelId = channelForOption(raw) ?? channelForOption(masked)
      if (!channelId) return resolved
      await container.channelWrite.write({
        caseId,
        channelId,
        orgId: null,
        orgNameRaw: null,
        source: 'user',
      })
      return resolved
    }

    if (slotKey === 'org_name') {
      // **유형을 알아야 후보를 좁힙니다.** 전 기관에서 「제주」를 찾으면
      // 제주은행과 다른 곳이 함께 걸릴 수 있습니다
      const channel = await container.ports.casePlan.readChannel(caseId)
      // 유형을 모르면 후보를 좁힐 수 없습니다. 되묻는 대신 유형 문항이 먼저
      // 나가야 하므로 여기서는 못 알아본 것으로 세지 않습니다
      if (!channel) return resolved

      const version = await container.ports.kbVersion.current()
      const candidates = await container.channelWrite.candidates(channel.channelId, version)

      // 못 찾으면 `null` — 유형 기본으로 갑니다 (§11.4.3). **다만 조용히
      // 넘어가지는 않습니다** — 아래에서 되묻기 대상으로 올립니다
      const orgId = matchOrg(raw, candidates)

      await container.channelWrite.write({
        caseId,
        channelId: channel.channelId,
        orgId,
        orgNameRaw: masked,
        source: 'user',
      })

      // **후보가 없으면 되묻지 않습니다.** 그 유형에 사전이 아직 없다는 뜻이라
      // 선택지를 만들 수 없고, 물어도 사용자가 고를 것이 없습니다
      return orgId === null && candidates.length > 0 ? unresolved : resolved
    }
  } catch {
    // 여기서 던지면 **답이 저장됐는데 응답이 500** 이 됩니다. 사용자는
    // 같은 답을 다시 넣게 되고, 그때도 같은 자리에서 터집니다
    //
    // **터졌을 때 되묻지 않는 이유**는 이 실패가 기관을 못 알아본 것이 아니라
    // 조회 자체가 안 된 것이기 때문입니다. 되물어도 같은 자리에서 또 터집니다
  }

  return resolved
}

/** 답한 뒤에 화면이 받아야 하는 것 → §3.5 */
export interface AfterAnswer {
  readonly nextQuestion: NextQuestion | null
  /** 이번 답으로 옮겨졌거나 새로 생긴 기한. 없으면 빈 배열 */
  readonly changedDeadlines: readonly DeadlineChange[]
}

/**
 * 답한 뒤의 상태 — **값이 들어갔으면 플랜을 다시 만듭니다** → §3.5
 * *"슬롯이 채워지면 플랜을 자동 재생성합니다"*.
 *
 * ⚠️ 2026-08-25 까지 이 자리가 **읽기만 했습니다.** `plan_regenerated: true` 를
 * 내보내면서 실제로는 아무것도 안 만들고 있었습니다 — 경유 서비스를 답해도
 * 그 유형의 절차가 안 붙고 T0 공통 넷만 남았습니다. `regeneratePlan` 을 부르는
 * 자리가 코드 어디에도 없었습니다.
 *
 * **저장이 안 된 답에는 안 돕니다.** `pii_pending` 은 확인 전이라 없는 값과
 * 같고(ADR-041), 그 상태로 플랜을 다시 만들면 감사 기록만 쌓입니다.
 */
export async function afterAnswer(
  caseId: string,
  container: Container,
  stored: boolean,
): Promise<AfterAnswer> {
  if (!stored) {
    const read = await readCasePlan(caseId, { container, store: container.ports.casePlan })
    return { nextQuestion: read.nextQuestion, changedDeadlines: [] }
  }

  const made = await regeneratePlan(caseId, {
    container,
    store: container.ports.casePlan,
    kbVersion: container.ports.kbVersion,
  })
  return { nextQuestion: made.nextQuestion, changedDeadlines: made.changedDeadlines }
}
