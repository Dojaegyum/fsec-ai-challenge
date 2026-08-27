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

import { allowedTermsFor } from '@/lib/allowed-terms'
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
  // 않습니다. 여기서 켜면 멀쩡한 금액까지 가려집니다.
  //
  // **제외 목록을 여기서부터 넘깁니다** → 04-pii-boundary.md.
  // 「어느 서비스로 보내셨나요」에 **「카카오페이」라고 타이핑하는 자리**라
  // 목록이 없으면 그 답이 `[이름-1]` 이 되어 유형 분기가 무너집니다.
  // 아래 「아니에요」 분기는 **그걸 되돌리는 길**이지 첫 방어가 아닙니다 —
  // 사용자가 알아채야만 돌아오는 구조를 첫 방어로 두면 안 됩니다
  const orgTerms = await allowedTermsFor({
    channels: container.channelWrite,
    kbVersion: container.ports.kbVersion,
  })
  const masked = await container.piiTokenizer.tokenize(raw, { allowedTerms: orgTerms })

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
      // 사용자가 고른 값 + 기관 사전. 앞엣것만 넘기면 「국민은행 김민수」처럼
      // 섞인 값에서 기관 쪽이 다시 가려집니다
      allowedTerms: [raw, ...orgTerms],
    })
    // **보통 답과 같은 자리를 지납니다.** 여기만 따로 적으면 「아니에요」를 지난
    // 답은 경유 서비스를 못 알아봤어도, 기관을 못 골랐어도 `confirmed` 로
    // 닫힙니다 — 되묻기가 그 경로에서만 조용히 사라집니다
    return storeAnswer(
      {
        caseId: input.caseId,
        slotKey: input.slotKey,
        tier,
        valueType,
        raw,
        masked: rechecked.masked,
      },
      container,
    )
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
  return storeAnswer(
    {
      caseId: input.caseId,
      slotKey: input.slotKey,
      tier,
      valueType,
      raw,
      masked: masked.masked,
    },
    container,
  )
}

/**
 * 답 하나를 적는다 — **경유 서비스·기관을 먼저 보고, 그 결과가 슬롯 상태를 가릅니다.**
 *
 * 말한 곳을 못 알아봤으면 `confirmed` 로 닫으면 안 됩니다. 닫으면 슬롯 체커가
 * 다시 묻지 않고(질문 대상은 `empty` 와 기관 재확인뿐), 사용자는 아무 말도 못
 * 들은 채 유형 기본 절차로 떨어집니다 → §11.4.4 ①
 *
 * 갈래는 셋입니다.
 *
 * | 무엇 | 슬롯 | 왜 |
 * | --- | --- | --- |
 * | 표에 없는 경유 서비스 라벨 | **안 적습니다** | 값이 아니라 답으로 못 받은 것입니다 |
 * | 기관을 사전에서 못 골랐다 | `extracted` | 값은 사실이고 **어느 곳인지가 확인 전**입니다 |
 * | 그 밖 | `confirmed` | |
 */
async function storeAnswer(
  one: {
    readonly caseId: string
    readonly slotKey: string
    readonly tier: ReturnType<typeof tierOf>
    readonly valueType: ReturnType<typeof valueTypeOf>
    /** 매칭에 쓰는 원문 */
    readonly raw: string
    /** 표에 남기는 가린 값 */
    readonly masked: string
  },
  container: Container,
): Promise<AnswerResult> {
  const record = await recordChannel(one.caseId, one.slotKey, one.raw, one.masked, container)

  // ── 표에 없는 경유 서비스 라벨 → **답으로 받지 않습니다** ───────────
  //
  // ⚠️ **2026-08-27 까지 이 자리가 없었습니다.** 「은행 계좌이체」처럼 표와 글자가
  // 다른 값이 오면 `case_channel` 은 비는데 슬롯만 `confirmed` 로 닫혔습니다.
  // 그리고 `channel` 은 T1 이라 그 상태가 **채워진 것으로 세어져**(slot-checker
  // `tierStatus`) 슈퍼셋 플랜조차 안 나갔습니다 — 「모름」을 누른 것보다 나쁩니다.
  //
  // **값을 안 남기는 것이 맞습니다.** 이 슬롯의 문자열을 읽는 코드가 없고
  // (분기는 `case_channel.channel_id` 만 봅니다), 안 적어야 상태가 `empty` 로
  // 남아 슬롯 체커가 **같은 문항을 버튼으로 다시 냅니다.** 버튼은 반드시 표
  // 안의 라벨이라 다음 답에서 확정됩니다 — 되풀이가 구조적으로 안 생깁니다.
  if (record.channelUnrecognized) {
    return {
      slotKey: one.slotKey,
      // 안 적었으므로 **없는 값과 같습니다.** 플랜도 다시 만들지 않습니다
      state: 'empty',
      value: null,
      piiConfirm: null,
      planRegenerated: false,
    }
  }

  // 값은 남깁니다 — 사용자가 그렇게 말한 것은 사실입니다. 다만 **어느 기관인지
  // 정해지지 않았으므로 확인 전**입니다
  const state = record.orgUnresolved ? 'extracted' : 'confirmed'

  await container.slotWrite.write({
    caseId: one.caseId,
    slotKey: one.slotKey,
    tier: one.tier,
    valueType: one.valueType,
    state,
    valueMasked: one.masked,
    source: 'user',
  })

  return {
    slotKey: one.slotKey,
    state,
    value: one.masked,
    piiConfirm: null,
    planRegenerated: true,
  }
}

/** `recordChannel` 이 부르는 쪽에 알려야 하는 것 — **둘 다 거짓인 것이 보통입니다** */
interface ChannelRecord {
  /** 말한 기관을 사전에서 하나로 못 좁혔다. **값은 남기고 되묻습니다** → §11.4.4 ① */
  readonly orgUnresolved: boolean
  /**
   * 경유 서비스 라벨이 표에 없다. **값을 안 남기고 같은 문항을 다시 냅니다.**
   *
   * `org` 와 다르게 다루는 이유는 남길 값이 없기 때문입니다 — 분기가 보는 것은
   * `case_channel.channel_id` 하나뿐이라, 알아보지 못한 라벨은 슬롯에 적어도
   * 아무도 안 읽는 죽은 값이면서 **T1 을 채워진 것으로 세게** 만듭니다
   */
  readonly channelUnrecognized: boolean
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
): Promise<ChannelRecord> {
  // **못 알아본 것만 참입니다.** 유형을 아직 모르거나 이 답이 기관이 아니거나
  // 여기서 터진 경우는 전부 거짓입니다 — 되물어도 사용자가 고를 것이 없습니다
  const resolved: ChannelRecord = { orgUnresolved: false, channelUnrecognized: false }
  const unresolved: ChannelRecord = { orgUnresolved: true, channelUnrecognized: false }
  const unrecognized: ChannelRecord = { orgUnresolved: false, channelUnrecognized: true }

  try {
    if (slotKey === 'channel') {
      // 화면이 보내는 것은 사람이 읽는 라벨입니다. **표 밖의 값을 만들지
      // 않습니다** — 표에 없으면 답으로 못 받은 것으로 둡니다 (questions.ts)
      const channelId = channelForOption(raw) ?? channelForOption(masked)
      if (!channelId) return unrecognized
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
