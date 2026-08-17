/**
 * pii-restorer — 복원해도 되는 토큰인지 검사하고 되돌린다.
 *
 * 정본: spec/common/08-14-pii-boundary.md 「복원 위치와 범위」·「복원 전 검사」
 *       spec/backend/08-16-chat-context.md §8
 * 근거: ADR-009 · ADR-011 · ADR-013 · ADR-021
 *
 * ⚠️ 브라우저 전용입니다. `client-only` 를 들여 **서버에서 import 하면 빌드가 깨지게**
 * 해 두었습니다 — 서버에 복원 함수가 생기는 것 자체가 CLAUDE.md 불변 규칙 3 위반이라,
 * 문서로 부탁하지 않고 구조로 막습니다 (ADR-021 다섯).
 */

import 'client-only'

import type {
  PiiRestorer,
  RestoreAuditSink,
  RestoreSite,
  TokenMappingSource,
} from './contract'

export type {
  DenyEvent,
  DenyReason,
  PiiRestorer,
  RestoreAuditSink,
  RestoreSite,
  TokenKind,
  TokenMapping,
  TokenMappingSource,
} from './contract'

/**
 * `[계좌-1]` 꼴만 토큰으로 본다.
 *
 * 종류 이름 뒤에 반드시 `-숫자` 가 붙는다 → 08-14-pii-boundary.md 「2중 스크러빙」.
 * `[참고]` 처럼 숫자 꼬리가 없는 대괄호는 건드리지 않는다.
 */
const TOKEN_PATTERN = /\[[^[\]\n]+-\d+\]/g

/**
 * 자리마다 어디까지 되돌리는가. **이 표가 곧 복원 가능 목록입니다** →
 * 08-14-pii-boundary.md 「복원 위치와 범위」.
 *
 * 위치마다 범위가 다른 것은 우연이 아니라 **인젝션으로 끌려 나올 수 있는 자리인지**로
 * 가른 결과다. 챗 답변은 사기범이 심은 문장으로 끌어낼 수 있어 부분만 되돌리고,
 * 서류 초안과 슬롯 확인 화면은 사용자가 직접 연 자리라 전체를 되돌린다.
 */
const SITE_POLICY: Readonly<Record<RestoreSite, 'full' | 'partial' | 'none'>> = {
  slot_value: 'full',
  document_field: 'full',
  user_input: 'full',
  transcript_view: 'full',
  chat_reply: 'partial',
  analysis_text: 'none',
  plan_text: 'none',
}

/**
 * 챗 답변에서 종류별로 어디까지 보여주는가.
 *
 * **여기 없는 종류는 되돌리지 않는다.** 주민번호가 대표적인데, 생년월일 자체가
 * 본인확인 수단이고 사건에 하나뿐이라 「어느 것인지 구분」이라는 부분 복원의 목적이
 * 성립하지 않기 때문이다 → 08-16-chat-context.md §8.1.
 */
const PARTIAL_MASK: Readonly<Record<string, (value: string) => string>> = {
  account: maskAccount,
  name: maskName,
  phone: maskPhone,
}

export function createPiiRestorer(deps: {
  mappings: TokenMappingSource
  audit: RestoreAuditSink
}): PiiRestorer {
  const { mappings, audit } = deps

  return {
    restore(text: string, site: RestoreSite): string {
      const policy = SITE_POLICY[site]

      // 1. 그 자리가 복원 가능 목록에 있는가 → §8.2
      //    없으면 조회조차 하지 않는다. 정책상 정상 동작이라 거부 기록도 남기지 않는다 —
      //    여기까지 기록하면 로그가 공격 신호를 덮는다
      if (policy === 'none') return text

      return text.replace(TOKEN_PATTERN, (token) => {
        // 2. 그 토큰이 이 사건의 매핑에 실제로 있는가 → §8.2
        const mapping = mappings.lookup(token)
        if (!mapping) {
          // 3. 거부되면 기록을 남긴다. 반복되면 공격 시도의 신호다 → §8.3
          audit.denied({ token, site, reason: 'not_in_mapping' })
          return token
        }

        if (policy === 'full') return mapping.value

        const mask = PARTIAL_MASK[mapping.kind]
        // 규칙이 없는 종류는 되돌리지 않는다. 파란 토큰 그대로 화면에 남는다
        return mask ? mask(mapping.value) : token
      })
    },
  }
}

/** `110-234-567890` → `****7890`. 어느 계좌인지 알아볼 수 있을 만큼만 남긴다 */
function maskAccount(value: string): string {
  const digits = value.replace(/\D/g, '')
  if (digits.length < 4) return '****'
  return `****${digits.slice(-4)}`
}

/** `010-1234-5678` → `010-****-5678` */
function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '')
  // 앞 3자리와 뒤 4자리가 겹칠 만큼 짧으면 통째로 가린다
  if (digits.length < 7) return '****'
  return `${digits.slice(0, 3)}-****-${digits.slice(-4)}`
}

/** `김철수` → `김O수`, 두 글자면 `박영` → `박O` */
function maskName(value: string): string {
  // 코드 포인트 단위로 센다. 한글 이름에 결합 문자가 섞여도 글자 수가 어긋나지 않는다
  const letters = [...value.trim()]
  if (letters.length <= 1) return 'O'
  if (letters.length === 2) return `${letters[0]}O`
  return `${letters[0]}${'O'.repeat(letters.length - 2)}${letters[letters.length - 1]}`
}
