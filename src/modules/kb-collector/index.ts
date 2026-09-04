/**
 * kb-collector — 감시 소스에서 원문을 가져와 스냅샷으로 보관한다 (층 4 · 하루 1회)
 *
 * **공개 API 입니다.** 밖에서는 이 파일만 import 합니다 → RFC-001.
 *
 * **`kb_entry` 를 쓰지 않습니다.** 사람 승인을 거쳐야만 매뉴얼에 들어갑니다
 * → spec/backend/08-14-kb-operations.md 원칙 4.
 */

import 'server-only'

export { createKbCollector } from './collect'
export type {
  Clock,
  CollectResult,
  FetchedItem,
  Hasher,
  IdSource,
  KbCollector,
  PendingChange,
  RegistryStore,
  Snapshot,
  SnapshotStore,
  SourceFetcher,
  SourceResult,
  SourceType,
  WatchedSource,
  WatchMethod,
} from './types'
