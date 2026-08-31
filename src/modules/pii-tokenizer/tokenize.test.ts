/**
 * 격리 경계 시험.
 *
 * 검증 대상: spec/common/08-14-pii-boundary.md · CLAUDE.md 불변 규칙 2
 *            spec/common/08-16-module-boundaries.md 서버 표
 *
 * **여기서 못 박는 것 다섯:**
 * 1. 정규식이 잡는 넷은 2차에서도 잡힌다 (브라우저를 안 거친 경로가 있다)
 * 2. 제외 목록이 NER 결과보다 우선한다 — 어기면 8유형 분기가 무너진다
 * 3. 같은 값은 같은 토큰. 이어 부르면 번호가 이어진다
 * 4. 모델을 못 쓰면 통과시키지 않고 멈춘다
 * 5. 토큰화 후에 원문이 남으면 그 자리에서 멈춘다
 */

import { describe, expect, it } from 'vitest'

import { PiiTokenizerUnavailableError } from '@/lib/errors'

import { issuedMappings } from './ledger'
import { createPiiTokenizer } from './tokenize'
import type { NerModel, NerSpan } from './types'

/** 던진 것을 받아 온다. 안 던지면 시험이 그 자리에서 깨집니다 */
async function thrownBy<T>(run: () => Promise<unknown>): Promise<T> {
  try {
    await run()
  } catch (error) {
    return error as T
  }
  throw new Error('던졌어야 합니다')
}

/** 넘긴 자리를 그대로 돌려주는 모델 대역 */
function nerOf(spans: readonly NerSpan[]): NerModel {
  return { find: async () => spans }
}

/** 텍스트에서 그 낱말을 찾아 사람 이름으로 집어 주는 대역 */
function nerFinding(text: string, ...words: string[]): NerModel {
  return {
    find: async () =>
      words
        .map((word) => {
          const start = text.indexOf(word)
          return { label: 'PERSON', start, end: start + word.length, value: word }
        })
        .filter((one) => one.start >= 0),
  }
}

describe('정규식이 잡는 넷은 2차에서도 잡힌다', () => {
  it('브라우저를 안 거친 전사에서도 계좌를 가린다', async () => {
    // transcriber 가 낸 전사는 서버에서 만들어져 1차를 지나지 않습니다
    const tokenizer = createPiiTokenizer()

    const { masked } = await tokenizer.tokenize('110-234-567890 으로 보냈어요')

    expect(masked).not.toContain('110-234-567890')
    expect(masked).toContain('[계좌-1]')
  })

  it('주민번호를 가린다', async () => {
    const tokenizer = createPiiTokenizer()

    const { masked } = await tokenizer.tokenize('900101-1234567 입니다')

    expect(masked).not.toContain('900101-1234567')
    expect(masked).toContain('[주민번호-1]')
  })

  it('건수를 종류별로 센다 — 값은 안 담는다', async () => {
    const tokenizer = createPiiTokenizer()

    const { counts } = await tokenizer.tokenize('110-234-567890 과 010-1234-5678')

    // 08-14-api.md §1.1 이 account=1;name=2 로, 08-16-errors.md §6 이
    // {"counts":{"resident_id":1}} 로 영문 이름을 못 박았습니다
    expect(counts.account).toBe(1)
    expect(counts.phone).toBe(1)
    expect(JSON.stringify(counts)).not.toContain('110-234')
  })
})

describe('2차는 이름을 잡는다', () => {
  it('모델이 집은 사람 이름을 토큰으로 바꾼다', async () => {
    // 정규식으로 한국 이름을 잡으면 오탐이 폭발해 1차에서 뺐습니다
    const text = '김민수 고객님 되시죠'
    const tokenizer = createPiiTokenizer({ ner: nerFinding(text, '김민수') })

    const { masked, nerApplied } = await tokenizer.tokenize(text)

    expect(masked).toBe('[이름-1] 고객님 되시죠')
    expect(nerApplied).toBe(true)
  })

  it('모델이 안 붙어 있으면 그 사실을 밝힌다', async () => {
    // 착수 기준선이 「NER 을 기다리지 않는다」로 정했습니다.
    // 다만 경계가 1차뿐이라는 사실을 숨기지 않습니다
    const tokenizer = createPiiTokenizer()

    const { nerApplied, masked } = await tokenizer.tokenize('김민수 고객님')

    expect(nerApplied).toBe(false)
    expect(masked).toBe('김민수 고객님')
  })

  it('토큰화 대상이 아닌 이름표는 그대로 둔다', async () => {
    const text = '국민은행에서 300만원'
    const tokenizer = createPiiTokenizer({
      ner: nerOf([{ label: 'ORG', start: 0, end: 4, value: '국민은행' }]),
    })

    const { masked } = await tokenizer.tokenize(text)

    expect(masked).toBe(text)
  })

  it('모델이 엉뚱한 자리를 가리키면 버린다', async () => {
    // 자리가 실제 글자와 안 맞으면 지워야 할 것을 놔두고 멀쩡한 글자를 지웁니다
    const tokenizer = createPiiTokenizer({
      ner: nerOf([{ label: 'PERSON', start: 0, end: 3, value: '김민수' }]),
    })

    const { masked } = await tokenizer.tokenize('안녕하세요 김민수 님')

    expect(masked).toBe('안녕하세요 김민수 님')
  })
})

describe('제외 목록이 NER 결과보다 우선한다', () => {
  it('기관명을 사람 이름으로 잘못 집어도 안 가린다', async () => {
    // 「카카오페이로 300만원」이 「[이름-1]로 300만원」이 되면 경유 서비스를
    // 특정할 수 없고, 에러 없이 슈퍼셋 플랜이 나갑니다 — 사용자는 정보를
    // 다 줬는데 「모름」 취급을 받습니다
    const text = '카카오페이로 300만원 보냈어요'
    const tokenizer = createPiiTokenizer({ ner: nerFinding(text, '카카오페이') })

    const { masked } = await tokenizer.tokenize(text, {
      allowedTerms: ['카카오페이', '국민은행'],
    })

    expect(masked).toBe(text)
  })

  it('제외 목록에 없으면 그대로 가린다', async () => {
    const text = '김민수로 300만원 보냈어요'
    const tokenizer = createPiiTokenizer({ ner: nerFinding(text, '김민수') })

    const { masked } = await tokenizer.tokenize(text, {
      allowedTerms: ['카카오페이'],
    })

    expect(masked).toContain('[이름-1]')
  })

  it('금액과 시각은 애초에 안 걸린다', async () => {
    // 슬롯 T2 이자 서류 필수 기재사항이고 기한 계산의 기산점입니다
    const tokenizer = createPiiTokenizer()

    const text = '2026-08-18 에 3000000원을 보냈습니다'
    const { masked } = await tokenizer.tokenize(text)

    expect(masked).toBe(text)
  })

  it('대표번호는 안 가린다', async () => {
    // 어느 기관에 전화했는지가 절차 분기의 직접 입력입니다
    const tokenizer = createPiiTokenizer()

    const text = '1588-9999 로 전화했어요'
    const { masked } = await tokenizer.tokenize(text)

    expect(masked).toBe(text)
  })
})

describe('같은 값은 같은 토큰', () => {
  it('한 텍스트 안에서 같은 계좌는 같은 번호', async () => {
    const tokenizer = createPiiTokenizer()

    const { masked, added } = await tokenizer.tokenize(
      '110-234-567890 과 110-234-567890',
    )

    expect(masked).toBe('[계좌-1] 과 [계좌-1]')
    expect(added).toHaveLength(1)
  })

  it('이어 부르면 번호가 이어진다', async () => {
    // 번호가 리셋되면 서로 다른 발화의 [계좌-1] 이 다른 계좌를 가리켜
    // 복원이 엉뚱한 값을 되살립니다
    const tokenizer = createPiiTokenizer()

    const first = await tokenizer.tokenize('110-234-567890')
    const second = await tokenizer.tokenize('222-333-444444', {
      mappings: first.mappings,
    })

    expect(second.masked).toBe('[계좌-2]')
  })

  it('1차가 만든 매핑을 이어받는다', async () => {
    // 브라우저가 먼저 [계좌-1] 을 만들었으면 서버는 2번부터입니다
    const tokenizer = createPiiTokenizer()

    const { masked } = await tokenizer.tokenize('222-333-444444', {
      mappings: [
        { token: '[계좌-1]', kind: '계좌', seq: 1, original: '110-234-567890' },
      ],
    })

    expect(masked).toBe('[계좌-2]')
  })
})

/**
 * 서버는 볼트를 열 수 없어 **번호만 이어받습니다** → 04-pii-boundary.md
 * 「번호의 단위」 · `ledger.ts`.
 *
 * 여기가 이번 고침에서 **가장 위험한 자리**입니다. 원문이 없는 항목을 빈
 * 문자열로 채워 넘기면 값 매칭에 걸려 **서로 다른 값이 같은 이름표**를
 * 받습니다 — 번호가 겹치던 것보다 나쁩니다.
 */
describe('원문 없는 장부를 이어받는다 — 번호만', () => {
  it('볼트가 쓴 번호 다음부터 발급한다', async () => {
    // 브라우저가 `[계좌-1]` 을 볼트에 맡겼습니다. 서버는 그 값을 모릅니다
    const tokenizer = createPiiTokenizer()

    const { masked } = await tokenizer.tokenize('222-333-444444', {
      mappings: issuedMappings(['[계좌-1]']),
    })

    expect(masked).toBe('[계좌-2]')
  })

  it('종류마다 따로 센다 — 계좌가 셋이어도 이름은 1번부터', async () => {
    const text = '김민수 님께 보냈어요'
    const tokenizer = createPiiTokenizer({ ner: nerFinding(text, '김민수') })

    const { masked } = await tokenizer.tokenize(text, {
      mappings: issuedMappings(['[계좌-1]', '[계좌-2]', '[계좌-3]']),
    })

    expect(masked).toBe('[이름-1] 님께 보냈어요')
  })

  /**
   * ⚠️ **여기가 무너지면 지금보다 나빠집니다.** 장부 항목에는 원문이 없는데,
   * 그것을 빈 문자열로 채워 두면 `findExisting` 이 「값이 같다」고 보고
   * **다른 계좌에 남의 이름표를 붙입니다** — 복원이 통째로 뒤바뀝니다
   */
  it('원문 없는 항목은 값 매칭에 안 걸린다 — 다른 값은 다른 번호', async () => {
    const tokenizer = createPiiTokenizer()

    const { masked, added } = await tokenizer.tokenize('222-333-444444', {
      // 「원문을 모른다」를 빈 문자열로 적어 넘긴 경우까지 막습니다
      mappings: [{ token: '[계좌-1]', kind: '계좌', seq: 1, original: '' }],
    })

    expect(masked).toBe('[계좌-2]')
    expect(added).toHaveLength(1)
    expect(added[0].original).toBe('222-333-444444')
  })

  it('원문 없는 항목이 여럿이어도 서로 다른 값이 뭉치지 않는다', async () => {
    const tokenizer = createPiiTokenizer()

    const { masked } = await tokenizer.tokenize('222-333-444444 과 555-666-777777', {
      mappings: issuedMappings(['[계좌-1]', '[계좌-2]']),
    })

    // 두 계좌가 **서로 다른** 번호를 받아야 합니다
    expect(masked).toBe('[계좌-3] 과 [계좌-4]')
  })

  /** **회귀** — 장부가 비어 있으면 지금까지처럼 1번부터입니다 */
  it('장부가 비면 1번부터', async () => {
    const tokenizer = createPiiTokenizer()

    const { masked } = await tokenizer.tokenize('110-234-567890', {
      mappings: issuedMappings([]),
    })

    expect(masked).toBe('[계좌-1]')
  })

  /**
   * 원문이 빈 항목을 **찾을 값**으로도 쓰지 않습니다. `''` 는 아무 자리에나
   * 있으므로, 걸러 내지 않으면 멀쩡한 글이 통째로 가려집니다
   */
  it('원문이 빈 항목으로 멀쩡한 글을 가리지 않는다', async () => {
    const tokenizer = createPiiTokenizer()

    const { masked, added } = await tokenizer.tokenize('안녕하세요', {
      mappings: [{ token: '[계좌-1]', kind: '계좌', seq: 1, original: '' }],
    })

    expect(masked).toBe('안녕하세요')
    expect(added).toEqual([])
  })

  /** 원문을 아는 항목(이번 호출 안에서 만든 것)은 그대로 값 매칭이 됩니다 */
  it('원문을 아는 항목은 여전히 같은 번호를 다시 쓴다', async () => {
    const tokenizer = createPiiTokenizer()

    const first = await tokenizer.tokenize('110-234-567890')
    const second = await tokenizer.tokenize('110-234-567890 다시', {
      mappings: first.mappings,
    })

    expect(second.masked).toBe('[계좌-1] 다시')
    expect(second.added).toHaveLength(0)
  })
})

describe('통과시키지 않는다 — 불변 규칙 2', () => {
  it('모델을 못 쓰면 멈춘다', async () => {
    // 토큰화 없이 LLM 을 호출하는 우회 경로를 만들지 않습니다.
    // pii-tokenizer 가 죽으면 LLM 기능 전체가 멈춥니다 — 의도된 것입니다
    const tokenizer = createPiiTokenizer({
      ner: {
        find: async () => {
          throw new Error('연결 실패')
        },
      },
    })

    await expect(tokenizer.tokenize('김민수')).rejects.toBeInstanceOf(
      PiiTokenizerUnavailableError,
    )
  })

  it('그 예외는 다시 시도해도 되는 것이다', async () => {
    // 서비스 장애는 일시적일 수 있습니다 → 10-errors.md §2
    const tokenizer = createPiiTokenizer({
      ner: {
        find: async () => {
          throw new Error('연결 실패')
        },
      },
    })

    const thrown = await thrownBy<PiiTokenizerUnavailableError>(() =>
      tokenizer.tokenize('김민수'),
    )

    expect(thrown.retryable).toBe(true)
    expect(thrown.httpStatus).toBe(503)
  })

  it('실패 기록에 원문을 담지 않는다', async () => {
    const tokenizer = createPiiTokenizer({
      ner: {
        find: async () => {
          throw new Error('연결 실패: 110-234-567890')
        },
      },
    })

    const thrown = await thrownBy<PiiTokenizerUnavailableError>(() =>
      tokenizer.tokenize('110-234-567890'),
    )

    expect(JSON.stringify(thrown.detail)).not.toContain('110-234')
  })
})

describe('나가기 직전에 다시 센다', () => {
  it('남은 것을 종류별 건수로 낸다', async () => {
    const tokenizer = createPiiTokenizer()

    expect(tokenizer.scan('110-234-567890 남았습니다')).toEqual({ account: 1 })
  })

  it('깨끗하면 빈 것을 낸다 — 그게 통과의 뜻이다', async () => {
    const tokenizer = createPiiTokenizer()

    expect(tokenizer.scan('[계좌-1] 로 보냈습니다')).toEqual({})
  })

  it('무엇이 남았는지 값으로 알려주지 않는다', async () => {
    const tokenizer = createPiiTokenizer()

    const counts = tokenizer.scan('110-234-567890')

    expect(JSON.stringify(counts)).not.toContain('110-234')
  })

  it('토큰화한 결과는 스스로의 검사를 통과한다', async () => {
    // 토큰화와 송출 검사가 같은 규칙을 쓰는지 — 다르면 한쪽이 조용히 새는 쪽입니다
    const tokenizer = createPiiTokenizer()

    const { masked } = await tokenizer.tokenize(
      '110-234-567890 과 900101-1234567 과 010-1234-5678',
    )

    expect(tokenizer.scan(masked)).toEqual({})
  })
})

describe('이미 아는 값은 다시 가려진다 — 던지지 않는다', () => {
  it('탐지가 놓쳐도 아는 원문이면 같은 토큰으로 가린다', async () => {
    // 모델의 재현율은 100%가 아니라 같은 이름을 다음 턴에 놓칠 수 있습니다.
    // 놓친 것을 오류로 던지면 그 이름이 나오는 모든 턴이 영영 실패합니다 —
    // 고칠 수 있는 상황을 영구 장애로 바꾸는 셈입니다
    const tokenizer = createPiiTokenizer()

    const { masked } = await tokenizer.tokenize('안녕하세요 김민수 님', {
      mappings: [
        { token: '[이름-1]', kind: '이름', seq: 1, original: '김민수' },
      ],
    })

    expect(masked).toBe('안녕하세요 [이름-1] 님')
  })

  it('같은 값에 같은 번호가 유지된다', async () => {
    const tokenizer = createPiiTokenizer()

    const { masked, added } = await tokenizer.tokenize('김민수 님과 김민수 님', {
      mappings: [
        { token: '[이름-1]', kind: '이름', seq: 1, original: '김민수' },
      ],
    })

    expect(masked).toBe('[이름-1] 님과 [이름-1] 님')
    // 이미 있던 매핑이라 새로 만들지 않습니다
    expect(added).toHaveLength(0)
  })

  it('가린 횟수를 센다 — 새 매핑만 세지 않는다', async () => {
    // 앞서 말한 계좌를 다시 말한 턴의 응답에 X-Pii-Token-Count 가 0 으로
    // 나가면, 가렸는데 안 가린 것처럼 보입니다 → 08-14-api.md §1.1
    const tokenizer = createPiiTokenizer()

    const { counts, added } = await tokenizer.tokenize('김민수 님', {
      mappings: [
        { token: '[이름-1]', kind: '이름', seq: 1, original: '김민수' },
      ],
    })

    expect(added).toHaveLength(0)
    expect(counts.name).toBe(1)
  })

  it('원문 없는 매핑도 번호를 이어 붙이는 데 쓴다', async () => {
    // 브라우저가 만든 매핑의 **원문은 서버로 보내지 않습니다** — 종류와 번호만
    // 보내면 번호를 이어 붙이는 데 충분합니다 → 04-pii-boundary.md 불변 규칙 1
    const tokenizer = createPiiTokenizer()

    const { masked } = await tokenizer.tokenize('222-333-444444', {
      mappings: [{ token: '[계좌-1]', kind: '계좌', seq: 1 }],
    })

    expect(masked).toBe('[계좌-2]')
  })
})

describe('겹칠 때 — 정규식이 이기되 남는 조각을 버리지 않는다', () => {
  it('모델이 이름과 전화를 한 덩어리로 집어도 둘 다 가린다', async () => {
    // 시작 위치가 이른 쪽만 남기면 전화번호 뒷자리가 평문으로 남습니다
    const text = '김민수 010-1234-5678 입니다'
    const tokenizer = createPiiTokenizer({
      ner: nerOf([{ label: 'PERSON', start: 0, end: 7, value: '김민수 010' }]),
    })

    const { masked } = await tokenizer.tokenize(text)

    expect(masked).toBe('[이름-1] [전화-1] 입니다')
    expect(tokenizer.scan(masked)).toEqual({})
  })

  it('종류를 정규식 쪽으로 잡는다', async () => {
    // 전화번호가 [이름-1] 로 기록되면 계측 헤더의 종류별 건수가 틀리고,
    // 1차가 만든 매핑과 종류가 어긋나 복원 규칙도 갈립니다
    const text = '010-1234-5678 김민수'
    const tokenizer = createPiiTokenizer({
      ner: nerOf([{ label: 'PERSON', start: 0, end: 17, value: text }]),
    })

    const { counts } = await tokenizer.tokenize(text)

    expect(counts.phone).toBe(1)
  })

  it('잘리고 남은 것이 공백뿐이면 버린다', async () => {
    const text = '010-1234-5678 '
    const tokenizer = createPiiTokenizer({
      ner: nerOf([{ label: 'PERSON', start: 0, end: 14, value: text }]),
    })

    const { masked } = await tokenizer.tokenize(text)

    expect(masked).toBe('[전화-1] ')
  })
})

describe('입력에 있던 토큰 모양을 센다', () => {
  it('우리가 만들지 않은 토큰 모양을 알린다', async () => {
    // ⬜ 사기범이 보낸 캡처에 [계좌-1] 이 적혀 있고 OCR 이 그대로 읽으면,
    // 그 자리가 나중에 피해자 본인의 계좌번호로 복원돼 보입니다
    const tokenizer = createPiiTokenizer()

    const { foreignTokens } = await tokenizer.tokenize(
      '문자에 [계좌-1] 이라고 적혀 있었어요',
    )

    expect(foreignTokens).toBe(1)
  })

  it('없으면 0 이다', async () => {
    const tokenizer = createPiiTokenizer()

    expect((await tokenizer.tokenize('아무것도 없어요')).foreignTokens).toBe(0)
  })
})

describe('허용 목록은 목록에 적힌 것만 면제한다', () => {
  it('허용어를 품은 사람 이름은 가린다', async () => {
    // 기관 별칭에는 두 글자짜리가 자연스럽게 들어갑니다 —
    // 정본의 org 예시가 aliases: ["국민", "KB국민은행", …] 입니다.
    // 「포함하면 허용」이면 김하나·이신한·박국민이 통째로 새어 나갑니다
    for (const name of ['김하나', '이신한', '박국민', '최우리']) {
      const text = `${name} 고객님 되시죠`
      const tokenizer = createPiiTokenizer({ ner: nerFinding(text, name) })

      const { masked } = await tokenizer.tokenize(text, {
        allowedTerms: ['하나', '신한', '국민', '우리', '국민은행'],
      })

      expect(masked, name).toContain('[이름-1]')
    }
  })

  it('조사가 붙어 있어도 기관명은 면제한다', async () => {
    // 모델이 「카카오페이로」를 한 덩어리로 집는 일이 흔합니다
    const text = '카카오페이로 300만원 보냈어요'
    const tokenizer = createPiiTokenizer({ ner: nerFinding(text, '카카오페이로') })

    const { masked } = await tokenizer.tokenize(text, {
      allowedTerms: ['카카오페이'],
    })

    expect(masked).toBe(text)
  })
})

describe('유니코드 변형으로 우회할 수 없다', () => {
  const VARIANTS: [string, string][] = [
    ['en dash', '계좌 110–234–567890 으로'],
    ['em dash', '계좌 110—234—567890 으로'],
    ['전각 하이픈', '계좌 110－234－567890 으로'],
    ['전각 숫자', '계좌 １１０２３４５６７８９０ 으로'],
    ['제로폭', '계좌 110\u200B234\u200B567890 으로'],
  ]

  for (const [name, text] of VARIANTS) {
    it(`${name} 도 가린다`, async () => {
      // OCR 결과에 전각 숫자와 en dash 가 흔히 섞이고,
      // 그 경로는 브라우저 1차를 거치지 않습니다
      const tokenizer = createPiiTokenizer()

      const { masked, counts } = await tokenizer.tokenize(text)

      expect(masked, name).toContain('[계좌-1]')
      expect(counts.account, name).toBe(1)
    })
  }

  it('원문 그대로를 매핑에 담는다 — 복원되어야 하는 것은 사용자가 쓴 글자다', async () => {
    const tokenizer = createPiiTokenizer()

    const { added } = await tokenizer.tokenize('계좌 110–234–567890 으로')

    expect(added[0].original).toBe('110–234–567890')
  })
})

describe('원문 없는 장부 항목이 반복문을 멈추지 않는다', () => {
  /**
   * ⚠️ **2026-08-31 에 실제로 시험 작업자가 죽었습니다.**
   *
   * 장부에서 이어받은 항목에는 원문이 없습니다(`ledger.ts` — 서버는 그 값을
   * 모릅니다). 그것이 빈 문자열로 들어오면 `knownSpans` 의
   * `text.indexOf('', from)` 이 **언제나 `from` 을 돌려주고** `from += 0` 이라
   * 그 자리에서 영원히 돕니다. 프로세스가 죽어서 시험이 「실패」가 아니라
   * **아예 안 도는 것**으로 나타납니다 — 45건이 조용히 사라졌습니다.
   */
  it('원문이 빈 문자열이어도 끝난다', async () => {
    const tokenizer = createPiiTokenizer()
    const out = await tokenizer.tokenize('계좌는 110-2345-678901 입니다', {
      // 장부에서 이어받은 모양 — 이름표와 번호만 알고 값은 모릅니다
      mappings: [{ token: '[계좌-1]', kind: '계좌', seq: 1, original: '' }],
    })
    expect(out.masked).not.toContain('110-2345-678901')
  })

  it('원문이 없는(undefined) 항목도 끝난다', async () => {
    const tokenizer = createPiiTokenizer()
    const out = await tokenizer.tokenize('계좌는 110-2345-678901 입니다', {
      mappings: [{ token: '[계좌-1]', kind: '계좌', seq: 1 }],
    })
    // 번호는 이어받되(2번부터) 값 매칭에는 안 걸립니다
    expect(out.masked).toContain('[계좌-2]')
  })

  it('원문을 모르는 항목이 서로 다른 값을 같은 이름표로 묶지 않는다', async () => {
    // 빈 문자열을 값으로 취급하면 **아무 값이나 그 항목에 걸립니다** —
    // 겹치는 번호를 고치려다 더 나쁜 것을 만드는 자리입니다
    const tokenizer = createPiiTokenizer()
    const out = await tokenizer.tokenize('110-2345-678901 과 352-0912-3456-73', {
      mappings: [{ token: '[계좌-1]', kind: '계좌', seq: 1, original: '' }],
    })
    const used = [...out.masked.matchAll(/\[계좌-(\d+)\]/g)].map((m) => m[1])
    expect(new Set(used).size).toBe(used.length)
    expect(used).not.toContain('1')
  })
})
