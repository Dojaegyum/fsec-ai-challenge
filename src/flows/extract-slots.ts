/**
 * 가려진 글에서 뽑을 수 있는 값을 뽑아 `extracted` 로 둔다 → ADR-069 · ADR-087.
 *
 * 정본: spec/backend/08-14-slot-tiering.md · spec/backend/08-16-data-model.md §5.1
 *
 * ## 부르는 자리가 둘입니다
 *
 * | 부르는 곳 | `sourceLabel` | `sourceRef` |
 * | --- | --- | --- |
 * | `read-evidence.ts` — 자료를 다 읽은 뒤 | `자료 종류: 통화 녹음을 …` | `evidence_id` |
 * | `chat-turn.ts` — 턴을 남긴 뒤(응답 뒤에 미룸) | `사용자 진술` | `message_id` |
 *
 * 둘이 **같은 추출기·같은 그물·같은 되묻기**를 지납니다. 2026-09-06 까지는 자료 쪽만
 * 있어서, 첫 진술에 「국민은행 [계좌-1] 로 300만원을 보냈습니다」라고 적어도 금액은
 * 「모름」으로 남았습니다 → ADR-087.
 *
 * ## ⚠️ 가려진 글만 받습니다
 *
 * `text` 는 **이미 토큰화된 것**이어야 합니다 — 전사문의 `masked.lines` 이거나 챗의
 * `utteranceMasked` 입니다. 원문을 넘기면 이 함수가 그대로 외부 모델에 보냅니다
 * ([불변 규칙 2](../../CLAUDE.md)).
 *
 * ## 무엇을 받고 무엇을 버리나
 *
 * | | |
 * | --- | --- |
 * | 받는 이름 | `CONFIRMABLE_KEYS` 여덟 — 금액·시각·상대 계좌·사칭 기관·연락 수단 · 본인 계좌·본인 이름(ADR-070 · 토큰일 때만) · 통지문의 공고일(ADR-071) |
 * | `org_name` | 안 받습니다. `repairOrgs` 가 사전 대조로 따로 둡니다(ADR-056) — 사전 밖 이름이 들어오면 안 됩니다 |
 * | `transferred`·`channel` | 안 받습니다. T1 은 분기를 정하는 값이라 사람의 답으로만 — `channel` 은 `case_channel` 을 함께 적어야 해서 슬롯만 채우면 오히려 갈래가 빗나갑니다 |
 * | 확신도 | `CONFIDENCE_MIN` 미만은 버립니다 — 08-14-slot-tiering.md 의 「임계값 미정」을 여기서 정했습니다 |
 * | 모양 | `lib/extracted-value.ts` 가 못 다듬으면 버립니다 — 「어제」·「삼천만 원쯤」은 사람에게 묻습니다 |
 * | 이미 확정된 슬롯 | 덮지 않습니다 — `repairOrgs` 와 같은 그물. `unknown`(모름)은 채웁니다. **모델을 부른 뒤 한 번 더 읽어** 그 사이에 도착한 「맞아요」도 지킵니다 |
 *
 * ## 실패해도 진행한다
 *
 * 모델이 안 뜨거나 헛소리를 해도 **뽑기만 건너뜁니다.** 부르는 쪽이 하던 일(전사 저장 ·
 * 챗 응답)은 그대로 끝나고, 그 슬롯은 문진이 묻습니다 — *"자동 추출 실패는 정상
 * 경로입니다"* ([불변 규칙 5](../../CLAUDE.md)).
 */

import 'server-only'

import type { Container } from '@/lib/container'
import { normalizeExtracted } from '@/lib/extracted-value'

import { CONFIRMABLE_KEYS } from '@/modules/slot-checker'
import { createSlotExtractor } from '@/modules/slot-extractor'

/** 모델이 스스로 자신 없다고 한 값은 안 되묻습니다 → ADR-069 ③ */
const CONFIDENCE_MIN = 0.7

/**
 * 되묻는 여덟 — `slot-checker` 와 `slot-extractor` 의 `SlotKey` 가 서로 다른 별칭이라
 * (체커에는 `notice_started_at` 이 더 있습니다) 둘 다에 들어가는 글자 합집합으로 좁힙니다
 */
type ConfirmableKey =
  | 'amount'
  | 'occurred_at'
  | 'counterpart_account'
  | 'impersonated_org'
  | 'contact_method'
  | 'victim_account'
  | 'victim_name'
  | 'notice_started_at'

function isConfirmable(key: string): key is ConfirmableKey {
  return (CONFIRMABLE_KEYS as readonly string[]).includes(key)
}

export async function extractSlotsFrom(
  input: {
    readonly caseId: string
    /** 슬롯의 `source_ref` 에 그대로 적힙니다 — `evidence_id` 또는 `message_id` */
    readonly sourceRef: string
    /** 프롬프트 첫 줄. 「받는 계좌」가 상대 계좌라는 것은 이체 내역 캡처일 때의 뜻입니다 */
    readonly sourceLabel: string
    /** **가려진 글.** 원문을 넘기지 마세요 */
    readonly text: string
  },
  container: Container,
): Promise<void> {
  try {
    // 되묻기에 「네」 한 마디로 답한 턴에까지 모델을 부르지 않습니다
    if (input.text.trim().length === 0) return

    // 부르기 **전**의 그물 — 추출기에 「이건 이미 안다」고 알려 주는 데만 씁니다
    const known = await confirmedKeys(input.caseId, container)

    const extractor = createSlotExtractor({
      llm: { complete: (prompt) => container.ports.llm.completeText(prompt) },
    })
    const result = await extractor.extract({
      maskedText: `${input.sourceLabel}\n${input.text}`,
      evidenceId: input.sourceRef,
      known: [...known].filter(isConfirmable),
    })

    // ⚠️ **적기 직전에 한 번 더 읽습니다.** 위 그물은 모델을 부르기 전의 것이라
    // 몇 초 낡았습니다 — 그 사이에 사용자의 「맞아요」가 도착할 수 있습니다.
    //
    // 챗 경로에서 실제로 겹치는 자리입니다(ADR-087): 같은 응답이 그 슬롯의 확인 문항을
    // 싣고 나가고, 사용자가 누른 §3.5 `PATCH /slots` 가 이 미룬 쓰기보다 먼저 도착합니다.
    // 쓰기는 `state = EXCLUDED.state` 로 덮으므로(`lib/db.ts`), 낡은 그물로 적으면
    // **방금 확정한 값을 다른 값의 `extracted` 로 되돌립니다.**
    const confirmed = await confirmedKeys(input.caseId, container)

    for (const one of result.slots) {
      if (!isConfirmable(one.slotKey)) continue
      if (one.confidence < CONFIDENCE_MIN) continue
      if (confirmed.has(one.slotKey)) continue
      const value = normalizeExtracted(one.slotKey, one.valueMasked, input.text)
      if (value === null) continue

      await container.slotWrite.write({
        caseId: input.caseId,
        slotKey: one.slotKey,
        tier: 'T2',
        valueType: one.valueType,
        // **확인 전입니다.** 슬롯 체커가 「이 값이 맞나요」로 되묻고, 「맞아요」면 `confirmed`
        state: 'extracted',
        valueMasked: value,
        source: 'auto',
        sourceRef: input.sourceRef,
        confidence: one.confidence,
      })
    }
  } catch (error) {
    // 여기서 던지면 부르는 쪽이 하던 일을 통째로 잃습니다 — 자료 쪽은 **전사 결과**를,
    // 챗 쪽은 이미 사용자에게 나간 응답 뒤의 흐름을. `repairOrgs` 와 같은 이유로 삼킵니다.
    //
    // **삼키되 조용히는 아닙니다.** 응답 뒤(`after()`)에 도는 일이라 실패해도 사용자에게
    // 보이는 자리가 없어, 한 줄도 안 남기면 「원래 안 뽑히는 것」과 구분이 안 됩니다.
    // **값도 이름도 적지 않습니다** — 남기는 것은 어느 자료·발화였나와 예외의 종류뿐입니다
    // (불변 규칙 2·3 · 09-data-model.md §10.1)
    console.warn('[extract-slots] 추출 실패', {
      sourceRef: input.sourceRef,
      error: error instanceof Error ? error.name : 'unknown',
    })
  }
}

/** 지금 `confirmed` 인 슬롯 이름들. **덮지 않을 것의 그물**입니다 */
async function confirmedKeys(caseId: string, container: Container): Promise<Set<string>> {
  const already = await container.slots.read(caseId)
  return new Set(already.filter((one) => one.state === 'confirmed').map((one) => one.slotKey))
}
