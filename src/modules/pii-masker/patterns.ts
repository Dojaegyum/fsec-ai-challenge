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
 */
function looksLikeMoney(text: string, end: number): boolean {
  return /^\s*(?:원|만|억|천만|백만)/.test(text.slice(end, end + 4));
}

/**
 * 성별코드는 1~8만 씁니다.
 * 1·2 = 1900년대 내국인, 3·4 = 2000년대 내국인,
 * 5·6 = 2000년대 외국인, 7·8 = 1900년대 외국인.
 * 9·0은 1800년대생이라 생존자가 없습니다.
 */
const RRN = /\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])[-\s]?[1-8]\d{6}/g;

/** 13~19자리. 공백·하이픈 구분을 허용하고 Luhn 으로 거릅니다 */
const CARD = /\d(?:[ -]?\d){12,18}/g;

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
const ACCOUNT_HYPHEN = /\d{2,6}-\d{2,6}-\d{2,7}(?:-\d{1,6})?/g;
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
 */
export function findHits(text: string): Hit[] {
  const claimed: Hit[] = [];

  for (const { kind, re, accept } of PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const start = m.index;
      const end = start + m[0].length;

      if (hasDigitNeighbor(text, start, end)) continue;
      if (accept && !accept(m[0], text, start, end)) continue;
      if (claimed.some((h) => start < h.end && h.start < end)) continue;

      claimed.push({ kind, start, end, value: m[0] });
    }
  }

  return claimed.sort((a, b) => a.start - b.start);
}
