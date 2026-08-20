/**
 * 문진 문구를 내주는 자리.
 *
 * ⬜ **정본이 아직 없습니다** → [핸드오프 ⑤](../../docs/plans/08-16-backend-handoff.md).
 * 후보 셋(코드 상수 · 슬롯 정의 표 · KB)이 올라가 있고 답이 안 채워졌습니다.
 *
 * **문구를 지어내지 않습니다.** 잘못된 질문은 잘못된 답을 부르고, 그 답으로
 * 절차가 갈립니다.
 *
 * **그렇다고 부르면 던지게 두지도 않습니다.** `slot-checker` 는 값이 빈 슬롯마다
 * 이 자리를 부르므로, 던지면 **사건 생성이 통째로 막힙니다** — `CLAUDE.md`
 * 불변 규칙 5(정보가 없어도 멈추지 않는다)와 `slot-checker` 자신의 계약
 * (「어떤 입력에도 예외를 던지지 않습니다」)을 한꺼번에 깹니다.
 *
 * 그래서 **모듈이 이미 정의해 둔 「물을 수 없음」 경로**를 씁니다 —
 * `undefined` 를 돌려주면 `slot-checker` 가 조용히 다음 슬롯으로 넘어가고,
 * 물을 것이 없으면 `nextQuestion: null` 이 됩니다. 계약이 그 값을 허용합니다
 * → 08-14-api.md §3.4 「`null` 이어도 실행 보드는 열립니다」.
 *
 * **비어 있다는 사실은 설정 현황에서 드러냅니다** → [config-report.ts](./config-report.ts).
 */

import 'server-only'

import type { QuestionSource } from '@/modules/slot-checker'

/**
 * 문구가 정해지기 전까지 아무것도 못 묻는 자리.
 *
 * 정본이 정해지면 이 파일만 고칩니다 — 부르는 쪽은 안 바뀝니다.
 */
export function createQuestionSource(): QuestionSource {
  return {
    formFor: () => undefined,
  }
}

/** 문진 문구가 실제로 붙어 있는가. 설정 현황에 씁니다 */
export function questionsConfigured(source: QuestionSource): boolean {
  return source.formFor('transferred') !== undefined
}
