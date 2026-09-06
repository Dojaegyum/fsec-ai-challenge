/**
 * completion-checker — 부산물로 완료를 판정한다 (L1·L2·L3).
 *
 * 정본: spec/backend/08-14-completion-hook.md · spec/backend/08-16-data-model.md §7
 *       spec/common/08-14-api.md §3.8
 * 근거: ADR-028 · ADR-057(L1 은 받아 적었나) · ADR-077(L2 는 판독 결과를 본다)
 *
 * **CLAUDE.md 불변 규칙 6** — 완료는 사용자의 체크가 아니라 부산물로 판정한다.
 * 체크리스트는 "체크는 됐는데 행위는 안 된 상태"를 막지 못하고, 은행·경찰 시스템 API 가
 * 없어 완수를 직접 조회할 수도 없다. 그래서 절차가 남기는 부산물을 근거로 삼는다.
 *
 * ## L2 — 올린 것 자체는 증빙이 아니다 (2026-09-06 · ADR-077)
 *
 * 2026-09-06 까지 `sms_capture`·`receipt_doc` 은 **파일이 올라왔다는 사실만으로**
 * `done_verified` 였다. 사기범과의 통화 녹음을 올려도 「신청서류 제출」이 끝났고,
 * 이체 캡처가 112 접수증으로 인정됐다. 부산물 원리가 말하는 근거는 「절차가 남긴 것이
 * 존재한다」이지 「무엇이든 올렸다」가 아니다.
 *
 * 그래서 L2 는 **판독 결과**(전사·OCR 이 낸 토큰화된 글)를 본다 —
 *
 * | 판독 글에 | 판정 |
 * | --- | --- |
 * | 「접수번호」 자리와 번호(또는 가린 이름표) | `passed` · `done_verified` |
 * | 공공기관 이름(경찰·금감원 …) | `passed` · `done_verified` |
 * | 둘 다 없음 · 읽기 실패 · 통화 녹음 | `failed` · **`unconfirmed`** — 「올렸지만 확인 못 함」 |
 * | 아직 읽는 중 | `not_applicable` · `unconfirmed` — `reading_pending` 으로 두고 나중에 다시 |
 *
 * 경유 서비스(은행) 이름은 근거가 아니다 — 이체 캡처에도 있다. 공공기관만 본다.
 */

import type {
  ArtifactSubmission,
  CompletionChecker,
  CompletionInput,
  CompletionVerdict,
  EvidenceReading,
  NextOption,
  ReceiptNumberFormat,
} from './types'

/**
 * L1 이 실패했을 때 내미는 길. **문구의 정본은 08-14-api.md §3.8 입니다.**
 *
 * 이것이 없으면 사용자가 막힌다. L1 자동 검증이 실패했다고 막아 세우지 않는다 →
 * 08-14-completion-hook.md 구현 주의.
 */
const NEXT_OPTIONS: readonly NextOption[] = [
  { level: 'L2', label: '접수 문자 캡처를 올려주세요' },
  { level: 'L3', label: '번호 없이 접수했다고 표시' },
]

/**
 * L2 가 확인 못 했을 때 내미는 길 → ADR-077. 파일이 근거가 못 됐으니
 * **번호를 적는 쪽(L1)** 으로 돌려보낸다. 파일을 다시 올리라고는 하지 않는다 —
 * 같은 파일을 다시 올려도 같은 결과다.
 */
const NEXT_AFTER_L2: readonly NextOption[] = [
  { level: 'L1', label: '접수번호를 적어 주세요' },
  { level: 'L3', label: '번호 없이 접수했다고 표시' },
]

/**
 * L3 이 왜 완료가 아닌지 사용자에게 하는 말. **문구의 정본은 08-14-api.md §3.8 입니다.**
 *
 * 이 칸을 안 내보내면 화면은 「아직 완료로 기록하지 않았습니다」만 그리고,
 * 사용자에게는 **버튼이 안 먹은 것처럼** 보인다. 완료로 만들면 안 되는 것은 맞지만
 * (불변 규칙 6), 이유를 말하지 않는 것은 계약에 없던 일이다.
 *
 * ⚠️ **여기에 `nextOptions` 를 붙이지 않는다.** L3 은 실패가 아니라 검증할 것이
 * 없었다는 뜻이고, 사용자는 할 수 있는 것을 다 했다 → README.
 */
const SELF_REPORT_NOTE = '완료로 기록되지 않습니다. 접수번호를 확인하시면 알려주세요'

/** L2 가 완료로 기록하지 못했을 때의 말 → 08-14-api.md §3.8 「응답 200 — L2 확인 못 함」 */
const L2_NOTES = {
  reading_pending: '올린 자료를 읽는 중입니다. 접수번호나 기관명이 보이면 완료로 기록합니다',
  unreadable: '올렸지만 읽지 못했습니다. 접수번호를 적어 주시면 확인합니다',
  not_a_document:
    '통화 녹음은 접수증이 아닙니다. 접수증이나 접수 문자 캡처를 올리거나 접수번호를 적어 주세요',
  no_receipt_marks: '올렸지만 접수번호나 기관명을 찾지 못했습니다. 접수번호를 적어 주시면 확인합니다',
} as const

export function createCompletionChecker(deps: {
  receiptFormat: ReceiptNumberFormat
}): CompletionChecker {
  const { receiptFormat } = deps

  return {
    verify(input: CompletionInput): CompletionVerdict {
      return verifyOne(input.submission, receiptFormat, input.evidence ?? null, input.orgNames ?? [])
    },
  }
}

function verifyOne(
  submission: ArtifactSubmission,
  receiptFormat: ReceiptNumberFormat,
  evidence: EvidenceReading | null,
  orgNames: readonly string[],
): CompletionVerdict {
  switch (submission.kind) {
    // L1 — 접수번호 포맷 체크
    case 'receipt_no':
      return verifyReceiptNumber(submission.value, receiptFormat)

    // L2 — 캡처·서류를 올렸다. **판독 결과를 본다** → ADR-077
    case 'sms_capture':
    case 'receipt_doc':
      return verifyUpload(evidence, orgNames)

    // L3 — 했다고만 말했다. **완료가 아니다**
    case 'other':
      return {
        verifyLevel: 'L3',
        // 검증할 것이 없었다는 뜻이다. 실패와 다르다
        verifyResult: 'not_applicable',
        // 종결 상태가 아니라 리마인더 추적 대상으로 남는다
        stepState: 'unconfirmed',
        // **왜 완료가 아닌지 말해 준다** — 안 그러면 눌러도 아무 일이 없는 것처럼 보인다
        note: SELF_REPORT_NOTE,
      }
  }
}

/**
 * 접수번호 **모양**인가 — 형식 규격이 아니라 오타·빈칸 거르개다 → ADR-057.
 *
 * **어느 기관의 형식도 주장하지 않는다.** 「식별자로 쓸 수 있는 문자열인가」만 본다.
 * 구분자를 떼고 남은 것이 영숫자 6자 이상이고 숫자가 하나라도 있으면 통과다.
 *
 *     2026-004821        -> 2026004821    통과
 *     KB-20260826-0001   -> KB20260826…   통과
 *     9                  -> 9             거름 (짧다)
 *     ㅇㅇ                -> ㅇㅇ           거름 (영숫자가 아니다)
 *
 * 여기서 걸려도 막다른 길이 아니다 — L2·L3 이 그대로 열려 있다.
 */
export function looksLikeReceiptNumber(value: string): boolean {
  const bare = value.replace(/[\s\-–—./_()]/g, '')
  return bare.length >= 6 && /^[0-9A-Za-z]+$/.test(bare) && /[0-9]/.test(bare)
}

/**
 * 판독 글에서 「접수번호」 **자리** — 이 낱말들 뒤에 번호가 온다.
 *
 * 자리 없이 숫자만 보지 않는다. 「2026-09-05」(날짜)도 구분자를 떼면 여덟 자리라
 * `looksLikeReceiptNumber` 를 통과하는데, 이체 캡처에는 날짜·금액·승인번호가
 * 가득하다. 절차가 남긴 것은 **「접수번호」라고 적힌 번호**다.
 */
const RECEIPT_LABEL =
  /(?:접수\s*증?\s*번호|사건\s*(?:접수\s*)?번호|신고\s*번호|민원\s*번호|관리\s*번호|처리\s*번호|공고\s*번호|접수\s*No\.?|Receipt\s*No\.?)/giu

/** 자리 뒤에서 이만큼 안에 번호가 있어야 한다 — 줄바꿈·콜론을 건너뛰고 */
const AFTER_LABEL = 48

/**
 * 가린 이름표 — `[계좌-1]`·`[전화-2]` 처럼 토큰화가 남긴 것.
 *
 * 전사문은 토큰화된 상태다(04-pii-boundary.md 규칙 2). 접수번호가 계좌·전화로
 * 잡혀 가려질 수 있고, 그러면 원문은 서버에 없다. **자리 뒤에 이름표가 있으면
 * 그 번호가 거기 있었다는 뜻**이라 통과시킨다. 이름(`[이름-N]`)은 번호가 아니다.
 */
const MASKED_NUMBER = /^\[(?!이름)[^\]\s]+-\d+\]/u

/**
 * 판독 글에서 접수번호 자리와 공공기관 이름을 찾는다 → ADR-077.
 *
 * **순수 함수다.** 글과 이름 목록만 받는다 — 시험이 표로 걸 수 있어야 하고,
 * 라우트와 `settle-artifacts` 가 같은 판정을 써야 한다.
 */
export function findReceiptMarks(
  text: string,
  orgNames: readonly string[],
): { readonly receiptNumber: boolean; readonly orgName: boolean } {
  return { receiptNumber: hasReceiptNumber(text), orgName: hasOrgName(text, orgNames) }
}

function hasReceiptNumber(text: string): boolean {
  RECEIPT_LABEL.lastIndex = 0
  for (let hit = RECEIPT_LABEL.exec(text); hit; hit = RECEIPT_LABEL.exec(text)) {
    const after = text
      .slice(hit.index + hit[0].length, hit.index + hit[0].length + AFTER_LABEL)
      .replace(/^[\s:：]+/u, '')
    if (MASKED_NUMBER.test(after)) return true
    // 자리 바로 뒤의 첫 마디 — 영숫자와 구분자로 이어진 만큼
    const run = /^[0-9A-Za-z][0-9A-Za-z\-–—./_]*/u.exec(after)
    if (run && looksLikeReceiptNumber(run[0])) return true
  }
  return false
}

/**
 * 기관명 대조 — **이름·별칭을 글자 그대로** 찾는다.
 *
 * 숫자뿐인 별칭(`112`·`1332`)과 한 글자는 안 본다. 금액(「1,120,000원」)과
 * 시각(「13:32」)에 흔히 섞여, 이체 캡처가 통과한다.
 */
function hasOrgName(text: string, orgNames: readonly string[]): boolean {
  for (const name of orgNames) {
    const term = name.trim()
    if (term.length < 2) continue
    if (/^[0-9\-\s]+$/u.test(term)) continue
    if (text.includes(term)) return true
  }
  return false
}

/**
 * L2 — 올린 자료를 읽은 결과로 판정한다 → ADR-077.
 *
 * **완료가 안 되는 쪽은 전부 `unconfirmed` 다** — 사용자가 무언가를 냈고
 * 우리가 확인을 못 한 상태라, L3 과 같은 자리(리마인더 추적 대상)에 둔다.
 * `in_progress` 로 두면 「아무것도 안 낸 것」과 구분이 안 된다.
 */
function verifyUpload(
  evidence: EvidenceReading | null,
  orgNames: readonly string[],
): CompletionVerdict {
  if (evidence === null || evidence.ingestStatus === 'failed') return unconfirmed('unreadable')
  // 통화 녹음은 서류가 아니다 — 안에 「접수번호」가 들리더라도 절차가 남긴 것이 아니다
  if (evidence.kind === 'audio') return unconfirmed('not_a_document')

  if (evidence.ingestStatus !== 'done' || evidence.text === null) {
    return {
      verifyLevel: 'L2',
      // 실패가 아니다 — 아직 볼 것이 없다. 읽기가 끝나면 다시 판정한다
      verifyResult: 'not_applicable',
      stepState: 'unconfirmed',
      verifyDetail: { reason: 'reading_pending' },
      note: L2_NOTES.reading_pending,
      // 기다리면 되는 자리라 다른 길을 내밀지 않는다
    }
  }

  const marks = findReceiptMarks(evidence.text, orgNames)
  if (marks.receiptNumber || marks.orgName) {
    return {
      verifyLevel: 'L2',
      verifyResult: 'passed',
      stepState: 'done_verified',
      // **통과에도 이유를 남긴다** — 무엇을 보고 통과시켰는지가 나중에 셀 값이다
      verifyDetail: { reason: marks.receiptNumber ? 'receipt_number_found' : 'org_name_found' },
    }
  }

  return unconfirmed('no_receipt_marks')
}

/** 올렸지만 확인 못 함 — 이유를 말하고, 번호를 적는 길을 낸다 */
function unconfirmed(
  reason: 'unreadable' | 'not_a_document' | 'no_receipt_marks',
): CompletionVerdict {
  return {
    verifyLevel: 'L2',
    verifyResult: 'failed',
    verifyDetail: { reason },
    stepState: 'unconfirmed',
    note: L2_NOTES[reason],
    nextOptions: NEXT_AFTER_L2,
  }
}

/**
 * **L1 은 「형식이 맞나」가 아니라 「받아 적었나」를 묻는다** → ADR-057.
 *
 * 형식 정본이 없어서 내린 결론이 아니라, **부산물 원리가 원래 그것**이다 —
 * 불변 규칙 6이 말하는 근거는 「형식이 맞다」가 아니라 「그것이 존재한다」이고,
 * 접수번호는 절차를 밟지 않으면 생기지 않는다.
 *
 * 형식 대조는 **할 수 있을 때만 얹는 덤**이다. 지금은 아무 기관도 못 얹는다.
 */
function verifyReceiptNumber(
  value: string,
  receiptFormat: ReceiptNumberFormat,
): CompletionVerdict {
  const trimmed = value.trim()

  if (!looksLikeReceiptNumber(trimmed)) return failed('not_identifier')

  const matched = receiptFormat.matches(trimmed)

  if (matched === false) return failed('format_mismatch')

  return {
    verifyLevel: 'L1',
    verifyResult: 'passed',
    stepState: 'done_verified',
    // **통과에도 이유를 남긴다.** 형식을 대조한 통과와 모양만 본 통과는 다른 일이고,
    // 형식 정본이 생기는 날 다시 볼 것을 여기서 센다 → types.ts VerifyReason
    ...(matched === undefined ? { verifyDetail: { reason: 'format_unchecked' as const } } : {}),
  }
}

/**
 * 실패해도 단계가 뒤로 가지 않는다 — `in_progress` 다.
 * 그리고 **다음 길을 함께 낸다.** 막다른 길을 만들지 않는다.
 *
 * `reason` 외에 아무것도 담지 않는다. 입력한 값은 개인정보일 수 있다 → §7.
 */
function failed(reason: 'not_identifier' | 'format_mismatch'): CompletionVerdict {
  return {
    verifyLevel: 'L1',
    verifyResult: 'failed',
    verifyDetail: { reason },
    stepState: 'in_progress',
    nextOptions: NEXT_OPTIONS,
  }
}
