/**
 * 플랜을 만들고 다시 만드는 자리 — **호출자가 둘입니다.**
 *
 * 정본: spec/common/08-14-api.md §3.1 §3.5 · spec/backend/08-16-data-model.md §6 §6.1 §11.2
 *       spec/backend/08-14-slot-tiering.md
 * 근거: ADR-028 「라우트는 얇게, 모듈이 두껍게」 · CLAUDE.md 불변 규칙 1·5
 *
 * | 부르는 곳 | 언제 |
 * | --- | --- |
 * | `POST /api/cases` | 사건을 연 직후. 슬롯이 하나도 없어도 T0 가 붙습니다 |
 * | `PATCH …/slots/{slot_key}` | 슬롯이 채워질 때마다 |
 *
 * **둘이 같은 코드를 지나야 합니다.** 갈라 두면 「생성」과 「재생성」의 결과가
 * 조금씩 달라지고, 어느 쪽이 맞는지 알 수 없게 됩니다.
 *
 * ## 이 자리가 하는 일
 *
 * ```
 * 사건 읽기 → 슬롯 읽기 → 경유 서비스 읽기
 *   → 슬롯 체커: T1 충족? 슈퍼셋으로 갈까?
 *   → KB 조회 (적용·참고 두 묶음)
 *   → 플랜 생성기: step_key 로 병합
 *   → 저장 (삭제 후 삽입이 아니라 병합)
 *   → 감사 기록
 * ```
 *
 * **정보가 없다고 멈추지 않습니다** → 불변 규칙 5. 슬롯이 하나도 없으면
 * 슈퍼셋 플랜이 되고, 그것이 정상입니다.
 *
 * **근거 없는 단계는 만들지 않습니다** → 불변 규칙 1. 플랜 생성기가 근거 네 칸이
 * 빈 KB 항목을 받으면 던집니다 — 여기서 삼키지 않습니다.
 *
 * ## 기한은 단계가 정해진 뒤에 셉니다
 *
 * 기한은 **플랜 단계에 딸립니다** — 단계가 없으면 기한도 없습니다. 그래서
 * `applyPlan` 뒤에 [compute-deadlines](./compute-deadlines.ts) 가 돕니다.
 * 여기서 세지 않고 그 파일에 맡기는 이유는 부르는 자리가 셋이기 때문입니다 —
 * 플랜 재생성 · 슬롯 답변 · 부산물 제출. 셋이 같은 코드를 지나야 결과가 안 갈립니다.
 *
 * **기산 슬롯이 안 채워졌으면 아무 줄도 안 생깁니다.** 그것이 정상입니다 —
 * 「3영업일」은 무엇으로부터인지가 정해져야 날짜가 됩니다.
 */

import 'server-only'

import { kbRowToPlanStep } from '@/lib/adapters'
import type { ChannelRow } from '@/lib/channels'
import { serverClock } from '@/lib/clock'
import { CaseNotFoundError } from '@/lib/http'
import type { Container } from '@/lib/container'
import { cautionOf, submitPathsOf, withContacts, type SubmitPath } from '@/lib/contact'
import type { DeadlineChange } from '@/lib/db'

import type { OpenedCase, Track } from '@/modules/case-intake'
import type { Actor, PlanResult, StepState } from '@/modules/planner'
import type { NextQuestion, SlotKey, SlotState, SlotTier, TierStatus } from '@/modules/slot-checker'

import { computeDeadlines } from './compute-deadlines'

/** `case_slot` 한 행 중 이 흐름이 보는 것 → 09-data-model.md §5 */
export interface StoredSlot {
  readonly slotKey: SlotKey
  readonly tier: SlotTier
  readonly state: SlotState
  /**
   * 토큰화된 값. 슬롯 체커가 `extracted` 를 되물을 때 보여줄 값입니다(ADR-069).
   * 플랜을 만드는 데는 상태만 필요해 오래 없던 칸이라 선택입니다
   */
  readonly valueMasked?: string | null
}

/**
 * `plan_step` 한 행 → 09-data-model.md §6.
 *
 * **칼럼 이름은 `plan_step_id` 인데 계약의 이름은 `step_id` 입니다** → §3.6.
 * 옮기는 자리를 아래 `toApiStep` 하나로 모읍니다.
 */
/** 단계에 딸린 부산물 하나 → 09-data-model.md §7 */
export interface StoredArtifact {
  readonly artifactId: string
  readonly kind: string
  readonly verifyLevel: string
  readonly verifyResult: string
  /**
   * ISO 8601 · **시간대 포함**.
   *
   * **기한의 기산점이 될 수 있습니다** → 08-16-deadline-rules.md
   * 「기산점은 부산물」. `deadline.from` 이 `artifact:{kind}` 인 단계가 씁니다.
   */
  readonly createdAt: string
}

/** 이 단계를 끝내려면 무엇이 필요한가 → §11.4 */
export interface RequiredArtifact {
  readonly kind: string
  readonly label: string
}

/**
 * 저장된 단계 하나.
 *
 * **모양이 §3.1 과 §3.6 에서 같습니다** → ADR-047. 얇은 쪽이면 화면이 사건을 만든
 * 직후에 작업 패널을 못 그립니다 — 그 패널을 정하는 `action` 이 `body` 안에 있습니다.
 */
export interface StoredStep {
  readonly planStepId: string
  readonly stepKey: string
  readonly seq: number
  readonly title: string
  readonly actor: Actor
  readonly conditional: string | null
  readonly state: StepState
  /** `plan_step.body` 그대로. `action`·`contact` 가 여기 있습니다 → §11.4 */
  readonly body: Readonly<Record<string, unknown>>
  readonly kbEntryId: string
  readonly kbVersion: string
  /**
   * 법령 근거.
   *
   * **`plan_step` 에 없는 칼럼입니다**(§6). `kb_entry` 를
   * `(kb_entry_id, kb_version)` 으로 함께 읽어야 나옵니다 → §11.3.
   */
  readonly legalBasis: string
  readonly sourceUrl: string
  /** `YYYY-MM-DD` */
  readonly effectiveFrom: string
  /**
   * 이 단계를 **만든** 시각 — ISO 8601 · 시간대 포함 → 09-data-model.md §6
   * `generated_at`. 계약 §3.6 의 `generated_at` 이 여기서 나옵니다.
   *
   * **읽은 때가 아닙니다.** `planner` 가 단계를 만들며 찍고(`plan.ts`),
   * 저장소가 그대로 적었다가 그대로 되읽습니다. 조회 때 지금 시각을 넣으면
   * 화면이 아무 일도 없었는데 매번 「방금 갱신됨」이 됩니다.
   *
   * **재생성이 보존한 단계는 옛 시각을 그대로 들고 있습니다** → §6.1.
   * 그래서 플랜 전체의 기준 시각은 아래 `PlanSnapshot.generatedAt` 이
   * **최대값**으로 셉니다.
   *
   * ⬜ **선택 칸입니다.** 이 값을 안 싣는 저장소 대역이 아직 남아 있어서고,
   * 없으면 §3.6 의 칸이 `null` 로 나갑니다 — **지어내지 않습니다.**
   */
  readonly generatedAt?: string
  /** 이 단계에 붙은 부산물. 없으면 빈 배열 */
  readonly artifacts: readonly StoredArtifact[]
  /** 없으면 `null` */
  readonly requiredArtifact: RequiredArtifact | null
}

/**
 * 이 흐름이 밖에 요구하는 것 — 사건의 상태를 읽고 플랜을 반영하는 자리.
 *
 * **SQL 은 여기 없습니다.** ⬜ DB 드라이버가 아직 안 정해져(`package.json` 에 하나도
 * 없습니다) 구현이 없고, 부르면 무엇이 왜 없는지 말하며 멈춥니다
 * → [not-configured.ts](../lib/not-configured.ts).
 */
export interface CasePlanStore {
  /** 사건의 갈래. 없는 사건이면 `null` */
  readCase(caseId: string): Promise<{ readonly track: Track } | null>
  /** 슬롯. 하나도 없으면 빈 배열 — **없는 것이 정상입니다** */
  readSlots(caseId: string): Promise<readonly StoredSlot[]>
  /** 특정된 경유 서비스. 못 특정했으면 `null` → 09-data-model.md §4 */
  readChannel(
    caseId: string,
  ): Promise<{ readonly channelId: string; readonly orgId: string | null } | null>
  /**
   * 경유 서비스 **전부** — 화면이 「어디로 얼마가 나갔나」를 보여줍니다 → 계약 §3.6.
   *
   * `readChannel` 과 나눈 이유는 **쓰는 데가 달라서**입니다. 플랜을 만들 때는
   * 어느 유형의 KB 를 집을지 하나만 정하면 되지만(§11.2), 화면은 여러 건을
   * 함께 보여줘야 합니다 — 은행에 보내고 상품권도 산 사건이 있습니다.
   *
   * **접힌 뒤의 목록입니다** → `lib/channels.ts`. 하나도 없으면 빈 배열이고,
   * 유형을 아직 안 물은 사건이 그 경우입니다.
   */
  readChannels(caseId: string): Promise<readonly ChannelRow[]>
  /**
   * 이미 저장된 단계. 처음이면 빈 배열.
   *
   * **`kb_entry` 와 `artifact` 를 함께 읽어야 합니다** → ADR-047.
   * `legalBasis` 는 `plan_step` 에 없는 칼럼이고, 부산물은 `idx_artifact_step` 으로 옵니다.
   */
  readSteps(caseId: string): Promise<readonly StoredStep[]>
  /**
   * 병합 결과를 반영하고 **반영 뒤의 플랜 전부**를 `seq` 순으로 돌려준다.
   *
   * **삭제 후 삽입이 아닙니다** → §6.1. `upsert` 는 교체하고, `preserved` 는
   * 내용을 두고 `seq` 만 갱신하며, `skipped` 는 상태만 바꿉니다. 지우지 않습니다.
   *
   * 새 단계의 `plan_step_id` 는 이 구현이 발급합니다 — 발급기를 이 흐름이
   * 고를 이유가 없습니다.
   */
  applyPlan(caseId: string, result: PlanResult): Promise<readonly StoredStep[]>
  /**
   * **사건과 플랜을 한 번에 만든다** → ADR-046.
   *
   * 사건을 먼저 저장하면 플랜이 실패했을 때 **되돌아갈 수 없는 빈 사건**이
   * 남습니다 — 에러 봉투에 `case_id` 를 담을 칸이 없기 때문입니다(10-errors.md §3).
   * 사용자는 진입할 때마다 빈 사건을 하나씩 쌓고, 사건 생성 상한까지 소진합니다.
   *
   * **한 트랜잭션이어야 합니다.** 둘로 갈라 부르는 자리를 만들지 마세요 —
   * 포트를 나눈 순간 어떤 구현도 이것을 보장할 수 없습니다.
   */
  openCase(row: OpenedCase, result: PlanResult): Promise<readonly StoredStep[]>
}

/**
 * 이 흐름이 밖에 요구하는 것 — **지금 어느 KB 릴리스인가.**
 *
 * **`KB_VERSION` 환경변수가 현재 릴리스입니다** → ADR-045 · §11.2.
 *
 * 「가장 최근 적재분」을 쓰지 않습니다. 적재기는 검수 중인 다음 버전을 미리 올릴 수
 * 있고, 최신 것을 무조건 고르면 **아직 사람이 안 본 절차가 피해자에게 나갑니다.**
 *
 * 값이 비어 있으면 던집니다 — 근거 없는 안내보다 멈추는 편이 낫습니다.
 */
export interface KbVersionSource {
  /**
   * @throws KbUnavailableError 알 수 없을 때. **근거 없는 안내보다 멈추는 편이
   *         낫습니다** → 10-errors.md §4.1
   */
  current(): Promise<string>
}

/** 이 흐름이 내놓는 것 */
/**
 * 화면이 받는 경유 서비스 한 건 → 계약 §3.6 `channels[]`.
 *
 * `ChannelRow` 와 다른 점은 **이름이 풀려 있다는 것 하나**입니다.
 */
export interface PlanChannel {
  readonly channelId: string
  /** 서버가 해석한 기관. `null` 이면 미특정 — 화면이 「어느 은행인지」를 되물을 수 있습니다 */
  readonly orgId: string | null
  /**
   * 표시용 이름. 기관이 풀리면 정식 표기, 아니면 **사용자가 말한 그대로**입니다.
   *
   * 둘 다 없으면 `null`. **`org_name` 만으로는 서버가 표기를 어떻게 해석했는지
   * 알 수 없어** 화면은 `org_id` 로 판단합니다 → 계약 §3.6.
   */
  readonly orgName: string | null
  readonly amount: number | null
  readonly confidence: number | null
  /**
   * 신청서를 내는 길 — `org.contact.submit` **순서 그대로** → 계약 §3.6 · ADR-042.
   *
   * 기관을 특정 못 했거나 KB 에 확인된 길이 없으면 **빈 배열**입니다.
   * 화면은 그때 제출처 카드를 아예 안 그립니다 — 「모른다」를 「없다」로
   * 그리지 않으려는 것이고, 서버가 그 둘을 여기서 뭉개지 않습니다.
   */
  readonly submit: readonly SubmitPath[]
  /** 그 기관에서 헷갈리기 쉬운 것 — `org.contact.caution`. 없으면 `null` */
  readonly caution: string | null
}

export interface PlanSnapshot {
  readonly caseId: string
  /** 조건부 단계가 섞인 넓은 플랜인가 → 08-14-slot-tiering.md */
  readonly isSuperset: boolean
  /**
   * 이 플랜이 만들어진 시각 → 계약 §3.6 `generated_at`. **단계가 없으면 `null`.**
   *
   * ## 왜 최대값인가
   *
   * 재생성은 지우고 다시 넣지 않습니다(§6.1). 사용자가 이미 끝낸 단계는
   * `preserved` 로 남고 **`generated_at` 도 그때 그대로**입니다. 그래서 한
   * 플랜 안에 시각이 여럿 섞이고, 첫째나 최소를 쓰면 **방금 다시 만든 플랜이
   * 며칠 전 것으로 보입니다** — 화면의 「이 안내는 언제 기준인가」가 실제와
   * 어긋나고, 사용자는 제도가 바뀐 뒤에도 갱신됐다는 것을 모릅니다.
   *
   * **지금 시각을 쓰지도 않습니다** — 조회는 아무것도 안 바꾸는데 매번
   * 「방금 갱신됨」이 됩니다.
   */
  readonly generatedAt: string | null
  readonly kbVersion: string
  readonly steps: readonly StoredStep[]
  /** 어디로 얼마가 나갔나 → 계약 §3.6. 아직 안 물었으면 빈 배열 */
  readonly channels: readonly PlanChannel[]
  /** 다음에 물을 한 문항. 없으면 `null` — **그래도 실행 보드는 열립니다** */
  readonly nextQuestion: NextQuestion | null
  readonly t1: TierStatus
  readonly t2: TierStatus
  /**
   * 이번에 날짜가 옮겨졌거나 새로 생긴 기한 → §3.5 `changed_deadlines`.
   *
   * **안 바뀐 기한은 안 실립니다.** 매번 전부 실으면 화면이 아무 일도 없었는데
   * 「날짜가 바뀌었습니다」를 띄웁니다.
   */
  readonly changedDeadlines: readonly DeadlineChange[]
  /**
   * **플랜 생성** 기록의 식별자 — `plan.generated` 한 줄.
   *
   * 사건 생성 경로에서는 이 값이 계측 헤더에 안 실립니다. 그 응답의
   * `X-Audit-Id` 는 먼저 남은 `case.opened` 것이고, 헤더가 하나라 뒤엣것으로
   * 덮지 않기 때문입니다 → [telemetry.ts](../lib/telemetry.ts).
   * **두 기록 다 같은 `case_id` 로 묶여 있어** 사건 식별자로 함께 찾습니다.
   */
  readonly auditId: string
}

export interface RegeneratePlanDeps {
  readonly container: Container
  readonly store: CasePlanStore
  readonly kbVersion: KbVersionSource
}

/**
 * 못 알아본 기관을 되물을 선택지 — 이 사건 유형의 기관 이름들.
 *
 * §11.4.4 ① 이 *"못 찾으면 되묻는 편이 안전합니다"* 로 정했고, 되묻는 것은
 * 슬롯 체커의 몫입니다. 그러려면 **고를 것을 줘야 합니다** — 자유 입력으로
 * 다시 물으면 같은 표기를 다시 쓰게 되어 되풀이됩니다.
 *
 * 유형이 안 정해졌거나 그 유형에 사전이 아직 없으면 빈 배열입니다.
 * **그때는 되묻지 않는 것이 맞습니다** — 「사전에 없어서 못 찾은 것」과
 * 「잘못 들어서 못 찾은 것」이 구분되지 않아, 물어도 고를 것이 없습니다.
 */
async function orgOptions(
  channelId: string | null,
  kbVersion: string | null,
  container: Container,
): Promise<readonly string[]> {
  if (!channelId || !kbVersion) return []
  try {
    const rows = await container.channelWrite.candidates(channelId, kbVersion)
    return rows.map((one) => one.name)
  } catch {
    // 후보를 못 읽어도 **플랜은 나가야 합니다.** 되묻기만 조용히 빠집니다
    return []
  }
}

/**
 * 이 플랜의 기준 시각 — **단계들의 최대값** → 계약 §3.6 `generated_at`.
 *
 * 재생성이 보존한 단계(§6.1)는 옛 시각을 그대로 들고 있어 한 플랜 안에
 * 시각이 섞입니다. **최대라야 「가장 최근에 이 플랜을 손본 때」**가 되고,
 * 첫째나 최소를 쓰면 방금 갱신한 플랜이 며칠 전 것으로 보입니다.
 *
 * **없으면 `null` 입니다** — 단계가 하나도 없거나(막 열린 사건) 저장소가 이
 * 값을 안 실었을 때. 지금 시각으로 메우지 않습니다.
 */
function latestGeneratedAt(steps: readonly StoredStep[]): string | null {
  let latest: string | null = null
  let latestMs = -Infinity

  for (const one of steps) {
    if (one.generatedAt === undefined) continue
    // **읽을 수 없는 값은 못 본 것으로 둡니다.** 못 읽은 것을 최대로 세면
    // 기준 시각이 통째로 엉뚱해집니다
    const ms = Date.parse(one.generatedAt)
    if (Number.isNaN(ms) || ms <= latestMs) continue
    latest = one.generatedAt
    latestMs = ms
  }

  return latest
}

/**
 * 사건 하나의 플랜을 지금 아는 것에 맞춰 다시 만든다.
 *
 * @throws KbUnavailableError KB 조회가 실패했을 때 — 멈춥니다
 * @throws KbError 근거 네 칸이 빈 KB 항목이 왔을 때 — 버리지 않고 멈춥니다
 */
export async function regeneratePlan(
  caseId: string,
  deps: RegeneratePlanDeps,
): Promise<PlanSnapshot> {
  const { container, store, kbVersion } = deps
  const { kbFinder, planner, slotChecker, auditLogger } = container

  const found = await store.readCase(caseId)
  if (!found) {
    throw new CaseNotFoundError('그 사건을 찾지 못했습니다', { caseId })
  }

  const [slots, channel, channelRows, existing, version] = await Promise.all([
    store.readSlots(caseId),
    store.readChannel(caseId),
    store.readChannels(caseId),
    store.readSteps(caseId),
    kbVersion.current(),
  ])

  // 슬롯이 하나도 없어도 판정합니다 — T1 미충족이고, 그것이 정상입니다
  const check = slotChecker.check({
    slots,
    orgCandidates: await orgOptions(channel?.channelId ?? null, version, container),
  })

  const groups = await kbFinder.find({
    kbVersion: version,
    track: found.track,
    // **비면 T1 미충족입니다** — 조회가 전 유형 공통(T0)만 집어 옵니다
    channelId: channel?.channelId ?? null,
    orgId: channel?.orgId ?? null,
    // **서버 시각입니다** → 09-data-model.md §11.2. 클라이언트 시계를 믿지 않습니다.
    // 서버 시계는 `lib/clock.ts` 하나뿐입니다 — `date-checker` 에는 오늘을
    // 내주는 메서드가 없고(그 모듈은 오늘을 밖에서 받아 씁니다), 시계가 여럿이면
    // 크론이 UTC 자정 근처에서 하루 어긋납니다
    asOf: serverClock.today(),
  })

  const result = planner.build({
    caseId,
    applied: groups.applied.map(kbRowToPlanStep),
    // 참고 묶음은 슈퍼셋일 때만 씁니다 — 섞으면 은행 사건에 거래소 절차가 붙습니다
    reference: groups.reference.map(kbRowToPlanStep),
    slots: slots.map((one) => ({ slotKey: one.slotKey, state: one.state })),
    existing: existing.map((one) => ({ stepKey: one.stepKey, state: one.state })),
    superset: check.needsSupersetPlan,
  })

  const applied = await store.applyPlan(caseId, result)
  const steps = await dressContacts(caseId, applied, { container, store })

  // **단계가 정해진 뒤입니다.** 기한은 단계에 딸리므로 순서가 뒤집히면
  // 방금 생긴 단계의 기한이 한 박자 늦게 생깁니다
  const changedDeadlines = await computeDeadlines(
    { caseId, steps, kbVersion: version },
    container,
  )

  // 09-data-model.md §10.2 — detail 에 건수와 버전만 담습니다. 원문도 토큰도 안 넣습니다
  const record = await auditLogger.record({
    eventType: 'plan.generated',
    actorType: 'system',
    caseId,
    detail: { kb_version: version, steps: steps.length },
  })

  return {
    caseId,
    isSuperset: check.needsSupersetPlan,
    generatedAt: latestGeneratedAt(steps),
    kbVersion: version,
    steps,
    channels: await dressChannels(channelRows, version, container),
    nextQuestion: check.nextQuestion,
    t1: check.t1,
    t2: check.t2,
    changedDeadlines,
    auditId: record.auditId,
  }
}

/**
 * 단계 본문의 `contact_ref` 를 실제 번호로 바꾼다 → §3.6 `body.contact`.
 *
 * **세 경로가 같은 값을 봐야 합니다** — 사건 생성(§3.1) · 플랜 조회(§3.6) ·
 * 재생성. 라우트마다 따로 풀면 어떤 화면은 번호를 받고 어떤 화면은 못 받습니다.
 *
 * **못 풀어도 단계는 그대로 나갑니다** → §11.4.3. 기관을 특정 못 했거나
 * (`org_id` 가 `null`) 그 릴리스에 그 기관이 없으면 `contact` 가 `null` 입니다 —
 * 연락처는 절차의 부속이지 절차 자체가 아닙니다.
 */
async function dressContacts(
  caseId: string,
  steps: readonly StoredStep[],
  deps: { container: Container; store: CasePlanStore },
): Promise<readonly StoredStep[]> {
  if (steps.length === 0) return steps

  const channel = await deps.store.readChannel(caseId)
  // 기관을 특정 못 했으면 풀 것이 없습니다. **유형 기본 절차는 그대로입니다**
  if (!channel?.orgId) return steps

  // **단계가 만들어진 릴리스로 읽습니다.** 지금 릴리스로 읽으면 옛 플랜에
  // 새 번호가 붙어, 「그때 무엇을 안내했나」가 실제와 어긋납니다
  const org = await deps.container.orgs
    .read(channel.orgId, steps[0]!.kbVersion)
    // 기관을 못 찾는 것은 안내를 멈출 이유가 아닙니다
    .catch(() => null)
  if (!org) return steps

  return steps.map((one) => ({ ...one, body: withContacts(one.body, org.contact) }))
}

/**
 * 경유 서비스에 표시용 이름을 붙인다 → 계약 §3.6 `channels[].org_name`.
 *
 * **정식 표기를 먼저 씁니다.** 사용자는 「국민」이라고 말하지만 화면에는
 * 「KB국민은행」이 떠야 어디에 전화할지가 분명합니다.
 *
 * **못 풀면 사용자가 말한 표기를 그대로 씁니다.** 빈칸으로 두면 자기가 답한
 * 것조차 화면에서 사라지고, 무엇을 더 알려줘야 하는지도 알 수 없습니다 —
 * 그 표기는 개인정보가 아닙니다(§4.1 · ADR-011).
 *
 * `kbVersion` 이 `null` 인 것은 단계가 아직 없다는 뜻이라 그때는 이름을
 * 풀지 않습니다. 기관 표는 릴리스마다 따로 있어 읽을 기준이 없습니다.
 *
 * **제출처(`submit`)와 주의(`caution`)도 같은 읽기에서 옵니다** → §3.6.
 * 기재 안내 화면의 제출처 카드가 받을 자리가 없어 영영 안 그려지고 있었습니다
 * (GitHub #40). 기관 행을 이미 읽고 있으니 왕복이 늘지 않습니다 — 그리고
 * **같은 행에서 나와야** 이름과 제출처가 서로 다른 기관을 말하지 않습니다.
 */
async function dressChannels(
  rows: readonly ChannelRow[],
  kbVersion: string | null,
  container: RegeneratePlanDeps['container'],
): Promise<readonly PlanChannel[]> {
  return Promise.all(
    rows.map(async (one) => {
      const org =
        one.orgId && kbVersion
          ? // 기관을 못 찾는 것은 목록을 못 내보낼 이유가 아닙니다
            await container.orgs.read(one.orgId, kbVersion).catch(() => null)
          : null

      return {
        channelId: one.channelId,
        orgId: one.orgId,
        orgName: org?.name ?? one.orgNameRaw,
        amount: one.amount,
        confidence: one.confidence,
        // 기관이 없으면 빈 배열·null — `org` 가 없다고 칸을 빼지 않습니다.
        // 「칸이 없다」와 「길이 없다」가 화면에서 갈리면 안 됩니다(§3.6 `after` 와 같은 규칙)
        submit: submitPathsOf(org?.contact ?? null),
        caution: cautionOf(org?.contact ?? null),
      }
    }),
  )
}

/**
 * 그 사건이 없다.
 *
 * 08-16-errors.md §3 — 404.
 * *"이 주소의 사건을 찾을 수 없습니다. 마지막 활동일부터 180일이 지나면 자동으로 파기됩니다."*
 *
 * **없는 것과 파기된 것을 가르지 않습니다** — 가르면 그 토큰이 한때 유효했다는
 * 사실이 밖으로 나갑니다 → 08-14-api.md §3.10 · ADR-021.
 *
 * **`KB_ENTRY_NOT_FOUND` 와 다릅니다** — 저쪽은 절차 항목이 없는 것이고
 * 이쪽은 사건이 없는 것이라, 사용자에게 보일 말이 완전히 다릅니다.
 */
/**
 * 저장된 플랜을 **다시 만들지 않고 읽는다** — §3.4 · §3.6 · §3.10.
 *
 * `regeneratePlan` 과 나눈 이유는 **조회가 쓰기를 하면 안 되기 때문**입니다.
 * 화면은 폴링으로 이 경로를 반복해서 부르는데(§1.3 「세션당 분당 300회」),
 * 그때마다 KB 를 다시 조회해 플랜을 갈아엎으면 세 가지가 깨집니다 —
 * 감사 기록이 조회 횟수만큼 쌓이고, KB 릴리스가 바뀌는 순간 사용자가 보던
 * 플랜이 새로고침 한 번에 달라지며, 비용이 조회마다 붙습니다.
 *
 * **`auditId` 가 없습니다.** 읽기는 기록할 일이 아닙니다 — 감사 기록은
 * 「무엇을 했나」를 남기는 것이고 조회는 아무것도 안 바꿉니다.
 */
export async function readCasePlan(
  caseId: string,
  deps: { container: RegeneratePlanDeps['container']; store: CasePlanStore },
): Promise<
  Omit<PlanSnapshot, 'auditId' | 'changedDeadlines'> & {
    readonly kbVersion: string | null
  }
> {
  const { container, store } = deps

  const found = await store.readCase(caseId)
  if (!found) {
    throw new CaseNotFoundError('그 사건을 찾지 못했습니다', { caseId })
  }

  const [slots, stored, channelRows, channel] = await Promise.all([
    store.readSlots(caseId),
    store.readSteps(caseId),
    store.readChannels(caseId),
    store.readChannel(caseId),
  ])
  const steps = await dressContacts(caseId, stored, { container, store })

  // **저장된 단계가 어느 릴리스로 만들어졌는지**를 그대로 씁니다.
  // 지금 릴리스를 쓰면 「이 안내가 어느 기준인가」가 실제와 어긋납니다 —
  // 플랜은 옛 릴리스로 만들어졌는데 새 번호가 붙습니다
  const kbVersion = steps[0]?.kbVersion ?? null

  // 슬롯이 하나도 없어도 판정합니다 — T1 미충족이고, 그것이 정상입니다.
  //
  // **이 자리가 `kbVersion` 뒤인 이유**는 기관 후보를 그 릴리스에서 읽기
  // 때문입니다. 읽기 경로도 되묻기를 내야 새로고침한 뒤에도 질문이 살아
  // 있습니다 — 화면이 첫 문항을 여기서 받습니다
  const check = container.slotChecker.check({
    slots,
    orgCandidates: await orgOptions(channel?.channelId ?? null, kbVersion, container),
  })

  return {
    caseId,
    isSuperset: check.needsSupersetPlan,
    // **읽기도 만든 때를 그대로 씁니다.** 여기서 지금 시각을 넣으면 폴링마다
    // 「방금 갱신됨」이 되고, 화면은 바뀐 것이 없는데 바뀌었다고 말합니다
    generatedAt: latestGeneratedAt(steps),
    kbVersion,
    steps,
    channels: await dressChannels(channelRows, kbVersion, container),
    nextQuestion: check.nextQuestion,
    t1: check.t1,
    t2: check.t2,
  }
}

/**
 * 여기 있던 `CaseNotFoundError` 를 `lib/http.ts` 로 옮겼습니다 (2026-08-23).
 *
 * **같은 코드의 클래스가 둘이면 열거 방어가 한쪽만 셉니다** — `handleRoute` 가
 * `instanceof` 로 404 를 세는데(ADR-039 ④), 두 클래스는 서로 `instanceof` 가
 * 아닙니다. 이 파일에서 던진 404 만 안 세어지는 상태였습니다.
 */
export { CaseNotFoundError }

/**
 * 사건을 열고 **T0 공통 안전 절차를 함께 저장한다** → §3.1 · ADR-046.
 *
 * 슬롯이 하나도 없어도 절차가 붙습니다 → 08-14-slot-tiering.md *"진입 자체로 충분"*.
 *
 * ## 왜 사건을 먼저 저장하지 않나
 *
 * 사건 행이 커밋된 뒤 플랜이 실패하면 에러 응답이 나가는데, **에러 봉투에는
 * `case_id` 를 담을 칸이 없습니다**(10-errors.md §3). 사용자는 방금 만들어진
 * 자기 사건으로 돌아갈 수 없고, 다시 시도할 때마다 빈 사건이 하나씩 쌓입니다.
 *
 * 그래서 **둘 다 만들어진 뒤에 한 번에 저장합니다.** 중간에 실패하면 아무것도
 * 안 남고, 사용자는 같은 자리에서 다시 시도하면 됩니다.
 *
 * @throws IngestError 갈래가 목록 밖일 때
 * @throws KbUnavailableError KB 조회가 실패했을 때 — 멈춥니다
 * @throws KbError 근거 네 칸이 빈 KB 항목이 왔을 때 — 버리지 않고 멈춥니다
 */
export async function openCaseWithPlan(
  input: { track: Track },
  deps: RegeneratePlanDeps,
): Promise<{ readonly opened: OpenedCase; readonly plan: PlanSnapshot }> {
  const { container, store, kbVersion } = deps
  const { caseIntake, kbFinder, planner, slotChecker, auditLogger } = container

  // 값만 만듭니다. 아직 저장하지 않습니다
  const opened = caseIntake.draft(input)
  const version = await kbVersion.current()

  // 새 사건이라 슬롯도 경유 서비스도 기존 단계도 없습니다.
  // **읽으러 가지 않습니다** — 아직 저장된 것이 없으므로 물어볼 곳이 없습니다
  const check = slotChecker.check({ slots: [] })

  const groups = await kbFinder.find({
    kbVersion: version,
    track: opened.track,
    // 비어 있어 조회가 전 유형 공통(T0)만 집어 옵니다
    channelId: null,
    orgId: null,
    asOf: serverClock.today(),
  })

  const result = planner.build({
    caseId: opened.caseId,
    applied: groups.applied.map(kbRowToPlanStep),
    reference: groups.reference.map(kbRowToPlanStep),
    slots: [],
    existing: [],
    superset: check.needsSupersetPlan,
  })

  // **여기서 처음 저장합니다.** 사건과 플랜이 한 트랜잭션으로 들어갑니다
  const steps = await store.openCase(opened, result)

  // 새 사건에는 기산점이 될 슬롯이 아직 없어 **보통 빈 배열입니다.** 그래도
  // 같은 코드를 지나게 둡니다 — 생성과 재생성이 갈리면 어느 쪽이 맞는지
  // 알 수 없게 됩니다
  const changedDeadlines = await computeDeadlines(
    { caseId: opened.caseId, steps, kbVersion: version },
    container,
  )

  const record = await auditLogger.record({
    eventType: 'case.opened',
    actorType: 'user',
    caseId: opened.caseId,
    // 09-data-model.md §10.2 — 건수와 버전만. 원문도 토큰도 안 넣습니다
    detail: { track: opened.track, kb_version: version, steps: steps.length },
  })

  return {
    opened,
    plan: {
      caseId: opened.caseId,
      isSuperset: check.needsSupersetPlan,
      generatedAt: latestGeneratedAt(steps),
      kbVersion: version,
      steps,
      // **막 열린 사건에는 경유 서비스가 없습니다.** 진술은 아직 안 받았고,
      // 유형은 문진에서 정해집니다 → §3.5
      channels: [],
      nextQuestion: check.nextQuestion,
      t1: check.t1,
      t2: check.t2,
      changedDeadlines,
      auditId: record.auditId,
    },
  }
}
