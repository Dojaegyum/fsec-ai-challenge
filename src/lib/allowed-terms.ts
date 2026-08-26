/**
 * 토큰화하지 않을 낱말을 모은다 → [PII 경계](../../spec/common/08-14-pii-boundary.md) 「토큰화 제외 목록」.
 *
 * 정본이 못 박은 것입니다 — *"`pii-tokenizer` 는 이 목록을 허용 목록으로 갖고
 * **NER 결과보다 우선 적용**합니다."*
 *
 * ## 왜 따로 두나 — **아무도 안 넘겨주고 있었습니다**
 *
 * `tokenize()` 를 부르는 곳이 넷인데 `allowedTerms` 를 주는 곳은 하나뿐이었고
 * (`answer-slot` 의 「아니에요」 분기), 나머지 셋은 빈 목록으로 불렀습니다.
 * `tokenize.ts` 가 `ctx.allowedTerms ?? []` 로 받으므로 **제품 경로에서는
 * 제외 목록이 언제나 비어 있었습니다.**
 *
 * **그동안 안 터진 이유는 `NER_URL` 이 비어 있었기 때문입니다.** `nerModel(env)`
 * 이 `null` 을 내면 NER 분기 자체를 건너뜁니다 — 목록이 있든 없든 같았습니다.
 * **그 스위치를 켜는 순간 살아납니다.**
 *
 * 무엇이 걸렸을지는 `tokenize.ts` 가 직접 적어 뒀습니다.
 *
 * > 이게 없으면 `"카카오페이로 300만원"` 이 `"[이름-1]로 300만원"` 이 되어
 * > 경유 서비스를 특정할 수 없고, **에러 없이 슈퍼셋 플랜이 나갑니다** —
 * > 사용자는 정보를 다 줬는데 「모름」 취급을 받습니다.
 *
 * 그리고 [17 §2](../../docs/research/17-기관명-사전-실측.md) 가 못 박은 대로,
 * 기관이 틀리면 **9유형 분기가 틀어져 엉뚱한 매뉴얼이 에러 없이 나갑니다.**
 *
 * ## 짧은 별칭을 빼지 않습니다
 *
 * 사전에 **두 글자 표기가 서른**입니다(`국민`·`신한`·`하나`·**`토스`**·`빗썸`…).
 * 빼면 「토스로 보냈어요」가 그대로 가려집니다 — 고치려던 것이 그대로 납니다.
 *
 * **실명이 새지 않는 것은 `isAllowed` 의 규칙 때문입니다** — 허용어로 *시작*하고
 * 뒤에 *조사만* 남아야 통과합니다. 「김하나」는 「하나」로 시작하지 않으므로
 * 안 걸립니다. (`includes` 로 보던 시절에 실명이 샜고, 그래서 지금 규칙이 됐습니다.)
 */

import type { ChannelWriter } from './db'

/** 한 사건에서 쓸 제외 목록을 만든다 */
export interface AllowedTermSource {
  /** 그 KB 릴리스의 기관 표기 전부 — 이름과 별칭 */
  list(kbVersion: string): Promise<readonly string[]>
}

/**
 * 기관 사전을 제외 목록으로.
 *
 * **유형으로 안 좁힙니다.** 전사·챗 시점에는 유형을 모릅니다 — 그것을 알아내려고
 * 전사합니다([17 §4](../../docs/research/17-기관명-사전-실측.md)). `allCandidates`
 * 를 쓰는 이유가 `org-repair` 와 같습니다.
 */
export function createAllowedTermSource(deps: {
  readonly channels: Pick<ChannelWriter, 'allCandidates'>
}): AllowedTermSource {
  return {
    async list(kbVersion) {
      const rows = await deps.channels.allCandidates(kbVersion)
      const out = new Set<string>()
      for (const row of rows) {
        out.add(row.name)
        for (const alias of row.aliases) out.add(alias)
      }
      return [...out]
    },
  }
}

/**
 * 사건 하나에 쓸 제외 목록을 통째로 가져온다.
 *
 * ⚠️ **버전 조회까지 이 안에 넣었습니다.** 처음에 `kbVersion.current()` 를 밖에
 * 두었더니 그것이 터질 때 **쓰기 경로가 500** 이 됐습니다(증거 라우트 시험이
 * 잡았습니다). 제외 목록은 **절차의 부속**이지 절차 자체가 아닙니다 —
 * 못 가져와도 하던 일은 계속해야 합니다 → 불변 규칙 5 · §11.4.3 의 취지.
 *
 * ## 「못 가리면 안 내보낸다」와 왜 다른가
 *
 * 한 파일 건너에 **반대 저울**이 있습니다 — NER 이 죽으면
 * `PiiTokenizerUnavailableError` 로 **슬롯 저장을 막습니다.** 둘이 어긋나 보이는데,
 * **막는 해와 안 막는 해가 다릅니다.**
 *
 *     NER 실패      가려야 할 원문이 안 가려진 채 **밖으로 나갑니다** — 되돌릴 수 없습니다
 *     목록 실패      가리지 않아도 될 것이 가려집니다 — **안내가 나빠질 뿐 새지 않습니다**
 *
 * 앞엣것은 피해자의 개인정보가 사업자에게 가는 일이고, 뒤엣것은 유형을 못 좁혀
 * 슈퍼셋 플랜이 나가는 일입니다. **그래서 앞은 막고 뒤는 진행합니다.**
 *
 * ⚠️ **다만 조용하면 안 됩니다.** 조용히 빈 목록이 되는 것이 바로 이 파일이
 * 생긴 이유였습니다. 그래서 `tokenize()` 결과가 `allowedTermsApplied` 로 사실을
 * 실어 내고, 전사 흐름은 그것을 `shortfalls` 의 `no_org_allowlist` 로 화면까지
 * 보냅니다 — `nerApplied` 와 같은 규칙입니다.
 */
export async function allowedTermsFor(deps: {
  readonly channels: Pick<ChannelWriter, 'allCandidates'>
  readonly kbVersion: { current(): Promise<string> }
}): Promise<readonly string[]> {
  try {
    const version = await deps.kbVersion.current()
    return await createAllowedTermSource({ channels: deps.channels }).list(version)
  } catch {
    return []
  }
}
