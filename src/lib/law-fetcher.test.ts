/**
 * 법령 수집원 시험 — ADR-072.
 *
 * 가장 중요한 것: **조문 단위로 갈리고, 원문이 그대로이며, JSON 이 아니면 던진다.**
 * 본보기는 2026-09-06 에 실제 API 가 준 통신사기피해환급법 본문에서 두 조문만 남긴 것입니다.
 */

import { describe, expect, it } from 'vitest'

import { createLawFetcher, splitLaw } from './law-fetcher'

const BODY = {
  법령: {
    기본정보: {
      법령명_한글: '전기통신금융사기 피해 방지 및 피해금 환급에 관한 특별법',
      법령ID: '011359',
      공포일자: '20260203',
      시행일자: '20260804',
      공포번호: '21320',
      제개정구분: '일부개정',
    },
    조문: {
      조문단위: [
        { 조문번호: '1', 조문여부: '전문', 조문내용: '제1장 총칙' },
        {
          조문번호: '10',
          조문가지번호: '',
          조문여부: '조문',
          조문제목: '피해환급금의 결정ㆍ지급',
          조문시행일자: '20260804',
          조문내용: '제10조(피해환급금의 결정ㆍ지급)',
          항: [
            {
              항번호: '①',
              항내용: '① 금융감독원은 제9조제1항에 따라 채권이 소멸된 날부터 14일 이내에 피해환급금을 지급받을 자 및 그 금액을 결정하여야 한다.',
            },
            { 항번호: '②', 항내용: '② 제1항의 피해환급금은 …', 호: [{ 호번호: '1.', 호내용: '1. 첫째 호' }] },
          ],
        },
        {
          조문번호: '13',
          조문가지번호: '2',
          조문여부: '조문',
          조문제목: '전자금융거래 제한',
          조문내용: '제13조의2(전자금융거래 제한)',
          항: { 항번호: '①', 항내용: '① 하나뿐인 항' },
        },
      ],
    },
  },
}

describe('조문 단위로 가른다 — §12.1', () => {
  const items = splitLaw('011359', BODY)

  it('조문만 남고, 이름은 법령ID:조문번호[:가지번호]', () => {
    expect(items.map((one) => one.sourceKey)).toEqual(['law:011359:10', 'law:011359:13:2'])
  })

  it('조문 → 항 → 호 순서로 원문 그대로', () => {
    expect(items[0]!.content).toBe(
      [
        '제10조(피해환급금의 결정ㆍ지급)',
        '① 금융감독원은 제9조제1항에 따라 채권이 소멸된 날부터 14일 이내에 피해환급금을 지급받을 자 및 그 금액을 결정하여야 한다.',
        '② 제1항의 피해환급금은 …',
        '1. 첫째 호',
      ].join('\n'),
    )
  })

  it('항이 하나면 배열이 아니라 객체로 오는데, 그것도 읽는다', () => {
    expect(items[1]!.content).toBe('제13조의2(전자금융거래 제한)\n① 하나뿐인 항')
  })

  it('시행일·공포번호가 meta 에 남는다 — 검수 화면이 볼 것', () => {
    expect(items[0]!.meta).toMatchObject({
      법령명: '전기통신금융사기 피해 방지 및 피해금 환급에 관한 특별법',
      조문제목: '피해환급금의 결정ㆍ지급',
      시행일자: '20260804',
      공포번호: '21320',
    })
  })

  it('법령 본문이 아니면 던진다', () => {
    expect(() => splitLaw('011359', { 오류: '승인되지 않은 사용자' })).toThrow(/법령 본문/)
  })
})

describe('수집원 — API 를 한 번만 부른다', () => {
  const okFetch = (async () =>
    new Response(JSON.stringify(BODY), { status: 200 })) as unknown as typeof fetch

  it('둘째 쪽은 빈 목록 — 법령 API 는 전체를 한 번에 준다', async () => {
    const fetcher = createLawFetcher({ oc: 'someone', fetchImpl: okFetch })
    expect(await fetcher.fetch({ sourceKeyPrefix: 'law:011359', watchMethod: 'api', page: 2 })).toEqual([])
  })

  it('첫 쪽은 조문 목록', async () => {
    const fetcher = createLawFetcher({ oc: 'someone', fetchImpl: okFetch })
    const got = await fetcher.fetch({ sourceKeyPrefix: 'law:011359', watchMethod: 'api', page: 1 })
    expect(got).toHaveLength(2)
  })

  it('OC 가 없으면 던진다 — 조용히 빈 결과를 내지 않는다', async () => {
    const fetcher = createLawFetcher({ oc: null, fetchImpl: okFetch })
    await expect(
      fetcher.fetch({ sourceKeyPrefix: 'law:011359', watchMethod: 'api', page: 1 }),
    ).rejects.toThrow(/LAW_API_OC/)
  })

  it('JSON 이 아니면(승인 안 된 OC 의 안내 페이지) 던진다', async () => {
    const html = (async () => new Response('<html>승인되지 않은 사용자</html>', { status: 200 })) as unknown as typeof fetch
    const fetcher = createLawFetcher({ oc: 'nobody', fetchImpl: html })
    await expect(
      fetcher.fetch({ sourceKeyPrefix: 'law:011359', watchMethod: 'api', page: 1 }),
    ).rejects.toThrow(/JSON/)
  })

  it('law: 가 아닌 소스는 이 수집원의 몫이 아니다', async () => {
    const fetcher = createLawFetcher({ oc: 'someone', fetchImpl: okFetch })
    await expect(
      fetcher.fetch({ sourceKeyPrefix: 'fsc.go.kr/no010101', watchMethod: 'board', page: 1 }),
    ).rejects.toThrow(/law:/)
  })
})
