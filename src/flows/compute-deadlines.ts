/**
 * 기한을 실제로 만드는 자리 — **KB 가 적어 둔 규칙 + 기산점 = 날짜.**
 *
 * 정본: spec/common/08-16-deadline-rules.md · spec/backend/08-16-data-model.md §8 §11.4.2 ·
 *       spec/common/08-14-api.md §3.5 §3.7
 * 근거: CLAUDE.md 불변 규칙 1(절차를 창작하지 않는다)·7(기한은 규칙으로 센다) ·
 *       ADR-028(라우트는 얇게, 모듈이 두껍게)
 *
 * ## 여기까지가 「규칙」입니다
 *
 * 값(3영업일·14일)은 KB 가, 셈(초일 불산입·영업일·말일 이월)은 `date-checker` 가
 * 합니다. **이 파일은 둘을 잇기만 합니다** — 날짜 산술을 여기 쓰지 마세요.
 *
 * ## 기산점이 없으면 기한도 없습니다
 *
 * 「3영업일」은 **무엇으로부터** 3영업일인지가 정해져야 날짜가 됩니다.
 * 기산 슬롯이 안 채워졌으면 **줄을 만들지 않습니다** — 오늘을 기산점으로
 * 삼아 그럴듯한 날짜를 내면, 사용자는 우리가 지어낸 날짜를 법정 기한으로
 * 믿습니다. 없는 것을 없다고 두는 편이 낫습니다 → 불변 규칙 5.
 *
 * ## 부산물에서 온 값과 사용자가 말한 값을 가릅니다
 *
 * 기한 규칙이 「기산점은 부산물」이라고 못 박았습니다. 사용자가 기억으로 댄
 * 날짜도 받되 **추정으로 표시**합니다(`estimated`) — 확정 기한처럼 보이면
 * 사용자가 틀린 날짜를 믿고 권리를 잃습니다.
 */

import 'server-only'

import { seoulDay } from '@/lib/clock'
import type { Container } from '@/lib/container'
import type { DeadlineChange, DeadlineWrite } from '@/lib/db'
import { newUlid } from '@/lib/ids'

import type { DateChecker, DeadlineKind, PeriodKind } from '@/modules/date-checker'

import type { StoredStep } from './regenerate-plan'

/** 기산점이 될 수 있는 슬롯 한 줄 → 09-data-model.md §5 */
export interface AnchorSlot {
  readonly slotKey: string
  readonly state: string
  /** `auto`(증거에서 뽑음) · `user`(사용자가 말함) · `system`(부산물이 채움) */
  readonly source: string | null
  readonly valueMasked: string | null
}

/** 기산점이 될 수 있는 부산물 한 줄 → 09-data-model.md §7 */
export interface AnchorArtifact {
  readonly kind: string
  readonly verifyResult: string
  /** ISO 8601 */
  readonly createdAt: string
}

/**
 * KB 가 적어 둔 기한 규칙 → §11.4 `deadline`.
 *
 * **여기 있는 값을 코드로 옮기지 마세요.** 제도가 바뀝니다 — 이 인터페이스는
 * 「KB 가 이런 모양으로 준다」는 약속일 뿐이고, 숫자는 전부 KB 에 있습니다.
 */
interface KbDeadline {
  readonly kind?: unknown
  readonly amount?: unknown
  readonly from?: unknown
  readonly owner?: unknown
  readonly grace?: unknown
  readonly on_miss?: unknown
  readonly note?: unknown
  /** 유예에만 붙습니다 — **어떤 조건에서** 주어지나 → §8.1 */
  readonly condition?: unknown
}

/** `date-checker` 가 아는 두 단위 → 08-16-deadline-rules.md */
const PERIODS: ReadonlySet<string> = new Set([
  'business_days',
  'calendar_days',
  // 채권소멸공고 2개월 — 민법 제160조 「역에 의한 계산」 → date-checker/compute.ts
  'months',
])

/**
 * 기한의 주인이 종류를 정합니다 → §11.4.2.
 *
 * **`bank`·`agency` 를 `primary` 로 내면 안내가 틀립니다.** 통장묶기 5영업일을
 * 사용자 기한으로 오인시키면 불필요한 불안을 줍니다 → §8.3.
 */
const KIND_OF_OWNER: Readonly<Record<string, DeadlineKind>> = {
  user: 'primary',
  bank: 'info',
  agency: 'info',
}

/** 그날 시작. §3.7 의 `starts_at` 표기 */
const START_OF_DAY_KST = 'T00:00:00+09:00'

/**
 * 한 사건의 기한을 지금 아는 것에 맞춰 다시 만든다.
 *
 * 부르는 자리가 셋입니다 — **플랜이 바뀔 때**(단계가 생기거나 빠짐),
 * **슬롯이 채워질 때**(기산점이 생김), **부산물이 들어올 때**(기산점이
 * 확정됨). 셋 다 같은 코드를 지나야 결과가 안 갈립니다.
 *
 * @returns 날짜가 옮겨졌거나 새로 생긴 기한 → §3.5 `changed_deadlines`
 */
export async function computeDeadlines(
  input: {
    readonly caseId: string
    readonly steps: readonly StoredStep[]
    readonly kbVersion: string
  },
  container: Container,
): Promise<readonly DeadlineChange[]> {
  const slots = await container.slots.read(input.caseId)

  const rows = planDeadlines({
    steps: input.steps,
    slots,
    kbVersion: input.kbVersion,
    dates: container.dateChecker,
  })

  return container.deadlineWrite.apply(input.caseId, rows)
}

/**
 * 단계와 슬롯에서 적을 기한 줄을 뽑는다. **순수 함수입니다** — DB 도 시계도
 * 안 봅니다(오늘은 `date-checker` 가 밖에서 받습니다).
 *
 * 근거가 모자란 단계는 **조용히 건너뜁니다.** 던지지 않는 이유는 기한 하나가
 * 안 서는 것이 사건 전체를 멈출 이유가 아니기 때문입니다 — 다른 절차는 그대로
 * 나가야 합니다 → 불변 규칙 5.
 */
export function planDeadlines(input: {
  readonly steps: readonly StoredStep[]
  readonly slots: readonly AnchorSlot[]
  readonly kbVersion: string
  readonly dates: DateChecker
}): readonly DeadlineWrite[] {
  const { steps, slots, kbVersion, dates } = input
  const out: DeadlineWrite[] = []

  for (const step of steps) {
    const rule = step.body.deadline as KbDeadline | null | undefined
    if (!rule || typeof rule !== 'object') continue

    const owner = typeof rule.owner === 'string' ? rule.owner : ''
    const kind = KIND_OF_OWNER[owner]
    // 주인을 모르면 사용자 기한인지 아닌지를 못 정합니다 → §11.4.2.
    // 적재기가 막지만(kb-load), 옛 릴리스가 표에 남아 있을 수 있습니다
    if (!kind) continue

    const period = periodOf(rule.kind, rule.amount)
    if (!period) continue

    const anchor = resolveAnchor(rule.from, slots, step.artifacts, dates)
    // **기산점이 없으면 날짜가 없습니다.** 지어내지 않습니다
    if (!anchor) continue

    const primary = dates.compute({ anchor, rule: period, kind })

    const basis = {
      kb_entry_id: step.kbEntryId,
      kb_version: step.kbVersion,
      rule,
      legal_basis: step.legalBasis,
      source_url: step.sourceUrl,
      effective_from: step.effectiveFrom,
    }

    out.push({
      deadlineId: newUlid(),
      planStepId: step.planStepId,
      kind,
      dueAt: primary.dueAt,
      computedFrom: anchor.source,
      kbVersion,
      ruleSnapshot: {
        ...basis,
        holidays_used: primary.holidaysUsed,
        // 부산물로 확인되지 않았으면 추정입니다 → 08-16-deadline-rules.md.
        // **확정 기한처럼 보이면 안 됩니다**
        estimated: primary.estimated,
        ...(typeof rule.on_miss === 'string' ? { on_miss: rule.on_miss } : {}),
        ...(typeof rule.note === 'string' ? { note: rule.note } : {}),
        // `kind: "info"` 의 달력 앵커 왼쪽 끝 → ADR-048.
        // 사용자 기한은 D-day 로 충분해 안 답니다
        ...(kind === 'info' ? { starts_at: `${anchor.date}${START_OF_DAY_KST}` } : {}),
      },
    })

    // ── 유예 → §8.1 ──────────────────────────────────────────────────
    //
    // **본 기한과 합치지 않습니다.** 본 기한만 알리면 사용자가 이미 늦었다고
    // 포기하고, 유예만 알리면 본 기한을 넘겨도 되는 것으로 오해합니다.
    //
    // 기산점이 본 기한의 만기입니다 — 「3영업일을 넘기면 그때부터 14일」이라
    // 원래 기산점에서 다시 세면 두 기간이 겹칩니다.
    const grace = rule.grace as KbDeadline | null | undefined
    if (kind !== 'primary' || !grace || typeof grace !== 'object') continue

    const gracePeriod = periodOf(grace.kind, grace.amount)
    if (!gracePeriod) continue

    const graceDue = dates.compute({
      anchor: { source: anchor.source, date: primary.dueDate, confirmed: anchor.confirmed },
      rule: gracePeriod,
      kind: 'grace',
    })

    out.push({
      deadlineId: newUlid(),
      planStepId: step.planStepId,
      kind: 'grace',
      dueAt: graceDue.dueAt,
      // **본 기한과 같은 기산점을 적습니다.** 사용자에게 「무엇으로부터인가」는
      // 결국 하나이고, 중간값은 아래 `grace_from` 이 남깁니다
      computedFrom: anchor.source,
      kbVersion,
      ruleSnapshot: {
        ...basis,
        rule: grace,
        grace_from: primary.dueDate,
        holidays_used: graceDue.holidaysUsed,
        estimated: graceDue.estimated,
        // 유예가 **어떤 조건에서** 주어지나 — 없으면 사용자가 추가 기간을
        // 본 기한으로 착각합니다 (§8.1)
        ...(typeof grace.condition === 'string' ? { condition: grace.condition } : {}),
        ...(typeof rule.on_miss === 'string' ? { on_miss: rule.on_miss } : {}),
      },
    })
  }

  return out
}

/** KB 의 `{kind, amount}` 를 `date-checker` 가 받는 모양으로. 못 읽으면 `null` */
function periodOf(
  kind: unknown,
  amount: unknown,
): { readonly kind: PeriodKind; readonly amount: number } | null {
  if (typeof kind !== 'string' || !PERIODS.has(kind)) return null
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) return null
  return { kind: kind as PeriodKind, amount }
}

/**
 * 기산점을 찾는다 → §11.4 *"`deadline.from` 은 §5.1 슬롯 이름 또는 `artifact:{kind}`"*.
 *
 * 못 찾으면 `null` 이고, 그러면 **그 기한은 안 만들어집니다.**
 */
/**
 * 파생 기산점 → ADR-073. 법이 「채권이 소멸된 날부터」처럼 **다른 기한이 찬 날**을 기산점으로
 * 쓸 때가 있습니다. 그 날은 슬롯도 부산물도 아니라 규칙으로만 나옵니다 —
 *
 *     debt_extinct_at = notice_started_at + 2개월   (법 제9조제1항 · 채권 소멸일)
 *
 * 같은 `date-checker` 로 셉니다 — 달 셈이 두 곳에 있으면 어긋납니다. 밑동이 추정이면 파생도 추정입니다.
 * 정본은 09-data-model.md §11.4.2 의 `deadline.from` 목록이고, `kb-load.ts` 가 같은 이름을 받습니다.
 */
const DERIVED: Readonly<
  Record<string, { readonly base: string; readonly rule: { kind: PeriodKind; amount: number } }>
> = {
  debt_extinct_at: { base: 'notice_started_at', rule: { kind: 'months', amount: 2 } },
}

function resolveAnchor(
  from: unknown,
  slots: readonly AnchorSlot[],
  artifacts: readonly AnchorArtifact[],
  dates: DateChecker,
): { readonly source: string; readonly date: string; readonly confirmed: boolean } | null {
  const derived = typeof from === 'string' ? DERIVED[from] : undefined
  if (!derived) return anchorOf(from, slots, artifacts)
  const base = anchorOf(derived.base, slots, artifacts)
  if (!base) return null
  const at = dates.compute({ anchor: base, rule: derived.rule, kind: 'info' })
  return { source: from as string, date: at.dueDate, confirmed: base.confirmed }
}

function anchorOf(
  from: unknown,
  slots: readonly AnchorSlot[],
  artifacts: readonly AnchorArtifact[],
): { readonly source: string; readonly date: string; readonly confirmed: boolean } | null {
  if (typeof from !== 'string' || from.length === 0) return null

  if (from.startsWith('artifact:')) {
    const kind = from.slice('artifact:'.length)
    // **검증을 통과한 것만 기산점입니다** → 05-completion-hook.md.
    // L3 자기신고(`not_applicable`)는 「했다」의 근거가 아닙니다.
    //
    // ⚠️ **값은 `passed` 입니다** — 09-data-model.md §7 의
    // `CHECK (verify_result IN ('passed','failed','not_applicable'))` 이 정본이고,
    // `completion-checker` 도 `artifact` 표도 그 셋만 씁니다.
    //
    // 2026-08-27 까지 여기가 `'verified'` 를 찾았습니다. 표에 없는 값이라
    // **`artifact:{kind}` 를 기산점으로 삼는 기한이 영영 안 생겼습니다** —
    // 부산물을 제대로 냈는데도 날짜가 안 서고, 사용자는 자기가 늦은 줄도 모릅니다
    const one = artifacts.find((a) => a.kind === kind && a.verifyResult === 'passed')
    if (!one) return null
    const date = dayOf(one.createdAt)
    // 부산물이 남긴 시각이라 **확정**입니다 — 기한 규칙이 말하는 그 기산점입니다
    return date ? { source: from, date, confirmed: true } : null
  }

  const slot = slots.find((one) => one.slotKey === from)
  // `pii_pending`·`extracted` 는 확인 전이라 **없는 값과 같습니다** → 0003 마이그레이션.
  // `unknown` 은 「모른다」이지 날짜가 아닙니다
  if (!slot || slot.state !== 'confirmed' || slot.valueMasked === null) return null

  const date = dayOf(slot.valueMasked)
  if (!date) return null

  // 사용자가 기억으로 댄 날짜는 **추정**입니다 → 08-16-deadline-rules.md
  // 「기산점은 부산물」. 증거에서 뽑았거나(auto) 부산물이 채운(system) 값만 확정입니다
  return {
    source: from,
    date,
    confirmed: slot.source === 'auto' || slot.source === 'system',
  }
}

/**
 * 값에서 `YYYY-MM-DD`(Asia/Seoul)를 뽑는다. **못 읽으면 `null`** 입니다.
 *
 * 슬롯 값은 사용자가 타이핑한 글일 수 있습니다(「어제」·「지난주쯤」).
 * **그런 것을 날짜로 밀어 넣지 않습니다** — 하루가 틀리면 권리가 사라집니다.
 */
function dayOf(value: string): string | null {
  const trimmed = value.trim()

  // 날짜만 온 경우. `Date` 로 다시 읽지 않습니다 — `2026-08-20` 은 UTC 자정으로
  // 해석돼 한국 시각으로는 같은 날이지만, 규칙을 시간대에 기대지 않습니다
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed

  // 시각이 붙은 경우만 시간대 변환이 필요합니다
  if (/^\d{4}-\d{2}-\d{2}[T ]/.test(trimmed)) {
    const at = new Date(trimmed)
    return Number.isNaN(at.getTime()) ? null : seoulDay(at)
  }

  return null
}
