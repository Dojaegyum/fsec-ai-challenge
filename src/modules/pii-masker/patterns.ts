/**
 * 1차 정규식 패턴 목록의 **정본**입니다.
 *
 * spec/common/08-14-pii-boundary.md 의 `TODO(미정): 정규식 패턴 목록의 정본 위치`가
 * 여기로 닫힙니다. 패턴을 늘릴 때는 이 파일을 고치고 테스트를 함께 추가하세요.
 *
 * ── 순서가 규칙입니다 ──────────────────────────────────────────────
 * 위에서부터 적용하고, 이미 잡힌 자리는 다음 패턴이 건드리지 않습니다.
 * 구체적인 것(주민번호·카드)이 먼저, 헐거운 것(계좌)이 나중입니다.
 * 순서를 바꾸면 계좌 패턴이 주민번호를 먼저 삼킵니다.
 */

import type { Hit, PiiKind } from "./types";

/**
 * ── 길이를 지키는 정규화 ──────────────────────────────────────────
 *
 * **정규식이 `\d` 와 `-` 를 보는데, 같은 숫자를 다른 글자로 쓸 수 있습니다.**
 * 전각 숫자(`１１０`), 하이픈처럼 보이는 문자 여럿(‐ ‑ – — －), 눈에 안 보이는
 * 문자(제로폭 공백)로 쓰면 패턴 넷이 **전부** 비껴갑니다. 실측으로 확인했습니다 —
 * `110-234-567890` 은 잡히는데 `110–234–567890`(en dash)은 그대로 나갑니다.
 *
 * OCR 결과에 전각 숫자와 en dash 가 흔히 섞이고, **그 경로는 브라우저 1차를
 * 거치지 않습니다.** 그대로 두면 계좌번호가 토큰화 없이 외부 모델로 나갑니다.
 *
 * **길이를 바꾸지 않는 것이 핵심입니다.** 표준 정규화(NFKC)는 글자 수가 달라져
 * 찾은 자리가 원문과 어긋나고, 그러면 엉뚱한 대목을 지웁니다. 그래서 한 글자를
 * 한 글자로만 바꾸는 표를 씁니다 — 자리는 원문과 정확히 같습니다.
 *
 * **눈에 안 보이는 문자를 `-` 로 바꿉니다.** 지우면 길이가 달라지고, 공백으로
 * 두면 숫자 사이를 끊어 놓은 자리가 안 이어집니다. `-` 로 두면 `110<ZWSP>234`
 * 가 `110-234` 로 읽혀 원래 의도대로 걸립니다.
 */
const FOLD = new Map<string, string>([
  // 전각 숫자
  ...["０", "１", "２", "３", "４", "５", "６", "７", "８", "９"].map(
    (ch, i) => [ch, String(i)] as [string, string],
  ),
  // 하이픈처럼 보이는 것들
  ...[
    "\u2010", "\u2011", "\u2012", "\u2013", "\u2014", "\u2015",
    "\u2043", "\u2212", "\uFE63", "\uFF0D", "\u30FC",
  ].map((ch) => [ch, "-"] as [string, string]),
  // 눈에 안 보이는 것들
  ...["\u200B", "\u200C", "\u200D", "\u2060", "\uFEFF", "\u00AD"].map(
    (ch) => [ch, "-"] as [string, string],
  ),
  // 전각 공백·마침표·쉼표
  ["\u3000", " "],
  ["\uFF0E", "."],
  ["\uFF0C", ","],
]);

/**
 * 한 글자를 한 글자로. **길이가 절대 안 바뀝니다.**
 *
 * 찾는 것은 이 결과로 하고, **매핑에 담는 원문은 언제나 원래 글자**입니다 —
 * 복원할 때 되살아나야 하는 것은 사용자가 실제로 쓴 글자입니다.
 */
export function foldForDetection(text: string): string {
  let out = "";
  for (const ch of text) {
    out += FOLD.get(ch) ?? ch;
  }
  return out;
}

/** 앞뒤가 숫자면 더 긴 수의 일부이므로 매칭으로 치지 않습니다 */
function hasDigitNeighbor(text: string, start: number, end: number): boolean {
  const before = start > 0 ? text[start - 1] : "";
  const after = end < text.length ? text[end] : "";
  return /\d/.test(before) || /\d/.test(after);
}

/** 카드번호 검증. 이게 없으면 계좌·주문번호를 카드로 오인합니다 */
export function passesLuhn(digits: string): boolean {
  const d = digits.replace(/\D/g, "");
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = d.charCodeAt(i) - 48;
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

interface PatternSpec {
  kind: PiiKind;
  re: RegExp;
  /** 형태는 맞지만 값이 아닌 것을 걸러냅니다 */
  accept?: (value: string, text: string, start: number, end: number) => boolean;
}

function digitCount(s: string): number {
  return s.replace(/\D/g, "").length;
}

/**
 * 금액은 토큰화하지 않습니다 → PII 격리 경계 「토큰화 제외 목록」.
 * 숫자 뒤에 화폐 단위가 붙으면 계좌가 아닙니다.
 *
 * ⚠️ **2026-08-31 까지 이 판정이 낱말을 먹고 계좌를 통과시켰습니다.**
 * `/^\s*(?:원|만|억|천만|백만)/` 로 **첫 글자만** 봤기 때문에
 * 「**원**래」·「**만**나서」·「**억**울」이 전부 금액으로 읽혔고, 그 앞의 계좌번호는
 * 「금액이니 계좌가 아니다」로 판정돼 **가려지지 않은 채 외부 LLM 으로 나갔습니다** —
 * 불변 규칙 2 위반입니다. 실측: `계좌 110-234-567890 원래 제 것입니다` 가
 * `maskText` 를 원문 그대로 통과했습니다.
 *
 * 그래서 **바로 뒤의 「원」만** 금액으로 봅니다. 이 판정을 묻는 자리는 열 자리가 넘는
 * 수뿐이고(`digitCount >= 10` · `ACCOUNT_PLAIN`), 열 자리 뒤의 「만·억」은 금액 단위가
 * 될 수 없습니다 — 열 자리 × 만이면 조 단위입니다. 「300만원」처럼 진짜 금액에 붙는
 * 단위는 앞의 수가 짧아 애초에 계좌 패턴에 안 걸립니다.
 *
 * **기울일 방향이 정해져 있습니다** — 놓치면 원문이 새고, 과하게 잡으면 금액이
 * 가려질 뿐입니다(`CARD` 하한을 14로 올릴 때와 같은 판단).
 */
const MONEY_AFTER =
  /^\s*원(?:[을를이가은는도만과와에의뿐씩짜]|으로|어치|정도|(?![가-힣]))/;

function looksLikeMoney(text: string, end: number): boolean {
  return MONEY_AFTER.test(text.slice(end, end + 8));
}

/**
 * 성별코드는 1~8만 씁니다.
 * 1·2 = 1900년대 내국인, 3·4 = 2000년대 내국인,
 * 5·6 = 2000년대 외국인, 7·8 = 1900년대 외국인.
 * 9·0은 1800년대생이라 생존자가 없습니다.
 */
const RRN = /\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])[-\s]?[1-8]\d{6}/g;

/**
 * 14~19자리. 공백·하이픈 구분을 허용하고 Luhn 으로 거릅니다.
 *
 * ⚠️ **하한이 13이 아니라 14입니다** (2026-08-24 결정).
 *
 * 13자리로 두면 **계좌번호가 카드로 잡힙니다.** 목업의 `110-2345-678901` 이
 * 실제로 그랬습니다 — 13자리이고 Luhn 을 통과하는데, `PATTERNS` 에서 카드가
 * 계좌보다 먼저라 `[카드-1]` 이 됐습니다. 13자리 숫자는 열 개 중 하나쯤
 * Luhn 을 통과하므로 우연이 아니라 상시 위험입니다.
 *
 * **새는 쪽으로 기울지 않습니다** — 13자리가 여기서 빠져도 아래 계좌 패턴이
 * 잡습니다. 바뀌는 것은 이름표와 §3.9 종류별 부분 복원 규칙뿐입니다.
 *
 * 국내 카드는 15~16자리(아멕스 15, 나머지 16)이고 13자리 Visa 는 사실상
 * 없습니다. 계좌는 11~14자리라 14에서 겹치지만, 겹치는 자리에서는
 * **카드로 보는 편이 안전합니다** — 둘 다 가려지고 이름표만 다릅니다.
 */
const CARD = /\d(?:[ -]?\d){13,18}/g;

/**
 * 휴대폰과 지역번호만입니다.
 *
 * ⚠️ **대표번호(15xx·16xx·18xx)는 일부러 뺐습니다.** 개인을 식별하지 않고,
 * 「어느 기관에 전화했나」는 절차 분기의 직접 입력이라 토큰화 제외 목록의
 * 취지와 같습니다 → ADR-011. 112·1332·1394 는 자릿수가 짧아 애초에 안 걸립니다.
 */
const PHONE =
  /(?:01[016789]|0(?:2|[3-6][1-5]))[-.\s]?\d{3,4}[-.\s]?\d{4}/g;

/**
 * 계좌번호는 은행마다 자릿수와 구분자가 달라 단일 형태가 없습니다.
 * 그래서 둘로 나눠 잡습니다 — 하이픈으로 끊긴 것, 그리고 붙여 쓴 10~16자리.
 *
 * 연속 숫자를 10자리부터 보는 이유는 8자리 날짜(20260818)와 금액을 피하려는 것입니다.
 * 금액·시각은 토큰화하지 않습니다 → PII 격리 경계 「토큰화 제외 목록」.
 */
/**
 * ⚠️ **전사문의 계좌번호에는 쉼표가 낍니다** (2026-09-01).
 *
 * 음성인식기가 마지막 묶음을 수로 읽어 천 단위 쉼표를 넣습니다 — 합성 통화를
 * 실제로 전사하니 `국민은행 110-234-567,890.` 이 나왔습니다. 쉼표에서 끊기면
 * `110-234-567` 아홉 자리만 잡혀 아래 `digitCount >= 10` 에 걸리고,
 * **계좌가 아니라고 판정돼 원문 그대로 나갑니다.**
 *
 * 그렇다고 쉼표를 아무 데서나 허용하면 **금액이 계좌로 잡힙니다** — 금액은
 * 토큰화 제외 대상이라(`looksLikeMoney` 참고) 가려 버리면 피해 금액이
 * `[계좌-1]` 이 되고 플랜도 기한도 못 셉니다.
 *
 * **가르는 것은 하이픈입니다.** 한국에서 계좌는 하이픈으로, 금액은 쉼표로
 * 끊습니다 — 둘이 섞이는 경우는 하이픈으로 끊긴 계좌에 쉼표가 잘못 낀 것뿐입니다.
 * 그래서 **하이픈 패턴 안에서만** 쉼표를 자릿수 구분으로 안 봅니다.
 * 쉼표만 있는 수(`32,000,000`)는 아래 `ACCOUNT_PLAIN` 이 못 잡으므로 그대로 남습니다.
 */
const GROUP = String.raw`(?:,\d{3})*`;
const ACCOUNT_HYPHEN = new RegExp(
  String.raw`\d{2,6}${GROUP}-\d{2,6}${GROUP}-\d{2,7}${GROUP}(?:-\d{1,6}${GROUP})?`,
  "g",
);
const ACCOUNT_PLAIN = /\d{10,16}/g;

const PATTERNS: PatternSpec[] = [
  { kind: "주민번호", re: RRN },
  { kind: "카드", re: CARD, accept: (v) => passesLuhn(v) },
  { kind: "전화", re: PHONE },
  {
    // 총 10자리 이상만 봅니다. 이게 없으면 날짜(2026-08-18)가 계좌로 잡힙니다
    kind: "계좌",
    re: ACCOUNT_HYPHEN,
    accept: (value, text, start, end) =>
      digitCount(value) >= 10 && !looksLikeMoney(text, end),
  },
  {
    kind: "계좌",
    re: ACCOUNT_PLAIN,
    accept: (value, text, start, end) => !looksLikeMoney(text, end),
  },
];

/**
 * 텍스트에서 마스킹할 자리를 찾습니다. 겹치면 **먼저 잡은 쪽**이 이깁니다.
 * 반환은 위치 오름차순입니다.
 *
 * **찾는 것은 정규화한 글자로 하고, 돌려주는 값은 원문 그대로입니다** —
 * 위 `foldForDetection` 참고. 길이가 같아서 자리는 양쪽이 정확히 일치합니다.
 */
export function findHits(text: string): Hit[] {
  const folded = foldForDetection(text);
  const claimed: Hit[] = [];

  for (const { kind, re, accept } of PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(folded)) !== null) {
      const start = m.index;
      const end = start + m[0].length;

      if (hasDigitNeighbor(folded, start, end)) continue;
      // 걸러내는 판단(Luhn·자릿수·금액)은 정규화한 글자로 합니다 —
      // 전각 숫자를 `\D` 로 세면 0 이 나옵니다
      if (accept && !accept(m[0], folded, start, end)) continue;
      if (claimed.some((h) => start < h.end && h.start < end)) continue;

      // **원문 그대로**를 담습니다. 복원할 때 되살아나야 하는 것은 사용자가 쓴 글자입니다
      claimed.push({ kind, start, end, value: text.slice(start, end) });
    }
  }

  return claimed.sort((a, b) => a.start - b.start);
}
