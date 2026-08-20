/**
 * 사건 하나의 생애를 끝까지 이어 보는 시험 — 모듈이 연쇄로 맞물리는지 확인한다.
 *
 * 각 모듈은 자기 시험을 따로 갖고 있다. 이 파일은 **그 사이의 이음매**만 본다 —
 * 한쪽이 내놓는 것을 다른 쪽이 받을 수 있는지, 변환이 필요한 자리가 어디인지.
 *
 * 챗 한 턴은 [chat-turn.test.ts](./chat-turn.test.ts)가 따로 본다. 여기는
 * **몇 달에 걸친 사건 관리**를 본다 — 접수부터 파기까지.
 *
 *   case-intake → kb-finder → planner → date-checker
 *     → completion-checker → planner 재생성 → reminder-sender → case-purger
 *
 * 정본 흐름: spec/common/08-16-module-boundaries.md 「데이터 흐름 한 줄 요약」
 */

import { describe, expect, it } from 'vitest'

import { createAuditLogger } from '@/modules/audit-logger'
import type { AuditRecord, AuditStore } from '@/modules/audit-logger'
import { createCaseIntake } from '@/modules/case-intake'
import { createCasePurger } from '@/modules/case-purger'
import { createCompletionChecker } from '@/modules/completion-checker'
import { createDateChecker } from '@/modules/date-checker'
import { createKbFinder } from '@/modules/kb-finder'
import type { KbRow } from '@/modules/kb-finder'
import { createPlanner } from '@/modules/planner'
import type { ExistingStep, KbStep } from '@/modules/planner'
import { createReminderSender } from '@/modules/reminder-sender'
import { createSlotChecker } from '@/modules/slot-checker'

const TODAY = '2026-08-20'
const NOW = '2026-08-20T09:00:00+09:00'
const KB_VERSION = '2026.08.1'

/** 은행 이체 사건의 매뉴얼 세 항목. 사람이 써서 검수한 것으로 본다 */
function kbRow(over: Partial<KbRow> & Pick<KbRow, 'kbEntryId' | 'stepKey'>): KbRow {
  return {
    kbVersion: KB_VERSION,
    stepSeq: 10,
    channelId: null,
    orgId: null,
    track: 'victim',
    title: '제목',
    body: { actor: 'victim' },
    legalBasis: '통신사기피해환급법 시행령 제3조',
    sourceUrl: 'https://www.law.go.kr/...',
    effectiveFrom: '2026-07-01',
    effectiveUntil: null,
    verifiedAt: '2026-08-16',
    ...over,
  }
}

const APPLIED: KbRow[] = [
  kbRow({
    kbEntryId: 'report-112',
    stepKey: 'report-112',
    stepSeq: 10,
    title: '112에 신고하기',
  }),
  kbRow({
    kbEntryId: 'kb-bank-freeze',
    stepKey: 'bank-freeze-request',
    stepSeq: 20,
    channelId: 'CH-bank',
    orgId: 'kb-bank',
    title: '국민은행에 지급정지 요청',
    body: { actor: 'victim' },
  }),
  // 같은 단계의 유형 기본. 기관 전용이 있으므로 병합에서 빠져야 한다
  kbRow({
    kbEntryId: 'generic-bank-freeze',
    stepKey: 'bank-freeze-request',
    stepSeq: 20,
    channelId: 'CH-bank',
    title: '송금은행에 지급정지 요청',
  }),
  kbRow({
    kbEntryId: 'relief-application',
    stepKey: 'relief-apply',
    stepSeq: 30,
    channelId: 'CH-bank',
    title: '피해구제 신청서 제출',
    body: {
      actor: 'victim',
      // 지급정지가 끝나야 켜진다
      after: ['bank-freeze-request'],
      requiresSlots: ['relief_applied_at'],
      deadline: { kind: 'business_days', amount: 3, from: 'relief_applied_at' },
    },
  }),
]

/** kb-finder 의 행을 planner 가 받는 모양으로 옮긴다 — 이음매 하나 */
function toPlannerStep(row: KbRow): KbStep {
  return {
    kbEntryId: row.kbEntryId,
    kbVersion: row.kbVersion,
    stepKey: row.stepKey,
    stepSeq: row.stepSeq,
    channelId: row.channelId,
    title: row.title,
    sourceUrl: row.sourceUrl,
    effectiveFrom: row.effectiveFrom,
    body: row.body as KbStep['body'],
  }
}

function auditSpy() {
  const written: AuditRecord[] = []
  const store: AuditStore = {
    lastHash: async () => written.at(-1)?.hash ?? null,
    append: async (record) => {
      written.push(record)
    },
  }
  return { store, written }
}

describe('사건 하나가 접수부터 파기까지 이어진다', () => {
  it('접수 → 조회 → 플랜 → 기한 → 완료 → 재생성', async () => {
    // ── 1. 접수 ─────────────────────────────────────────────
    const intake = createCaseIntake({
      ids: { next: () => 'CASE01' },
      clock: { now: () => NOW, today: () => TODAY },
      dates: createDateChecker({
        holidays: { isPublicHoliday: () => false },
        clock: { today: () => TODAY },
      }),
      store: {
        createCase: async () => {},
        evidenceTotals: async () => ({ count: 0, bytes: 0 }),
        addEvidence: async () => {},
        markUploaded: async () => 'processing',
        touchPurgeAfter: async () => {},
      },
      uploads: {
        issue: async () => ({ objectKey: 'k', url: 'u', expiresAt: NOW }),
      },
    })

    const opened = await intake.open({ track: 'victim' })

    expect(opened.status).toBe('intake')
    // 마지막 활동일부터 180일 → 09-data-model.md §2
    expect(opened.purgeAfter).toBe('2027-02-16')
    // 플랜은 여기서 안 붙는다 — 인용이 필요하고 그건 planner 의 일이다
    expect(opened).not.toHaveProperty('plan')

    // ── 2. 매뉴얼 조회 ───────────────────────────────────────
    const kbFinder = createKbFinder({
      store: {
        findApplied: async () => APPLIED,
        findReference: async () => [],
      },
    })

    const groups = await kbFinder.find({
      kbVersion: KB_VERSION,
      track: opened.track,
      channelId: 'CH-bank',
      orgId: 'kb-bank',
      asOf: TODAY,
    })

    // 같은 단계가 둘인데 기관 전용만 남는다 — 안 그러면 화면에 두 번 뜬다
    expect(groups.applied.map((one) => one.kbEntryId)).toEqual([
      'report-112',
      'kb-bank-freeze',
      'relief-application',
    ])

    // ── 3. 첫 플랜 ───────────────────────────────────────────
    const planner = createPlanner({ clock: { now: () => NOW } })

    const first = planner.build({
      caseId: opened.caseId,
      applied: groups.applied.map(toPlannerStep),
      slots: [],
    })

    // 조건 없는 둘만 켜진다. 피해구제 신청은 지급정지가 끝나야 한다
    expect(first.upsert.map((one) => one.stepKey)).toEqual([
      'report-112',
      'bank-freeze-request',
    ])
    // 근거 넷이 전부 실려 나간다 → 09-data-model.md §6
    expect(first.upsert[1]).toMatchObject({
      kbEntryId: 'kb-bank-freeze',
      kbVersion: KB_VERSION,
      sourceUrl: 'https://www.law.go.kr/...',
      effectiveFrom: '2026-07-01',
    })

    // ── 4. 지급정지를 끝내고 접수 문자를 올림 ─────────────────
    const completion = createCompletionChecker({
      receiptFormat: { matches: () => true },
    })

    const verdict = completion.verify({
      submission: { kind: 'sms_capture', evidenceId: 'EV01' },
    })

    expect(verdict.verifyLevel).toBe('L2')
    expect(verdict.stepState).toBe('done_verified')

    // ── 5. 플랜 재생성 ───────────────────────────────────────
    // **이음매: completion-checker 의 stepState 가 planner 의 existing 으로 간다**
    const existing: ExistingStep[] = [
      { stepKey: 'report-112', state: 'not_started' },
      { stepKey: 'bank-freeze-request', state: verdict.stepState },
    ]

    const second = planner.build({
      caseId: opened.caseId,
      applied: groups.applied.map(toPlannerStep),
      slots: [{ slotKey: 'relief_applied_at', state: 'confirmed' }],
      existing,
    })

    // 피해구제 신청이 새로 켜졌다
    expect(second.upsert.map((one) => one.stepKey)).toEqual([
      'report-112',
      'relief-apply',
    ])
    // 완료된 단계는 내용을 안 건드리되 표시 순서는 새 플랜을 따른다
    expect(second.preserved).toEqual([{ stepKey: 'bank-freeze-request', seq: 2 }])
    expect(second.skipped).toEqual([])

    // ── 6. 기한 계산 ─────────────────────────────────────────
    // **이음매: KB 의 deadline 객체가 date-checker 의 rule 로 간다**
    const dateChecker = createDateChecker({
      holidays: { isPublicHoliday: () => false },
      clock: { today: () => TODAY },
    })

    const deadline = dateChecker.compute({
      anchor: { source: 'relief_applied_at', date: TODAY, confirmed: true },
      rule: { kind: 'business_days', amount: 3 },
      kind: 'primary',
    })

    // 8/20(목) 기산 → 금 1, (주말) 월 2, 화 3
    expect(deadline.dueDate).toBe('2026-08-25')
    expect(deadline.estimated).toBe(false)
  })
})

describe('정보가 모자라도 멈추지 않는다', () => {
  it('송금 수단을 모르면 공통만 나오고 슬롯 질문이 하나 붙는다', async () => {
    // 유형을 몰라도 조회는 된다 — 공통(T0)만 나온다
    const kbFinder = createKbFinder({
      store: {
        findApplied: async () => [APPLIED[0]],
        findReference: async () => [],
      },
    })

    const groups = await kbFinder.find({
      kbVersion: KB_VERSION,
      track: 'victim',
      channelId: null,
      orgId: null,
      asOf: TODAY,
    })

    const planner = createPlanner({ clock: { now: () => NOW } })
    const plan = planner.build({
      caseId: 'CASE01',
      applied: groups.applied.map(toPlannerStep),
      slots: [],
      superset: true,
    })

    // 아무것도 몰라도 112 신고는 나간다
    expect(plan.upsert.map((one) => one.stepKey)).toEqual(['report-112'])

    // **이음매: slot-checker 의 판정이 planner 의 superset 으로 간다**
    const slotChecker = createSlotChecker({
      questions: {
        formFor: (slotKey) =>
          slotKey === 'transferred'
            ? { input: 'buttons', text: '돈을 보내셨나요?', options: ['네', '아니오'] }
            : undefined,
      },
    })

    const slots = slotChecker.check({ slots: [] })

    expect(slots.needsSupersetPlan).toBe(true)
    expect(slots.nextQuestion?.slotKey).toBe('transferred')
    // 「모름」이 자동으로 붙는다
    expect(slots.nextQuestion?.options).toContain('모름·기억 안 남')
  })
})

describe('기한이 다가오면 알린다 — 확정된 것만', () => {
  it('확정 기한은 보내고 추정 기한은 건너뛴다', async () => {
    const dateChecker = createDateChecker({
      holidays: { isPublicHoliday: () => false },
      clock: { today: () => TODAY },
    })

    const sentTo: string[] = []
    const reminder = createReminderSender({
      source: {
        findDeadlines: async () => [
          {
            deadlineId: 'D1',
            caseId: 'CASE01',
            kind: 'primary',
            status: 'open',
            dueDate: '2026-08-21',
            confirmed: true,
          },
          {
            deadlineId: 'D2',
            caseId: 'CASE02',
            kind: 'primary',
            status: 'open',
            dueDate: '2026-08-21',
            // 부산물이 아직 없다 — 추정 기한이다
            confirmed: false,
          },
        ],
        findUnconfirmedSteps: async () => [],
        findContacts: async () => [
          { caseId: 'CASE01', email: 'a@example.com' },
          { caseId: 'CASE02', email: 'b@example.com' },
        ],
      },
      sentLog: { sentAlready: async () => false, markSent: async () => {} },
      mailer: {
        send: async (one) => {
          sentTo.push(one.caseId)
        },
      },
      clock: { today: () => TODAY },
      // **이음매: date-checker 의 daysLeft 를 그대로 받는다**
      dates: dateChecker,
    })

    const run = await reminder.run({ daysBefore: 1 })

    expect(sentTo).toEqual(['CASE01'])
    expect(run.skipped).toEqual([{ caseId: 'CASE02', reason: 'not_confirmed' }])
  })
})

describe('보관 기간이 지나면 세 층이 함께 사라진다', () => {
  it('전부 지워야 감사 기록이 남는다', async () => {
    const audit = auditSpy()
    const logger = createAuditLogger({
      store: audit.store,
      now: () => '2027-02-17T03:00:00+09:00',
      newId: () => 'AUDIT01',
    })

    const purger = createCasePurger({
      cases: {
        findDue: async () => [{ caseId: 'CASE01', purgeAfter: '2027-02-16' }],
        delete: async () => {},
        remains: async () => false,
      },
      objects: { deleteAll: async () => {}, remains: async () => false },
      vault: { delete: async () => {}, remains: async () => false },
      // **이음매: case-purger 의 기록이 audit-logger 를 그대로 탄다**
      audit: {
        record: async (event) => {
          await logger.record(event)
        },
      },
      clock: { today: () => '2027-02-17' },
    })

    const run = await purger.run()

    expect(run.purged).toEqual(['CASE01'])
    expect(audit.written).toHaveLength(1)
    expect(audit.written[0].eventType).toBe('case.purged')
    // 해시 사슬의 첫 줄이라 앞이 없다
    expect(audit.written[0].prevHash).toBeNull()
  })

  it('한 층이라도 남으면 감사 기록을 남기지 않는다', async () => {
    const audit = auditSpy()
    const logger = createAuditLogger({
      store: audit.store,
      now: () => '2027-02-17T03:00:00+09:00',
      newId: () => 'AUDIT01',
    })

    const purger = createCasePurger({
      cases: {
        findDue: async () => [{ caseId: 'CASE01', purgeAfter: '2027-02-16' }],
        delete: async () => {},
        remains: async () => false,
      },
      // 객체 저장소에 파일이 남았다
      objects: { deleteAll: async () => {}, remains: async () => true },
      vault: { delete: async () => {}, remains: async () => false },
      audit: {
        record: async (event) => {
          await logger.record(event)
        },
      },
      clock: { today: () => '2027-02-17' },
    })

    const run = await purger.run()

    expect(run.purged).toEqual([])
    expect(run.failed[0].remaining).toEqual(['objects', 'database'])
    // 지우지 않은 것을 지웠다고 기록하지 않는다
    expect(audit.written).toEqual([])
  })
})
