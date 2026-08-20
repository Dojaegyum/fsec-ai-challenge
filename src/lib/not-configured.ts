/**
 * 아직 붙지 않은 자원을 **부르면 즉시 터지는 것**으로 만드는 자리.
 *
 * 근거: ADR-028(모듈은 자원을 인터페이스로 받는다) · CLAUDE.md 불변 규칙
 *
 * **빈 배열·`null`·아무것도 안 하는 대역을 만들지 않습니다.**
 * 그러면 사건이 「플랜 0단계」로 조용히 생기고, 며칠 뒤에야 누가 알아챕니다.
 * 이 서비스에서 조용한 실패는 곧 피해자가 절차를 못 받는 것입니다.
 *
 * 부르는 순간 **어느 포트의 어느 메서드였는지**와 **어떤 환경변수가 비어서인지**를
 * 함께 말하며 멈춥니다.
 */

import 'server-only'

import { AppError } from './errors'

/**
 * 아직 설정되지 않은 자원을 불렀다.
 *
 * **새 `code` 를 지어내지 않습니다.** 정본의 코드 표(08-16-errors.md §3)에
 * 미설정용이 없어, 상속값 그대로 `INTERNAL`·500·재시도 없음입니다.
 *
 * **미설정과 장애를 같은 코드로 내지 않습니다.** `KB_UNAVAILABLE`·
 * `PII_TOKENIZER_UNAVAILABLE`(503)은 「있는데 지금 안 된다」이고 이것은
 * 「아직 없다」입니다. 섞으면 `Retry-After: 10` 이 붙어 **사용자가 10초마다
 * 헛되이 다시 누릅니다.**
 */
export class NotConfiguredError extends AppError {}

/**
 * 어떤 인터페이스든 만족시키되, **어느 메서드를 불러도 던지는** 대역을 만든다.
 *
 * 타입 검사기 앞에서는 `T` 로 통과하므로 조립이 되고, 실행 중에 그 자원이
 * 실제로 필요한 순간에만 멈춥니다. **조립 자체는 성공해야** 합니다 —
 * 미설정 자원 하나 때문에 서버가 아예 안 뜨면 붙어 있는 것도 못 씁니다.
 *
 * @param portName 무엇이 안 붙었나. 오류 메시지에 그대로 나갑니다
 * @param missingEnv 왜 안 붙었나. 채워야 할 환경변수 이름
 */
export function unconfigured<T extends object>(
  portName: string,
  missingEnv: readonly string[],
): T {
  const throwIt = (member: string): never => {
    throw new NotConfiguredError(
      `${portName} 이(가) 아직 설정되지 않았습니다: ${member}`,
      { port: portName, member, missingEnv: [...missingEnv] },
    )
  }

  return new Proxy({} as T, {
    get(_target, prop) {
      // 런타임이 객체를 들여다볼 때 부르는 것들은 던지지 않습니다.
      // 여기서 던지면 console.log 나 await 만 해도 터져 원인을 못 찾습니다
      if (typeof prop === 'symbol') return undefined
      if (prop === 'then' || prop === 'toJSON' || prop === 'constructor') {
        return undefined
      }

      return (...args: unknown[]) => {
        void args
        return throwIt(String(prop))
      }
    },
  })
}

/** 이 포트가 미설정 대역인가. 설정 현황을 찍을 때 씁니다 */
export function isUnconfigured(port: unknown): boolean {
  if (port === null || typeof port !== 'object') return false
  try {
    ;(port as Record<string, () => unknown>).__probe__?.()
    return false
  } catch (error) {
    return error instanceof NotConfiguredError
  }
}
