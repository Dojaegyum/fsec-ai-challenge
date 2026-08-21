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
    // 5단계 전에는 「밖에서 부를 수 있습니다」였습니다. 문지기(proxy.ts)가
    // 붙은 뒤로 정반대가 됐습니다 — 비교할 값이 없으면 **전부 막습니다**.
    // 설명이 낡으면 운영자가 유입 차단을 찾는 동안 파기가 계속 멈춰 있습니다
    row('크론 비밀값', has(env, 'CRON_SECRET'), ['CRON_SECRET'],
      '크론 경로가 전부 401 입니다 — 사건 파기·기한 알림이 한 번도 안 돕니다'),
    row('공휴일', !isUnconfigured(ports.holidays), ['(정본에 키 이름 없음)'],
      '영업일 계산이 멈춥니다'),
    // 1차 정규식은 붙어 있습니다. 이 줄은 2차(이름 탐지)만 봅니다 —
    // 착수 기준선이 「NER 을 기다리지 않는다」로 정했고, 대신 안 붙은 것을 드러냅니다
    row('개인정보 2차 탐지', container.ports.ner !== null, ['(모델 미선정)'],
      '1차 정규식은 돕니다. **이름이 안 걸립니다** — 그 전에는 외부 모델에 실데이터를 보내지 않습니다'),
    // 이 두 줄은 「붙었나」만이 아니라 **어느 쪽에 붙었나**가 중요합니다 —
    // 격리 경계 이전이라, 원격 API 를 끼우면 녹음·캡처 원문이 그대로 밖으로 나갑니다
    // → ARCHITECTURE.md §6 「경계의 가장 약한 고리」
    row('녹음 전사', !isUnconfigured(ports.stt), ['(제품 미선정 — ARCHITECTURE §6)'],
      '녹음을 올려도 글로 안 옮겨집니다. **사건 진행은 그대로 돕니다**'),
    row('이미지 판독', !isUnconfigured(ports.ocr), ['(제품 미선정 — ARCHITECTURE §6)'],
      '캡처를 올려도 글자를 못 읽습니다. **사건 진행은 그대로 돕니다**'),
    row('메일 발송', !isUnconfigured(ports.mailer), ['(발송 수단 미정)'],
      '기한 알림이 안 나갑니다'),
    row('접수번호 형식', !isUnconfigured(ports.receiptFormat), ['(형식 근거 없음)'],
      '접수번호 자동 검증(L1)이 멈춥니다'),
    row('발송 이력', !isUnconfigured(ports.sentLog), ['(스키마에 칸 없음)'],
      '같은 알림이 두 번 나갈 수 있습니다'),
    // 정본은 2026-08-20 에 코드 상수로 정해졌습니다(핸드오프 ⑤). 그래서 이 줄이
    // 비어 있다면 이유는 「미결」이 아니라 **표가 비었다** 하나뿐입니다
    row('문진 문구', questionsConfigured(container.questions),
      ['(lib/questions.ts 의 문구 표가 비었습니다)'],
      '질문이 안 나갑니다. **사건 생성·플랜은 그대로 돕니다**'),
    // 세기는 셉니다. 다만 프로세스 하나 안에서만이라, 인스턴스가 여럿이면
    // 실효 상한이 그 수만큼 늘어납니다 → rate-limit.ts
    row('속도 제한 저장소', container.rateLimiter.storeKind === 'shared',
      ['(정본 §1.3 TODO — 저장 위치 미정)'],
      '프로세스 안에서만 셉니다. 인스턴스가 여럿이면 실효 상한이 그만큼 늘어납니다'),
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
