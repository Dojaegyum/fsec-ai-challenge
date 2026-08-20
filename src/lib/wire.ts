/**
 * 조립본을 **프로세스에 하나만** 두는 자리.
 *
 * 근거: ADR-028 · [container.ts](./container.ts)
 *
 * `createContainer()` 는 부를 때마다 새로 만듭니다. 라우트마다 부르면
 * **요청 하나에 조립본 하나**가 생겨 두 가지가 깨집니다.
 *
 * | 무엇 | 어떻게 깨지나 |
 * | --- | --- |
 * | 속도 제한 | 카운터가 요청마다 새로 나서 **아무도 상한에 안 걸립니다** |
 * | 연결 풀 | DB 드라이버가 붙는 순간 요청마다 커넥션을 새로 엽니다 |
 *
 * 그래서 라우트는 `createContainer()` 를 직접 부르지 않고 **여기를 통해서만**
 * 가져갑니다.
 *
 * ## `globalThis` 에 두는 이유
 *
 * 모듈 최상단의 `let` 하나로는 부족합니다. `next dev` 는 파일이 바뀔 때마다
 * 모듈을 다시 평가하는데, 그때 그 `let` 도 새로 나서 **저장할 때마다 카운터가
 * 0으로 돌아갑니다.** `globalThis` 에 심볼 키로 매달아 두면 모듈이 다시
 * 평가돼도 같은 것을 다시 찾습니다.
 */

import 'server-only'

import { createContainer, unconfiguredPorts, type Container, type Ports } from './container'
import { readEnv, type Env } from './env'

/**
 * 밖에서 오는 자원을 실제 구현으로 바꿔 끼우는 자리.
 *
 * **지금은 하나도 안 붙어 있습니다.** 부르면 무엇이 왜 없는지 말하며 멈춥니다
 * → [not-configured.ts](./not-configured.ts).
 *
 * 붙이는 순서와 각 자리가 무엇을 기다리는지는 아래와 같습니다. 하나를 붙일
 * 때마다 이 함수에서 그 줄만 바꿔 끼우면 됩니다.
 *
 * | 자리 | 무엇을 기다리나 |
 * | --- | --- |
 * | `caseStore`·`kbStore`·`auditStore`·`purgeCaseStore`·`reminderSource` | ⬜ DB 드라이버 미선정 — `package.json` 에 하나도 없습니다 |
 * | `uploads`·`objects` | Supabase Storage (`evidence` 버킷). 접속값은 이미 있습니다 |
 * | `vault` | ⬜ 볼트 제품 미결 → ADR-016 |
 * | `holidays` | ⬜ 정본의 환경변수 표에 공휴일 API 키 이름이 없습니다 |
 * | `tokenizer`·`residualPii` | ⬜ 판별 모델 미선정 → ARCHITECTURE §10 |
 * | `llm` | Grok(xAI). 키는 이미 있습니다 |
 * | `mailer` | ⬜ 발송 수단 미정 → ADR-021 |
 * | `receiptFormat` | ⬜ 기관별 접수번호 포맷의 근거가 없습니다 |
 * | `sentLog` | ⬜ 발송 이력을 남길 칸이 스키마에 없습니다 |
 *
 * **환경변수가 있다고 바로 붙이지 않습니다.** 접속값이 있어도 그것을 쓰는
 * 코드가 있어야 붙은 것입니다 — 지금은 그 코드가 없어 전부 미설정입니다.
 */
export function buildPorts(env: Env): Ports {
  return unconfiguredPorts(env)
}

/** 심볼 키. 문자열 키를 쓰면 다른 코드와 부딪힐 수 있습니다 */
const SLOT = Symbol.for('fin-ally.container')

type Slot = { [SLOT]?: Container }

/**
 * 이 프로세스의 조립본.
 *
 * **여기서도 던지지 않습니다.** 자원이 하나도 안 붙어 있어도 조립은 성공해야
 * 합니다 — 하나 때문에 서버가 안 뜨면 붙어 있는 것도 못 씁니다.
 */
export function getContainer(): Container {
  const slot = globalThis as unknown as Slot
  if (!slot[SLOT]) {
    const env = readEnv()
    slot[SLOT] = createContainer(env, buildPorts(env))
  }
  return slot[SLOT]
}

/**
 * 들고 있던 것을 버린다.
 *
 * **시험에서 씁니다.** 속도 제한 카운터가 시험 사이에 남아 있으면 뒤 시험이
 * 앞 시험의 횟수를 물려받아 조용히 깨집니다.
 */
export function resetContainer(): void {
  const slot = globalThis as unknown as Slot
  delete slot[SLOT]
}
