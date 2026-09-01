/**
 * 사건의 플랜을 읽고 쓰는 자리 → `flows/regenerate-plan.ts` 의 `CasePlanStore`.
 *
 * 정본: spec/backend/08-16-data-model.md §2·§4·§5·§6·§6.1
 * 근거: ADR-046(사건과 플랜은 함께 저장) · ADR-047(단계 하나의 모양) ·
 *       ADR-028(자원 접근 구현은 `src/lib/`)
 *
 * `db.ts` 와 나눈 이유는 **이쪽이 흐름의 요구이기 때문**입니다. `db.ts` 의
 * 것들은 모듈이 선언한 포트인데, 이것은 `flows/` 가 선언했습니다.
 *
 * ## 지우고 다시 넣지 않습니다 → §6.1
 *
 * 플랜을 다시 만들 때 통째로 지우면 **사용자가 이미 끝낸 단계의 완료 표시와
 * 거기 딸린 부산물이 함께 사라집니다.** 그래서 셋으로 나눠 다룹니다 —
 * `upsert` 는 내용을 바꾸고, `preserved` 는 내용을 두고 순서만 갱신하며,
 * `skipped` 는 상태만 바꿉니다.
 */

import 'server-only'

import { foldChannels } from './channels'
import { seoulIso } from './clock'
import type { Sql } from './db'

import type { OpenedCase, Track } from '@/modules/case-intake'
import type { PlanResult } from '@/modules/planner'
import type { SlotKey, SlotState, SlotTier } from '@/modules/slot-checker'

import type {
  CasePlanStore,
  RequiredArtifact,
  StoredArtifact,
  StoredSlot,
  StoredStep,
} from '@/flows/regenerate-plan'

/** `plan_step` 한 줄이 읽혀 오는 모양 */
interface StepRow {
  plan_step_id: string
  step_key: string
  seq: number
  title: string
  actor: string
  conditional: string | null
  state: string
  body: unknown
  kb_entry_id: string
  kb_version: string
  source_url: string
  effective_from: string | Date
  /**
   * `TIMESTAMPTZ(3)` 이라 드라이버가 `Date` 로 줍니다 — `artifact.created_at`
   * 과 같습니다. `effective_from` 이 `string | Date` 인 것은 그쪽이 `DATE` 라서고,
   * 이 칸은 시각이라 갈리지 않습니다
   */
  generated_at: Date
}

const day = (value: string | Date): string =>
  typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10)

/**
 * `NUMERIC` 을 숫자로 → 계약 §3.6 의 `amount`·`confidence` 는 숫자입니다.
 *
 * **드라이버는 문자열로 줍니다.** `NUMERIC` 은 자바스크립트 `number` 보다 넓어
 * 그대로 바꾸면 정밀도를 잃을 수 있어서입니다. 여기 두 칸은 원 단위 금액과
 * 0.00~1.00 이라 안전한 범위이고, **문자열로 내보내면 화면이 `"3000000"` 을
 * 받아 계산에 쓰지 못합니다.**
 */
const numeric = (value: string | number | null): number | null => {
  if (value === null) return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function createCasePlanStore(sql: Sql, newId: () => string): CasePlanStore {
  /**
   * 단계에 근거와 부산물을 붙여 돌려준다.
   *
   * **`legal_basis` 는 `plan_step` 에 없습니다** — KB 항목에 있습니다. 단계를
   * 저장할 때 복사하지 않는 이유는, KB 가 개정되면 저장된 사본이 낡기 때문입니다.
   * 읽을 때마다 원본에서 가져옵니다 → ADR-047.
   */
  async function dressSteps(
    caseId: string,
    rows: readonly StepRow[],
  ): Promise<readonly StoredStep[]> {
    if (rows.length === 0) return []

    const ids = rows.map((one) => one.kb_entry_id)
    const versions = rows.map((one) => one.kb_version)
    const bases = await sql<{ kb_entry_id: string; kb_version: string; legal_basis: string }[]>`
      SELECT kb_entry_id, kb_version, legal_basis FROM kb_entry
      WHERE kb_entry_id = ANY(${ids}) AND kb_version = ANY(${versions})
    `
    const basisOf = new Map(bases.map((one) => [`${one.kb_entry_id}@${one.kb_version}`, one.legal_basis]))

    const stepIds = rows.map((one) => one.plan_step_id)
    const artifacts = await sql<
      {
        plan_step_id: string
        artifact_id: string
        kind: string
        verify_level: string
        verify_result: string
        created_at: Date
      }[]
    >`
      SELECT plan_step_id, artifact_id, kind, verify_level, verify_result, created_at
      FROM artifact WHERE case_id = ${caseId} AND plan_step_id = ANY(${stepIds})
      ORDER BY created_at
    `
    const byStep = new Map<string, StoredArtifact[]>()
    for (const one of artifacts) {
      const list = byStep.get(one.plan_step_id) ?? []
      list.push({
        artifactId: one.artifact_id,
        kind: one.kind,
        verifyLevel: one.verify_level,
        verifyResult: one.verify_result,
        // **기한의 기산점이 될 수 있습니다** → 08-16-deadline-rules.md
        // 「기산점은 부산물」. `deadline.from` 이 `artifact:{kind}` 일 때 씁니다
        createdAt: seoulIso(one.created_at),
      })
      byStep.set(one.plan_step_id, list)
    }

    return rows.map((one) => {
      const body = (one.body ?? {}) as Record<string, unknown>
      // 필요한 부산물은 KB 가 단계 본문에 적어 둡니다 → 08-14-completion-hook.md
      const required = body.required_artifact as RequiredArtifact | undefined

      return {
        planStepId: one.plan_step_id,
        stepKey: one.step_key,
        seq: one.seq,
        title: one.title,
        actor: one.actor as StoredStep['actor'],
        conditional: one.conditional,
        state: one.state as StoredStep['state'],
        body,
        kbEntryId: one.kb_entry_id,
        kbVersion: one.kb_version,
        // 못 찾으면 빈 문자열이 아니라 **멈춰야 할 일**이지만, 그 판단은
        // 흐름의 몫입니다 — 근거 검사는 `regenerate-plan` 이 합니다
        legalBasis: basisOf.get(`${one.kb_entry_id}@${one.kb_version}`) ?? '',
        sourceUrl: one.source_url,
        effectiveFrom: day(one.effective_from),
        // **아래 INSERT 가 적은 값을 그대로 되읽습니다** → 계약 §3.6 `generated_at`.
        // 여기서 지금 시각을 만들면 화면이 아무 일도 없었는데 매번
        // 「방금 갱신됨」이 됩니다 — 이 값은 플랜을 *만든* 때이지 *읽은* 때가 아닙니다
        generatedAt: seoulIso(one.generated_at),
        artifacts: byStep.get(one.plan_step_id) ?? [],
        requiredArtifact: required ?? null,
      }
    })
  }

  async function readSteps(caseId: string): Promise<readonly StoredStep[]> {
    const rows = await sql<StepRow[]>`
      SELECT plan_step_id, step_key, seq, title, actor, conditional, state,
             body, kb_entry_id, kb_version, source_url, effective_from,
             generated_at
      FROM plan_step WHERE case_id = ${caseId} ORDER BY seq
    `
    return dressSteps(caseId, rows)
  }

  /**
   * 병합 결과를 한 트랜잭션 안에서 반영한다.
   *
   * **트랜잭션이어야 하는 이유** — 중간에 끊기면 순서가 어긋난 플랜이 남고,
   * 그건 사용자에게 「2번 다음에 2번」으로 보입니다.
   */
  async function apply(caseId: string, result: PlanResult, tx: Sql): Promise<void> {
    for (const step of result.upsert) {
      // 같은 단계가 이미 있으면 **내용을 갈아끼우되 완료 시각은 둡니다** —
      // 사용자가 끝낸 것을 플랜 재생성이 되돌리면 안 됩니다 → §6.1
      //
      // ## `skipped` 만은 되돌립니다
      //
      // 「새 플랜에 없는 단계」를 지우지 않고 `skipped` 로 두는 이유가 **조건이
      // 다시 맞으면 되살아나야 하기 때문**인데, 되살리는 자리가 없었습니다.
      //
      // 대면편취에서 실제로 그랬습니다. 사건을 열 때는 공통 「지급정지를
      // 요청합니다」가 서고(선행 없음), 경유 서비스가 정해지면 그 유형의
      // 것으로 바뀌는데 그쪽은 `after: [report-112]` 라 112 를 끝내기 전에는
      // 활성이 아닙니다 → 그 재생성에서 `skipped` 가 됩니다. 112 를 끝내면
      // 내용은 제대로 바뀌는데(`actor: police`) **상태가 `skipped` 에 남아
      // 보드가 「해당 없음」으로 그렸습니다** — 대면편취에서도 지급정지는
      // 걸립니다, 수사기관이 계좌를 특정한 뒤에.
      //
      // **`done_verified`·`unconfirmed` 는 여기 오지 않습니다** — planner 가
      // `preserved` 로 빼둡니다. `in_progress` 는 planner 가 그대로 다시 실어
      // 보내므로 값이 안 바뀝니다. 그래도 SQL 쪽 그물을 걷지 않고 `skipped`
      // 하나만 통과시킵니다 — 이 자리가 사용자의 진행을 되돌릴 수 있는
      // 마지막 문입니다
      await tx`
        INSERT INTO plan_step
          (plan_step_id, case_id, seq, step_key, title, actor, body, conditional,
           state, kb_entry_id, kb_version, source_url, effective_from, generated_at)
        VALUES (${newId()}, ${caseId}, ${step.seq}, ${step.stepKey}, ${step.title},
                ${step.actor}, ${tx.json(step.body as never)}, ${step.conditional},
                ${step.state}, ${step.kbEntryId}, ${step.kbVersion},
                ${step.sourceUrl}, ${step.effectiveFrom}, ${step.generatedAt})
        ON CONFLICT (case_id, step_key) DO UPDATE SET
          state = CASE WHEN plan_step.state = 'skipped'
                       THEN EXCLUDED.state ELSE plan_step.state END,
          seq = EXCLUDED.seq,
          title = EXCLUDED.title,
          actor = EXCLUDED.actor,
          body = EXCLUDED.body,
          conditional = EXCLUDED.conditional,
          kb_entry_id = EXCLUDED.kb_entry_id,
          kb_version = EXCLUDED.kb_version,
          source_url = EXCLUDED.source_url,
          effective_from = EXCLUDED.effective_from,
          generated_at = EXCLUDED.generated_at,
          updated_at = now()
      `
    }

    // 내용은 그대로 두고 **순서만** 갱신합니다. 앞에 새 단계가 끼면 뒤로 밀립니다
    for (const step of result.preserved) {
      await tx`
        UPDATE plan_step SET seq = ${step.seq}, updated_at = now()
        WHERE case_id = ${caseId} AND step_key = ${step.stepKey}
      `
    }

    // **지우지 않습니다.** 조건이 다시 맞으면 되살아나야 하고, 딸린 부산물도
    // 남아 있어야 합니다 → §6.1
    if (result.skipped.length > 0) {
      // ⚠️ **위 주석이 「여기 오지 않습니다」라고 적어 둔 것이 실제로 왔습니다**
      // (2026-08-31). `preserved` 는 새 플랜에 **남은** 단계만 담아서, 활성 조건이
      // 바뀌어 빠진 단계는 `done_verified` 여도 `skipped` 목록에 실렸습니다.
      // planner 쪽을 고쳤고, 「마지막 문」이라고 적어 둔 이 자리에도 그물을 겁니다
      await tx`
        UPDATE plan_step SET state = 'skipped', updated_at = now()
        WHERE case_id = ${caseId} AND step_key = ANY(${[...result.skipped]})
          AND state NOT IN ('done_verified', 'unconfirmed')
      `
    }
  }

  return {
    async readCase(caseId) {
      const rows = await sql<{ track: Track }[]>`
        SELECT track FROM "case" WHERE case_id = ${caseId}
      `
      return rows[0] ? { track: rows[0].track } : null
    },

    async readSlots(caseId) {
      const rows = await sql<{ slot_key: SlotKey; tier: SlotTier; state: SlotState }[]>`
        SELECT slot_key, tier, state FROM case_slot WHERE case_id = ${caseId}
      `
      return rows.map((one) => ({
        slotKey: one.slot_key,
        tier: one.tier,
        state: one.state,
      })) satisfies readonly StoredSlot[]
    },

    async readChannel(caseId) {
      // **가장 확신이 높은 것 하나.** 여러 번 특정을 시도할 수 있고, 그때
      // 마지막이 아니라 가장 확실한 것을 씁니다 → 09-data-model.md §4
      const rows = await sql<{ channel_id: string; org_id: string | null }[]>`
        SELECT channel_id, org_id FROM case_channel
        WHERE case_id = ${caseId}
        ORDER BY confidence DESC NULLS LAST, created_at DESC
        LIMIT 1
      `
      const row = rows[0]
      return row ? { channelId: row.channel_id, orgId: row.org_id } : null
    },

    async readChannels(caseId) {
      // **접기 전의 줄 전부입니다** → `lib/channels.ts`. 여기서 골라내지 않는
      // 이유는 규칙이 「가장 확신 높은 하나」보다 복잡해서입니다 — 같은 유형의
      // 미특정 줄은 흡수하고, 기관이 다르면 남겨야 합니다
      const rows = await sql<
        {
          channel_id: string
          org_id: string | null
          org_name_raw: string | null
          amount: string | number | null
          confidence: string | number | null
        }[]
      >`
        SELECT channel_id, org_id, org_name_raw, amount, confidence
        FROM case_channel
        WHERE case_id = ${caseId}
        ORDER BY confidence DESC NULLS LAST, created_at DESC
      `
      return foldChannels(
        rows.map((one) => ({
          channelId: one.channel_id,
          orgId: one.org_id,
          orgNameRaw: one.org_name_raw,
          amount: numeric(one.amount),
          confidence: numeric(one.confidence),
        })),
      )
    },

    readSteps,

    async applyPlan(caseId, result) {
      await sql.begin(async (tx) => {
        await apply(caseId, result, tx as unknown as Sql)
      })
      return readSteps(caseId)
    },

    /**
     * 사건과 플랜을 **함께** 저장한다 → ADR-046.
     *
     * 사건을 먼저 넣고 플랜이 실패하면 **되돌아갈 수 없는 빈 사건**이 남습니다 —
     * 에러 봉투에 `case_id` 를 담을 칸이 없어(10-errors.md §3) 사용자가 자기
     * 사건을 다시 찾을 방법이 없습니다. 하나의 트랜잭션이라야 합니다.
     */
    async openCase(row: OpenedCase, result: PlanResult) {
      await sql.begin(async (tx) => {
        await tx`
          INSERT INTO "case" (case_id, link_token, track, status, opened_at, purge_after)
          VALUES (${row.caseId}, ${row.linkToken}, ${row.track}, ${row.status},
                  ${row.openedAt}, ${row.purgeAfter})
        `
        await apply(row.caseId, result, tx as unknown as Sql)
      })
      return readSteps(row.caseId)
    },
  }
}
