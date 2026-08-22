/**
 * 조립 자리 시험.
 *
 * **여기서 못 박는 것 셋:**
 * 1. 자원이 하나도 안 붙어도 **조립은 성공한다**
 * 2. 안 붙은 자원을 부르면 **조용히 넘어가지 않고 터진다**
 * 3. 문진 문구 자리는 **던지지 않는다** — 사건 생성 경로가 막히지 않는다
 *
 * 3번이 특히 중요합니다. 문구를 「부르면 던지는」 대역으로 두면
 * `slot-checker` 가 빈 슬롯마다 그것을 불러 사건 생성이 100% 실패합니다 —
 * `CLAUDE.md` 불변 규칙 5 와 `slot-checker` 자신의 계약을 한꺼번에 깹니다.
 *
 * 문구는 2026-08-20 에 붙었습니다(코드 상수 → questions.ts). **붙은 뒤에도 3번은
 * 그대로 성립해야 합니다** — 문구가 있다고 해서 질문이 관문이 되면 안 됩니다.
 */

import { describe, expect, it } from 'vitest'

import { createContainer, unconfiguredPorts } from './container'
import { readEnv } from './env'
import { NotConfiguredError, unconfigured } from './not-configured'
import { createQuestionSource, questionsConfigured } from './questions'

/** 아무것도 안 채워진 환경 */
const EMPTY = readEnv({})

describe('아무것도 안 붙어도 조립은 성공한다', () => {
  it('던지지 않는다', () => {
    // 하나 때문에 서버가 안 뜨면 붙어 있는 것도 못 씁니다
    expect(() => createContainer(EMPTY)).not.toThrow()
  })

  it('모듈이 전부 만들어진다', () => {
    const c = createContainer(EMPTY)

    for (const name of [
      'caseIntake',
      'kbFinder',
      'planner',
      'dateChecker',
      'slotChecker',
      'completionChecker',
      'chatReceiver',
      'chatPublisher',
      'auditLogger',
      'casePurger',
      'reminderSender',
    ] as const) {
      expect(c[name], name).toBeDefined()
    }
  })

  it('무엇이 비었는지 목록으로 안다', () => {
    expect(EMPTY.missing).toContain('DATABASE_URL')
    expect(EMPTY.missing).toContain('XAI_API_KEY')
  })

  it('보관 기간은 값이 없으면 180일이다', () => {
    expect(EMPTY.casePurgeDays).toBe(180)
  })

  it('보관 기간에 이상한 값이 오면 기본값으로 떨어진다', () => {
    // 0 이나 음수를 그대로 쓰면 사건이 만들자마자 파기 대상이 됩니다
    for (const bad of ['0', '-5', 'abc', '']) {
      expect(readEnv({ CASE_PURGE_DAYS: bad }).casePurgeDays).toBe(180)
    }
    expect(readEnv({ CASE_PURGE_DAYS: '90' }).casePurgeDays).toBe(90)
  })
})

describe('안 붙은 자원은 조용히 넘어가지 않는다', () => {
  it('부르면 던진다', async () => {
    const c = createContainer(EMPTY)

    await expect(c.caseIntake.open({ track: 'victim' })).rejects.toBeInstanceOf(
      NotConfiguredError,
    )
  })

  it('어느 포트의 어느 메서드였는지 말한다', async () => {
    const port = unconfigured<{ findApplied(): Promise<unknown> }>('KbStore', [
      'DATABASE_URL',
    ])

    try {
      await port.findApplied()
      throw new Error('던졌어야 합니다')
    } catch (error) {
      expect(error).toBeInstanceOf(NotConfiguredError)
      const e = error as NotConfiguredError
      expect(e.message).toContain('KbStore')
      expect(e.message).toContain('findApplied')
      expect(e.detail).toMatchObject({ missingEnv: ['DATABASE_URL'] })
    }
  })

  it('빈 값을 돌려주는 포트가 하나도 없다', () => {
    // 빈 배열을 돌려주면 사건이 「플랜 0단계」로 조용히 생기고
    // 며칠 뒤에야 누가 알아챕니다.
    //
    // **부르는 자리에서 바로 던집니다.** 실제 경로는 전부 비동기 함수 안이라
    // 그 함수의 거부로 바뀌지만(위 「부르면 던진다」 시험), 직접 부르면
    // 약속을 만들기 전에 터집니다 — 더 가까운 자리에서 드러납니다
    const ports = unconfiguredPorts(EMPTY)

    expect(() => ports.kbStore.findApplied({} as never)).toThrow(NotConfiguredError)
    expect(() => ports.kbStore.findReference({} as never)).toThrow(NotConfiguredError)
    expect(() => ports.vault.delete('CASE01')).toThrow(NotConfiguredError)
    expect(() => ports.mailer.send({} as never)).toThrow(NotConfiguredError)
  })

  it('미설정은 재시도 대상이 아니다', () => {
    // 「있는데 지금 안 된다」(503)와 「아직 없다」를 섞으면
    // Retry-After 가 붙어 사용자가 헛되이 다시 누릅니다
    const error = new NotConfiguredError('x', {})

    expect(error.retryable).toBe(false)
    expect(error.httpStatus).toBe(500)
    expect(error.code).toBe('INTERNAL')
  })

  it('들여다보는 것만으로는 안 터진다', () => {
    // 여기서 던지면 console.log 나 await 만 해도 터져 원인을 못 찾습니다
    const port = unconfigured<Record<string, unknown>>('X', [])

    expect(() => JSON.stringify({ port })).not.toThrow()
    expect(() => String(Object.keys(port))).not.toThrow()
  })
})

describe('지금 쓰는 KB 릴리스는 배포 설정이 정한다 — ADR-045', () => {
  it('설정된 값을 그대로 쓴다', async () => {
    const c = createContainer(readEnv({ KB_VERSION: '2026.08.1' }))

    await expect(c.ports.kbVersion.current()).resolves.toBe('2026.08.1')
  })

  it('가장 최근 적재분을 찾아가지 않는다', async () => {
    // 적재기는 검수 중인 다음 버전을 미리 올릴 수 있습니다.
    // 최신 것을 고르면 아직 사람이 안 본 절차가 피해자에게 나갑니다
    const c = createContainer(readEnv({ KB_VERSION: '2026.07.9', DATABASE_URL: 'postgres://x' }))

    await expect(c.ports.kbVersion.current()).resolves.toBe('2026.07.9')
  })

  it('비어 있으면 던진다 — 근거 없는 안내보다 멈춥니다', () => {
    const c = createContainer(EMPTY)

    expect(() => c.ports.kbVersion.current()).toThrow(NotConfiguredError)
  })

  it('무엇이 없는지 말한다', () => {
    const c = createContainer(EMPTY)

    try {
      c.ports.kbVersion.current()
      throw new Error('던졌어야 합니다')
    } catch (error) {
      expect(error).toBeInstanceOf(NotConfiguredError)
      expect((error as NotConfiguredError).detail).toMatchObject({
        missingEnv: ['KB_VERSION'],
      })
    }
  })
})

describe('문진 문구가 붙어도 사건 생성 경로는 막히지 않는다', () => {
  it('슬롯 판정이 던지지 않는다', () => {
    // slot-checker 는 값이 빈 슬롯마다 문구를 부릅니다.
    // 그 자리가 던지면 사건 생성이 100% 실패합니다
    const c = createContainer(EMPTY)

    expect(() => c.slotChecker.check({ slots: [] })).not.toThrow()
  })

  it('질문이 나가도 판정이 함께 나온다 — 질문은 관문이 아니다', () => {
    const c = createContainer(EMPTY)

    const result = c.slotChecker.check({ slots: [] })

    // 문구가 붙었으니 첫 문항이 나옵니다 → questions.ts
    expect(result.nextQuestion?.slotKey).toBe('transferred')
    // **그래도 판정은 같은 응답에 함께 실립니다.** 답을 받고 나서 판정하는 것이
    // 아니라, 안 물어도 이미 나와 있어야 실행 보드가 열립니다
    // 사건 생성 응답의 is_superset 이 여기서 나옵니다
    expect(result.needsSupersetPlan).toBe(true)
    expect(result.t1).toBe('unsatisfied')
  })

  it('문구가 붙었는지 설정 현황이 안다', () => {
    expect(questionsConfigured(createQuestionSource())).toBe(true)
    // 표가 비면 다시 false 로 떨어져야 합니다 — 「붙었다」가 굳어버리면
    // 설정 현황이 거짓말을 하게 됩니다
    expect(questionsConfigured({ formFor: () => undefined })).toBe(false)
  })
})

describe('모듈끼리 안 맞던 자리가 이어진다', () => {
  it('감사 기록 · 재시도 판단 · 매뉴얼 조회가 조립된다', () => {
    // 셋 다 무보정으로 넣으면 타입이 안 맞습니다 (2026-08-20 tsc 로 확인).
    // 이 시험이 통과한다는 것은 어댑터가 그 자리에 있다는 뜻입니다
    const c = createContainer(EMPTY)

    expect(c.casePurger).toBeDefined()
    expect(c.chatReceiver).toBeDefined()
  })

  it('시계가 하나다', () => {
    // 시계가 여러 개면 크론이 UTC 자정 근처에서 하루 어긋납니다
    const c = createContainer(EMPTY)

    expect(c.dateChecker.isBusinessDay('2026-05-01')).toBe(false)
  })
})
