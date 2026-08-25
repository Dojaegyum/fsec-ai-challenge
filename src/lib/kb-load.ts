/**
 * KB 파일을 적재할 행으로 옮긴다 — **검증이 본체입니다.**
 *
 * 정본: spec/backend/08-16-data-model.md §11.4 (필드) · §11.4.5 (적재 시 검증) ·
 *       §11.4.6 (`action`) · §11.1 (`kb_entry` 칼럼)
 * 규약: rfc/002-kb-authoring.md — 원본은 `src/kb/*.json`, DB 는 사본
 * 근거: ADR-012(절차 지식을 버전드 KB로) · CLAUDE.md 불변 규칙 1
 *
 * ## 왜 이렇게까지 보나
 *
 * *"절차 데이터는 문법 오류가 실행 시점까지 안 드러납니다"* (§11.4.5).
 * 슬롯 이름을 하나 잘못 적으면 **그 단계가 영영 안 채워지고**, 그 사실이
 * 피해자 화면에서야 드러납니다. 타입 검사도 시험도 JSON 을 안 봅니다.
 *
 * ## 여기는 파일도 DB 도 안 만집니다
 *
 * 읽은 내용을 받아 **판정과 옮길 행만** 돌려줍니다. `fs` 와 `postgres` 는
 * `src/scripts/load-kb.ts` 에 있습니다 — 그래야 이 판정에 시험을 붙일 수 있습니다.
 *
 * ## 버전은 파일에 없습니다
 *
 * `kb_version` 과 `released_at` 은 **적재기가 찍습니다** (RFC-002). 파일에 박으면
 * 항목을 고칠 때마다 버전 문자열까지 손대야 하고, 빠뜨리면 릴리스가 조용히 어긋납니다.
 */

import { isSlotKey } from '@/modules/slot-checker'

/** §11.4.6 이 여덟로 못박았습니다. **비면 적재 거부** */
const ACTIONS: ReadonlySet<string> = new Set([
  'call',
  'visit',
  'write',
  'upload',
  'download',
  'confirm',
  'wait',
  'read',
])

/** `action` 이 이 둘일 때만 `channel` 이 값을 가집니다 → §11.4.5 「행동·채널 어긋남」 */
const CHANNEL_ACTIONS: ReadonlySet<string> = new Set(['call', 'visit'])

/** §11.4 「`steps[].channel`」 */
const CHANNELS: ReadonlySet<string> = new Set(['app', 'phone', 'visit', 'web'])

/** §11.4.2 — 기한의 주인 */
const DEADLINE_OWNERS: ReadonlySet<string> = new Set(['user', 'bank', 'agency'])

/**
 * 이 단계를 **누가 하나** — `plan_step.actor` 의 `CHECK` 와 같은 여섯.
 *
 * ⬜ **정본끼리 어긋나 있습니다.** §11.4 는 *"칼럼으로 이미 있는 것(제목·주체·
 * 근거·시행일)은 여기 넣지 않습니다"* 라고 적혀 있는데, **`kb_entry` 에 `actor`
 * 칼럼이 없고**(§11.1 · 마이그레이션 0001) `planner` 는 `body.actor` 를 읽습니다.
 * 돌아가는 코드에 맞춰 `body` 에서 봅니다 — 어느 쪽이 정본인지는 사람이 정합니다.
 *
 * **기본값을 두지 않습니다.** 두면 기관이 할 일이 사용자 할 일로 뜨고,
 * 화면은 그걸 「당신이 해야 할 것」으로 그립니다 (`planner/plan.ts` 의 같은 판단).
 */
const ACTORS: ReadonlySet<string> = new Set([
  'victim',
  'police',
  'bank',
  'prosecutor',
  'carrier',
  'issuer',
])

/**
 * 본문에 박힌 전화번호 → §11.4.1.
 *
 * ⚠️ **하이픈이 있는 것만 잡습니다.** `112`·`1394` 처럼 하이픈 없는 대표번호는
 * 그냥 숫자와 구분할 방법이 없습니다 — 「112에 신고합니다」는 잡으면 안 되고
 * 「1394로 거세요」는 잡아야 하는데, 기계는 둘을 못 가릅니다.
 * **§11.4.1 은 그대로 유효합니다** — 이 검사가 못 볼 뿐입니다.
 */
const PHONE_IN_TEXT = /\d{2,4}-\d{3,4}-\d{4}|\b\d{4}-\d{4}\b/

/** `deadline.from` 은 슬롯 이름 또는 `artifact:{kind}` → §11.4 필드 규칙 */
const ARTIFACT_FROM = /^artifact:[a-z_]+$/

export interface KbStep {
  readonly text?: unknown
  readonly action?: unknown
  readonly channel?: unknown
  readonly contact_ref?: unknown
  readonly url?: unknown
}

export interface KbDeadline {
  readonly kind?: unknown
  readonly amount?: unknown
  readonly from?: unknown
  readonly owner?: unknown
  readonly grace?: unknown
  readonly on_miss?: unknown
}

export interface KbBody {
  readonly requires_slots?: unknown
  readonly after?: unknown
  readonly conditional?: unknown
  readonly summary?: unknown
  readonly steps?: unknown
  readonly deadline?: unknown
  readonly required_artifact?: unknown
  readonly caveat?: unknown
}

export interface KbEntryInput {
  readonly kb_entry_id?: unknown
  readonly step_key?: unknown
  readonly step_seq?: unknown
  readonly org_id?: unknown
  readonly title?: unknown
  readonly legal_basis?: unknown
  readonly source_url?: unknown
  readonly effective_from?: unknown
  readonly effective_until?: unknown
  readonly verified_at?: unknown
  readonly body?: unknown
}

export interface KbFile {
  /** 어느 파일에서 왔나 — 판정 메시지에 씁니다 */
  readonly name: string
  readonly channel_id?: unknown
  readonly track?: unknown
  readonly entries?: unknown
}

/** `kb_entry` 한 행 — §11.1 칼럼과 1:1 */
export interface KbRow {
  readonly kb_entry_id: string
  readonly kb_version: string
  readonly step_key: string
  readonly step_seq: number
  readonly channel_id: string | null
  readonly org_id: string | null
  readonly track: string
  readonly title: string
  readonly body: Readonly<Record<string, unknown>>
  readonly legal_basis: string
  readonly source_url: string
  readonly effective_from: string
  readonly effective_until: string | null
  readonly verified_at: string
  readonly released_at: string
}

/** 어긴 자리 하나. **어느 파일 어느 항목인지 없으면 못 고칩니다** */
export interface KbProblem {
  readonly file: string
  readonly entry: string | null
  readonly rule: string
  readonly message: string
}

export interface KbPlan {
  readonly rows: readonly KbRow[]
  readonly problems: readonly KbProblem[]
}

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

/**
 * 파일들을 적재할 행으로 옮기고, 어긴 자리를 모읍니다.
 *
 * **하나라도 어기면 부르는 쪽이 통째로 거부합니다** (§11.4.5). 여기서는
 * 던지지 않고 **전부 모아서** 돌려줍니다 — 한 번 돌릴 때마다 하나씩 고치면
 * 열 번 돌아야 합니다.
 */
export function planLoad(
  files: readonly KbFile[],
  opts: { readonly kbVersion: string; readonly releasedAt: string },
): KbPlan {
  const problems: KbProblem[] = []
  const rows: KbRow[] = []
  const add = (file: string, entry: string | null, rule: string, message: string) =>
    problems.push({ file, entry, rule, message })

  // ── 먼저 전체에서 step_key 를 모읍니다 ─────────────────────────────
  // `after` 는 **파일을 넘어** 가리킵니다 (§11.2 우선순위 병합). 파일 안에서만
  // 보면 「공통의 앞 단계를 가리키는 유형 항목」이 전부 없는 참조로 보입니다
  const allStepKeys = new Set<string>()
  for (const file of files) {
    const entries = Array.isArray(file.entries) ? (file.entries as KbEntryInput[]) : []
    for (const entry of entries) {
      if (isText(entry.step_key)) allStepKeys.add(entry.step_key)
    }
  }

  const edges = new Map<string, readonly string[]>()

  for (const file of files) {
    const track = isText(file.track) ? file.track : null
    const channelId =
      file.channel_id === null || file.channel_id === undefined
        ? null
        : isText(file.channel_id)
          ? file.channel_id
          : null

    if (track === null) {
      add(file.name, null, 'FILE', '`track` 이 없습니다')
      continue
    }
    if (!Array.isArray(file.entries)) {
      add(file.name, null, 'FILE', '`entries` 가 배열이 아닙니다')
      continue
    }

    for (const entry of file.entries as KbEntryInput[]) {
      const id = isText(entry.kb_entry_id) ? entry.kb_entry_id : null
      const where = (rule: string, message: string) => add(file.name, id, rule, message)
      /** 이 항목에서 새로 생긴 것만 셉니다 — 같은 이름이 두 파일에 있어도 안 엉킵니다 */
      const before = problems.length

      if (id === null) {
        add(file.name, null, 'ID', '`kb_entry_id` 가 없습니다')
        continue
      }
      if (!isText(entry.step_key)) {
        where('ID', '`step_key` 가 없습니다')
        continue
      }
      if (!isText(entry.title)) where('ID', '`title` 이 없습니다')
      if (typeof entry.step_seq !== 'number') where('ID', '`step_seq` 가 숫자가 아닙니다')

      // ── 근거 — 셋 중 하나라도 비면 거부 ──────────────────────────
      for (const key of ['legal_basis', 'source_url', 'effective_from'] as const) {
        const value = entry[key]
        if (!isText(value) || String(value).includes('TODO')) {
          where('EVIDENCE', `\`${key}\` 가 비었습니다 — 근거 없이 적재하지 않습니다`)
        }
      }
      if (isText(entry.effective_from) && !isDate(entry.effective_from)) {
        where('EVIDENCE', '`effective_from` 이 `YYYY-MM-DD` 가 아닙니다')
      }
      if (entry.effective_until !== null && !isDate(entry.effective_until)) {
        where('EVIDENCE', '`effective_until` 은 `null` 이거나 `YYYY-MM-DD` 여야 합니다')
      }
      if (!isDate(entry.verified_at)) {
        where('EVIDENCE', '`verified_at` 이 `YYYY-MM-DD` 가 아닙니다')
      }

      const body = (entry.body ?? {}) as KbBody

      // ── 누가 하나 ───────────────────────────────────────────────
      // 여기서 안 잡으면 **사건을 만들 때** 500 으로 터집니다 —
      // 2026-08-24 에 실제로 그랬습니다 (`planner` 가 던짐)
      const actor = (body as { actor?: unknown }).actor
      if (typeof actor !== 'string' || !ACTORS.has(actor)) {
        where('ACTOR', `\`body.actor\` 가 없거나 여섯 밖입니다 — \`${String(actor)}\``)
      }

      // ── 슬롯 이름 ───────────────────────────────────────────────
      const requires = Array.isArray(body.requires_slots) ? (body.requires_slots as unknown[]) : []
      for (const slot of requires) {
        if (typeof slot !== 'string' || !isSlotKey(slot)) {
          where('SLOT', `\`requires_slots\` 에 목록 밖 이름 — \`${String(slot)}\``)
        }
      }

      // ── 선행 참조 ───────────────────────────────────────────────
      const after = Array.isArray(body.after) ? (body.after as unknown[]) : []
      const afterKeys: string[] = []
      for (const key of after) {
        if (typeof key !== 'string' || !allStepKeys.has(key)) {
          where('AFTER', `\`after\` 가 없는 단계를 가리킵니다 — \`${String(key)}\``)
          continue
        }
        afterKeys.push(key)
      }
      edges.set(entry.step_key, afterKeys)

      // ── 단계 ────────────────────────────────────────────────────
      const steps = Array.isArray(body.steps) ? (body.steps as KbStep[]) : []
      if (steps.length === 0) where('STEP', '`body.steps` 가 비었습니다')

      steps.forEach((step, i) => {
        const at = `steps[${i}]`
        const action = step.action

        if (typeof action !== 'string' || !ACTIONS.has(action)) {
          where('ACTION', `${at}.action 이 여덟 밖입니다 — \`${String(action)}\``)
        }

        const channel = Array.isArray(step.channel) ? (step.channel as unknown[]) : null
        if (channel === null) {
          where('CHANNEL', `${at}.channel 이 배열이 아닙니다`)
        } else {
          for (const one of channel) {
            if (typeof one !== 'string' || !CHANNELS.has(one)) {
              where('CHANNEL', `${at}.channel 에 목록 밖 값 — \`${String(one)}\``)
            }
          }
          // **행동이 `call`·`visit` 이 아니면 창구가 없어야 합니다.** 「받아적기」에
          // 창구가 붙어 있으면 화면이 열 패널을 잘못 고릅니다
          if (
            typeof action === 'string' &&
            !CHANNEL_ACTIONS.has(action) &&
            channel.length > 0
          ) {
            where(
              'CHANNEL',
              `${at}: \`${action}\` 인데 channel 이 비어 있지 않습니다 (§11.4.5)`,
            )
          }
        }

        if (!isText(step.text)) {
          where('STEP', `${at}.text 가 비었습니다`)
          return
        }
        if (PHONE_IN_TEXT.test(step.text)) {
          where('CONTACT', `${at}.text 에 전화번호가 박혀 있습니다 — \`contact_ref\` 로 (§11.4.1)`)
        }
        if (step.text.includes('http')) {
          where('URL', `${at}.text 에 주소가 박혀 있습니다 — \`url\`·\`contact_ref\` 로 (§11.4.7)`)
        }
      })

      // ── 기한 ────────────────────────────────────────────────────
      const deadline = body.deadline as KbDeadline | null | undefined
      if (deadline !== null && deadline !== undefined) {
        if (!isText(deadline.owner) || !DEADLINE_OWNERS.has(deadline.owner)) {
          where('DEADLINE', `\`deadline.owner\` 가 없거나 셋 밖입니다 — \`${String(deadline.owner)}\``)
        }
        const from = deadline.from
        if (typeof from !== 'string' || !(isSlotKey(from) || ARTIFACT_FROM.test(from))) {
          where(
            'DEADLINE',
            `\`deadline.from\` 이 슬롯 이름도 \`artifact:{kind}\` 도 아닙니다 — \`${String(from)}\``,
          )
        }
      }

      // **어긴 것이 하나라도 있으면 그 항목은 안 옮깁니다.** 반쯤 맞는 절차가
      // 나가는 것이 안 나가는 것보다 나쁩니다
      if (problems.length > before) continue

      rows.push({
        kb_entry_id: id,
        kb_version: opts.kbVersion,
        step_key: entry.step_key,
        step_seq: entry.step_seq as number,
        channel_id: channelId,
        org_id: isText(entry.org_id) ? entry.org_id : null,
        track,
        title: entry.title as string,
        // `_todo`·`_note` 는 파일에만 두는 메모라 DB 로 안 옮깁니다
        body: strip(body),
        legal_basis: entry.legal_basis as string,
        source_url: entry.source_url as string,
        effective_from: entry.effective_from as string,
        effective_until: (entry.effective_until as string | null) ?? null,
        verified_at: entry.verified_at as string,
        released_at: opts.releasedAt,
      })
    }
  }

  for (const key of cycles(edges)) {
    add('(전체)', null, 'CYCLE', `\`after\` 가 서로를 가리킵니다 — \`${key}\` 가 낀 고리`)
  }

  return { rows, problems }
}

/** `_` 로 시작하는 칸은 사람이 보는 메모입니다 — 적재기가 무시합니다 (RFC-002) */
function strip(body: KbBody): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(body)) {
    if (!key.startsWith('_')) out[key] = value
  }
  return out
}

/**
 * `after` 고리를 찾습니다.
 *
 * 고리가 있으면 플랜을 세울 때 **순서를 정할 수 없습니다** — 그리고 그건
 * 무한 루프나 빈 플랜으로 나타나지, 「고리가 있다」로는 안 나타납니다.
 */
function cycles(edges: ReadonlyMap<string, readonly string[]>): readonly string[] {
  const state = new Map<string, 'doing' | 'done'>()
  const found = new Set<string>()

  const walk = (key: string): boolean => {
    const at = state.get(key)
    if (at === 'done') return false
    if (at === 'doing') return true

    state.set(key, 'doing')
    for (const next of edges.get(key) ?? []) {
      if (walk(next)) {
        found.add(key)
        state.set(key, 'done')
        return true
      }
    }
    state.set(key, 'done')
    return false
  }

  for (const key of edges.keys()) walk(key)
  return [...found]
}
