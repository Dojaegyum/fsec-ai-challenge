/**
 * 지금 무엇이 붙어 있고 무엇이 비어 있는지를 한 화면으로.
 *
 * **값은 절대 찍지 않습니다.** 이름과 붙었는지 여부만 — 계측 헤더가 건수만
 * 담는 것과 같은 규칙입니다 → 08-14-api.md §1.1.
 *
 * 새 API 경로(`/api/health` 같은 것)를 만들지 않았습니다. 계약 §2 의
 * 엔드포인트 목록에 없는 경로를 지어내지 않으려는 것입니다.
 */

import 'server-only'

import type { Container } from './container'
import { has } from './env'
import { isUnconfigured } from './not-configured'
import { questionsConfigured } from './questions'

export interface PortStatus {
  readonly port: string
  readonly configured: boolean
  /** 왜 안 붙었나. 값이 아니라 이름입니다 */
  readonly missing: readonly string[]
  /** 안 붙었을 때 무엇이 안 되나 */
  readonly effect: string
}

export function configReport(container: Container): readonly PortStatus[] {
  const { env, ports } = container

  const row = (
    port: string,
    configured: boolean,
    missing: readonly string[],
    effect: string,
  ): PortStatus => ({ port, configured, missing, effect })

  return [
    row('관계형 DB', has(env, 'DATABASE_URL'), ['DATABASE_URL'],
      '사건을 만들 수도 읽을 수도 없습니다'),
    row('객체 저장소', has(env, 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'),
      ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
      '파일 업로드 자리를 못 냅니다'),
    row('언어모델', has(env, 'XAI_API_KEY'), ['XAI_API_KEY'],
      '챗이 답하지 못합니다'),
    row('볼트', has(env, 'KV_URL', 'VAULT_MASTER_KEY'), ['KV_URL', 'VAULT_MASTER_KEY'],
      '복원 매핑을 못 두고 파기가 한 층에서 멈춥니다 (⬜ 제품 미결)'),
    row('관리자 계정', has(env, 'ADMIN_USERNAME', 'ADMIN_PASSWORD_HASH'),
      ['ADMIN_USERNAME', 'ADMIN_PASSWORD_HASH'],
      '관리자 조회가 열리지 않습니다'),
    row('크론 비밀값', has(env, 'CRON_SECRET'), ['CRON_SECRET'],
      '주기 실행 경로를 밖에서 부를 수 있습니다'),
    row('공휴일', !isUnconfigured(ports.holidays), ['(정본에 키 이름 없음)'],
      '영업일 계산이 멈춥니다'),
    row('개인정보 토큰화', !isUnconfigured(ports.tokenizer), ['(모델 미선정)'],
      '외부 모델로 가는 경로가 막힙니다 — 막히는 것이 맞습니다'),
    row('메일 발송', !isUnconfigured(ports.mailer), ['(발송 수단 미정)'],
      '기한 알림이 안 나갑니다'),
    row('접수번호 형식', !isUnconfigured(ports.receiptFormat), ['(형식 근거 없음)'],
      '접수번호 자동 검증(L1)이 멈춥니다'),
    row('발송 이력', !isUnconfigured(ports.sentLog), ['(스키마에 칸 없음)'],
      '같은 알림이 두 번 나갈 수 있습니다'),
    row('문진 문구', questionsConfigured(container.questions),
      ['(정본 미결 — 핸드오프 ⑤)'],
      '질문이 안 나갑니다. **사건 생성·플랜은 그대로 돕니다**'),
  ]
}

/** 사람이 읽는 한 화면 */
export function formatConfigReport(rows: readonly PortStatus[]): string {
  const lines = rows.map((one) => {
    const mark = one.configured ? '  ✓' : '  ✗'
    const why = one.configured ? '' : `  ← ${one.missing.join(' · ')}`
    return `${mark} ${one.port.padEnd(16)}${why}`
  })

  const off = rows.filter((one) => !one.configured)
  lines.push('')
  lines.push(`  붙음 ${rows.length - off.length} / ${rows.length}`)
  for (const one of off) lines.push(`    · ${one.port}: ${one.effect}`)

  return lines.join('\n')
}
