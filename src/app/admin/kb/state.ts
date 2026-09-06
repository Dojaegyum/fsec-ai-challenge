/**
 * S-12 의 상태 — 렌즈 · 선택 · 필터. 순수 리듀서 하나입니다 (화면 설계 S-12).
 * 두 렌즈는 같은 두 응답(큐 · 매뉴얼)을 재조합할 뿐이라 여기에 데이터를 두지 않습니다.
 */
import type { QueueBody } from '@/flows/kb-review'

export type Lens = 'article' | 'entry'
export type Filter = 'all' | 'first' | 'changed' | 'deferred' | 'page'
export type Selection = { readonly changeId: string } | { readonly kbEntryId: string } | null

export interface ReviewState {
  readonly lens: Lens
  readonly selected: Selection
  readonly filter: Filter
}

export type Action =
  | { readonly type: 'set-lens'; readonly lens: Lens }
  | { readonly type: 'set-filter'; readonly filter: Filter }
  | { readonly type: 'pick-change'; readonly changeId: string }
  | { readonly type: 'pick-entry'; readonly kbEntryId: string }
  | { readonly type: 'clear' }

export const initialState: ReviewState = { lens: 'article', selected: null, filter: 'all' }

export function reduce(state: ReviewState, action: Action): ReviewState {
  switch (action.type) {
    case 'set-lens':
      return state.lens === action.lens ? state : { ...state, lens: action.lens, selected: null }
    case 'set-filter':
      return { ...state, filter: action.filter }
    case 'pick-change':
      // 조문을 고르면 렌즈도 조문 기준 — 매뉴얼 상세의 조문 행에서 넘어오는 길입니다
      return { ...state, lens: 'article', selected: { changeId: action.changeId } }
    case 'pick-entry':
      return { ...state, lens: 'entry', selected: { kbEntryId: action.kbEntryId } }
    case 'clear':
      return { ...state, selected: null }
  }
}

/** 판단 뒤 초점을 옮길 다음 건 — 목록 순서에서 바로 다음 pending. 없으면 null */
export function nextPendingAfter(groups: QueueBody['groups'], changeId: string): string | null {
  const flat = groups.flatMap((group) => group.changes)
  const at = flat.findIndex((one) => one.change_id === changeId)
  const next = flat.slice(at + 1).find((one) => one.review_status === 'pending')
  return next?.change_id ?? null
}
