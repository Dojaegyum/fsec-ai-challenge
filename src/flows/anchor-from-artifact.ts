/**
 * 부산물이 기산점을 남긴다 — **기한이 실제로 서게 하는 마지막 한 칸.**
 *
 * 정본: spec/backend/08-14-completion-hook.md ①(증거 연쇄) ·
 *       spec/common/08-16-deadline-rules.md(기산점은 부산물) ·
 *       spec/backend/08-16-data-model.md §5.1(슬롯) · §8(기한)
 * 근거: CLAUDE.md 불변 규칙 6(완료는 부산물로) · 7(기한은 규칙으로)
 *
 * ## 이 파일이 없어서 기한이 하나도 안 섰습니다
 *
 * 2026-08-27 에 사슬 전체를 걸어 보고 드러났습니다. 단계는 순서대로 열리는데
 * **`GET …/deadlines` 가 언제나 빈 배열**이었습니다.
 *
 * KB 전체에서 기산점으로 쓰이는 슬롯은 **둘뿐**이었습니다(2026-08-27).
 *
 *     relief_applied_at   -> 3영업일 (신청서류 제출)
 *     notice_started_at   -> 2개월  (채권소멸공고 · 통장묶기 이의제기 창도 같은 기산점)
 *
 * 그런데 **둘 다 아무도 안 채웠습니다.** `compute-deadlines.ts` 가
 * *「기산점이 없으면 기한도 없습니다」* 로 올바르게 동작한 결과,
 * 이 서비스가 약속한 기한 관리가 **모든 경로에서 한 줄도 안 나갔습니다.**
 *
 * ## 왜 「오늘」을 써도 되나 — 스키마가 이미 정한 것입니다
 *
 * `case_slot.source` 가 `auto | user | system` 이고, `compute-deadlines.ts` 의
 * `anchorOf` 가 *「증거에서 뽑았거나(auto) **부산물이 채운(system)** 값만
 * 확정입니다」* 라고 적어 뒀습니다. **부산물이 채우면 확정**이라는 결정이
 * 이미 스키마와 코드에 들어 있고, 이 파일은 그 자리를 실제로 채웁니다.
 *
 * 그리고 명세 ③(통화 동반 모드)이 *「종료 직후 → 접수번호를 지금 받아적으세요」*
 * 로 **기록 시각과 행위 시각을 붙여 두는** 설계라, 그 전제 위에 섭니다.
 *
 * ⬜ **그 전제가 깨지는 경우가 있습니다** — 월요일에 신청하고 수요일에 적으면
 * 기산점이 이틀 늦습니다. 3영업일이 걸린 기한이라 **하루가 틀리면 권리가
 * 사라집니다.** 「언제 신청하셨나요」를 한 번 묻고 사용자가 고친 값은
 * `source: 'user'` 로 두는 것이 더 정확한데, 그건 문진 흐름을 늘리는
 * 제품 결정이라 여기서 정하지 않았습니다 → 사람 판단.
 *
 * ## 표를 코드에 둔 이유
 *
 * 「어느 단계가 어느 기산점을 남기나」는 **명세 ① 의 표**입니다.
 *
 * > | 피해구제 신청 (앱·비대면) | 접수증 | **환급 타임라인의 기산점** |
 *
 * KB 항목에 `establishes_slot` 같은 칸을 두는 편이 더 깨끗하지만, 그건
 * 적재 검증(§11.4.5)과 계약을 함께 고쳐야 하는 일이라 **지금은 코드에 두고
 * 출처를 적어 둡니다.** 값이 둘뿐이고 근거가 명세 한 줄이라 드리프트가
 * 나면 바로 보입니다.
 */

import 'server-only'

import { seoulDay } from '@/lib/clock'
import type { Container } from '@/lib/container'

import { tierOf, valueTypeOf } from '@/modules/slot-checker'

/**
 * 끝나면 기산점을 남기는 단계 → 05-completion-hook.md ①.
 *
 * **`notice_started_at` 은 여기 없습니다.** 채권소멸공고의 기산일은 우리가
 * 아는 시각이 아니라 **통지문에 적힌 날**이라, 업로드한 통지문에서 옵니다
 * → [ADR-054](../../decisions/054-notice-anchor.md). 그것을 여기서 「오늘」로
 * 채우면 2개월 공고가 통째로 틀립니다.
 */
const ANCHOR_BY_STEP: Readonly<Record<string, string>> = {
  'relief-apply': 'relief_applied_at',
  // 통장묶기 — 이의제기 접수증이 검증되면 그날이 제출 시각입니다 (frozen-account.json ·
  // ADR-066). 5영업일 결과 통보는 이 슬롯을 기산점으로 삼게 되어 있는데(§5.1 ·
  // research/01 §2.4), 그 기한 자체는 금감원 원문·시행일이 확인될 때까지 KB 본문에만 있습니다
  'objection-file': 'objection_submitted_at',
}

/**
 * 검증된 부산물이 들어온 단계가 기산점을 남기면 그 슬롯을 채운다.
 *
 * **이미 채워져 있으면 덮지 않습니다.** 사용자가 같은 단계에 부산물을 두 번
 * 내면(재시도·다시 누르기) 기산점이 뒤로 밀립니다 — 그러면 기한이 저절로
 * 늘어나서, 놓친 기한이 안 놓친 것처럼 보입니다.
 *
 * @returns 채운 슬롯 이름. 채울 것이 없었으면 `null`
 */
export async function anchorFromArtifact(input: {
  readonly caseId: string
  readonly stepKey: string
  readonly container: Container
}): Promise<string | null> {
  const slotKey = ANCHOR_BY_STEP[input.stepKey]
  if (!slotKey) return null

  const already = await input.container.slots.read(input.caseId)
  const found = already.find((one) => one.slotKey === slotKey)
  // 「모른다」로 표시된 것은 비어 있는 것과 같아 채웁니다 → 0003 마이그레이션
  if (found && found.state === 'confirmed' && found.valueMasked !== null) return null

  await input.container.slotWrite.write({
    caseId: input.caseId,
    slotKey,
    tier: tierOf(slotKey),
    valueType: valueTypeOf(slotKey),
    state: 'confirmed',
    // 날짜만 씁니다. 시각을 넣으면 `dayOf` 가 시간대 변환을 하게 되고,
    // 그건 하루가 어긋날 여지를 하나 더 만듭니다 → compute-deadlines.ts
    valueMasked: seoulDay(new Date()),
    // **부산물이 채운 값**입니다 → anchorOf 가 이것만 확정으로 봅니다
    source: 'system',
  })

  return slotKey
}
