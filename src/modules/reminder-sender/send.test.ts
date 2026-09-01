/**
 * reminder-sender 시험.
 *
 * 검증 대상은 spec/common/08-16-module-names.md 층 4 ·
 * spec/common/08-16-deadline-rules.md · ADR-021 입니다.
 */

import { describe, expect, it, vi } from 'vitest'

import { createReminderSender } from './send'
import type {
  CaseContact,
  DeadlineCandidate,
  Reminder,
  ReminderWindow,
  StepCandidate,
} from './types'

const TODAY = '2026-08-20'

function deadline(over: Partial<DeadlineCandidate> = {}): DeadlineCandidate {
  return {
    deadlineId: 'D1',
    caseId: 'CASE01',
    kind: 'primary',
    status: 'open',
    dueDate: '2026-08-21',
    confirmed: true,
    ...over,
  }
}

function step(over: Partial<StepCandidate> = {}): StepCandidate {
  return {
    planStepId: 'S1',
    caseId: 'CASE01',
    state: 'unconfirmed',
    title: '피해구제 신청',
    ...over,
  }
}

/** 만기일과 오늘의 날짜 차이. date-checker 의 daysLeft 와 같은 계약입니다 */
const dates = {
  daysLeft(dueDate: string) {
    const day = (d: string) => new Date(`${d}T00:00:00Z`).getTime()
    return Math.round((day(dueDate) - day(TODAY)) / 86_400_000)
  },
}

function sender(
  over: {
    deadlines?: DeadlineCandidate[]
    steps?: StepCandidate[]
    contacts?: CaseContact[]
    sentKeys?: string[]
    mailThrows?: boolean
    window?: Partial<ReminderWindow>
  } = {},
) {
  const sentKeys = new Set(over.sentKeys ?? [])
  const send = vi.fn(async (reminder: Reminder) => {
    if (over.mailThrows) throw new Error(`발송 실패: ${reminder.caseId}`)
  })
  const markSent = vi.fn(async (key: string) => {
    sentKeys.add(key)
  })
  const findContacts = vi.fn(
    async () => over.contacts ?? [{ caseId: 'CASE01', email: 'a@example.com', linkToken: '01LINKTOKENTESTTESTTESTTES' }],
  )

  const reminder = createReminderSender({
    source: {
      findDeadlines: async () => over.deadlines ?? [],
      findUnconfirmedSteps: async () => over.steps ?? [],
      findContacts,
    },
    sentLog: {
      sentAlready: async (key) => sentKeys.has(key),
      markSent,
    },
    mailer: { send },
    clock: { today: () => TODAY },
    dates,
  })

  return { reminder, send, markSent, findContacts, window: over.window }
}

describe('보낼 수 없는 사건은 건너뛴다 — 실패가 아니다', () => {
  it('이메일이 없으면 안 보낸다', async () => {
    // 이메일은 선택입니다. 없는 사건도 정상 사건입니다 → ADR-021
    const { reminder, send } = sender({
      deadlines: [deadline()],
      contacts: [{ caseId: 'CASE01', email: null, linkToken: '01LINKTOKENTESTTESTTESTTES' }],
    })

    const run = await reminder.run()

    expect(send).not.toHaveBeenCalled()
    expect(run.skipped).toEqual([{ caseId: 'CASE01', reason: 'no_email' }])
    expect(run.failed).toEqual([])
  })

  it('연락처를 새로 요구하지 않는다', async () => {
    // 요구하는 흐름을 만들면 ADR-021 위반입니다
    const { reminder } = sender({
      deadlines: [deadline()],
      contacts: [{ caseId: 'CASE01', email: null, linkToken: '01LINKTOKENTESTTESTTESTTES' }],
    })

    const run = await reminder.run()

    expect(run.sent).toEqual([])
    expect(JSON.stringify(run)).not.toContain('ask')
  })

  it('확정 안 된 기한으로는 알리지 않는다', async () => {
    // 부산물이 없으면 추정일 뿐입니다. 메일로 보내면 사용자는 확정으로 읽습니다
    const { reminder, send } = sender({
      deadlines: [deadline({ confirmed: false })],
    })

    const run = await reminder.run()

    expect(send).not.toHaveBeenCalled()
    expect(run.skipped).toEqual([{ caseId: 'CASE01', reason: 'not_confirmed' }])
  })

  it('같은 사건에 확정 기한이 하나라도 있으면 그것만 보낸다', async () => {
    const { reminder, send } = sender({
      deadlines: [
        deadline({ deadlineId: 'D1', confirmed: false }),
        deadline({ deadlineId: 'D2', confirmed: true }),
      ],
    })

    await reminder.run()

    expect(send.mock.calls[0][0].deadlines.map((one) => one.deadlineId)).toEqual([
      'D2',
    ])
  })

  it('이미 지킨 기한은 알리지 않는다', async () => {
    const { reminder, send } = sender({ deadlines: [deadline({ status: 'met' })] })

    const run = await reminder.run()

    expect(send).not.toHaveBeenCalled()
    expect(run.sent).toEqual([])
  })
})

describe('언제 알리나', () => {
  it('창에 들면 알린다', async () => {
    const { reminder, send } = sender({ deadlines: [deadline({ dueDate: '2026-08-21' })] })

    await reminder.run({ daysBefore: 1 })

    expect(send).toHaveBeenCalledTimes(1)
  })

  it('아직 멀면 알리지 않는다', async () => {
    const { reminder, send } = sender({ deadlines: [deadline({ dueDate: '2026-08-25' })] })

    await reminder.run({ daysBefore: 1 })

    expect(send).not.toHaveBeenCalled()
  })

  it('창을 넓히면 알린다', async () => {
    const { reminder, send } = sender({ deadlines: [deadline({ dueDate: '2026-08-25' })] })

    await reminder.run({ daysBefore: 7 })

    expect(send).toHaveBeenCalledTimes(1)
  })

  it('지난 기한도 알린다 — 유예가 남아 있을 수 있다', async () => {
    const { reminder, send } = sender({ deadlines: [deadline({ dueDate: '2026-08-15' })] })

    await reminder.run()

    expect(send.mock.calls[0][0].reason).toBe('deadline_passed')
  })

  it('지난 기한이 섞이면 그쪽을 이유로 삼는다', async () => {
    // 유예가 남아 있을 수 있어 더 급합니다
    const { reminder, send } = sender({
      deadlines: [
        deadline({ deadlineId: 'D1', dueDate: '2026-08-21' }),
        deadline({ deadlineId: 'D2', dueDate: '2026-08-15' }),
      ],
    })

    await reminder.run()

    expect(send.mock.calls[0][0].reason).toBe('deadline_passed')
  })

  it('미확인 단계만 있어도 알린다', async () => {
    const { reminder, send } = sender({ steps: [step()] })

    await reminder.run()

    expect(send.mock.calls[0][0].reason).toBe('step_unconfirmed')
  })

  it('미확인이 아닌 단계는 세지 않는다', async () => {
    const { reminder, send } = sender({ steps: [step({ state: 'in_progress' })] })

    await reminder.run()

    expect(send).not.toHaveBeenCalled()
  })
})

describe('같은 것을 두 번 보내지 않는다', () => {
  it('이미 보낸 것은 건너뛴다', async () => {
    const first = sender({ deadlines: [deadline()] })
    await first.reminder.run()
    const key = first.send.mock.calls[0][0].dedupeKey

    const second = sender({ deadlines: [deadline()], sentKeys: [key] })
    const run = await second.reminder.run()

    expect(second.send).not.toHaveBeenCalled()
    expect(run.skipped).toEqual([{ caseId: 'CASE01', reason: 'already_sent' }])
  })

  it('알릴 것이 늘면 다시 보낸다', async () => {
    const one = sender({ deadlines: [deadline({ deadlineId: 'D1' })] })
    await one.reminder.run()
    const key = one.send.mock.calls[0][0].dedupeKey

    const two = sender({
      deadlines: [deadline({ deadlineId: 'D1' }), deadline({ deadlineId: 'D2' })],
      sentKeys: [key],
    })
    await two.reminder.run()

    expect(two.send).toHaveBeenCalledTimes(1)
  })

  it('조회 순서가 바뀌어도 같은 열쇠가 나온다', async () => {
    const forward = sender({
      deadlines: [deadline({ deadlineId: 'D1' }), deadline({ deadlineId: 'D2' })],
    })
    const backward = sender({
      deadlines: [deadline({ deadlineId: 'D2' }), deadline({ deadlineId: 'D1' })],
    })

    await forward.reminder.run()
    await backward.reminder.run()

    const a = forward.send.mock.calls[0][0].dedupeKey
    const b = backward.send.mock.calls[0][0].dedupeKey
    expect(a).toBe(b)
  })

  it('보낸 뒤에 표시한다 — 먼저 표시하고 실패하면 영영 안 갑니다', async () => {
    const { reminder, markSent } = sender({
      deadlines: [deadline()],
      mailThrows: true,
    })

    await reminder.run()

    expect(markSent).not.toHaveBeenCalled()
  })
})

describe('한 사건이 실패해도 나머지를 계속한다', () => {
  it('발송 실패를 결과로 돌려준다', async () => {
    const { reminder } = sender({ deadlines: [deadline()], mailThrows: true })

    const run = await reminder.run()

    expect(run.sent).toEqual([])
    expect(run.failed).toEqual([
      { caseId: 'CASE01', error: expect.stringContaining('발송 실패') },
    ])
  })

  it('예외를 던지지 않는다', async () => {
    const { reminder } = sender({ deadlines: [deadline()], mailThrows: true })

    await expect(reminder.run()).resolves.toBeDefined()
  })
})

describe('알릴 것이 없으면 조용히 끝난다', () => {
  it('연락처를 조회하지도 않는다', async () => {
    const { reminder, findContacts } = sender()

    const run = await reminder.run()

    expect(run).toEqual({ sent: [], skipped: [], failed: [] })
    expect(findContacts).not.toHaveBeenCalled()
  })
})
