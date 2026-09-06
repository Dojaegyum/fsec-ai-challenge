# 추론 팟 자동 복구 — 구현 계획

> **에이전트에게:** 이 계획은 `superpowers:subagent-driven-development` 또는 `superpowers:executing-plans` 로
> 태스크 하나씩 실행합니다. 단계는 체크박스(`- [ ]`)로 추적합니다.

**목표:** RunPod 팟이 죽어도 ① 올린 녹음·화면은 「재시도중」으로 기다렸다가 팟이 돌아오면 스스로 이어지고,
② 팟 안 프로세스는 팟 안에서 되살아나며, ③ 팟 자체는 상시 서버(OCI)의 감시자가 다시 세운다.

**구조:** 앱은 어댑터가 「못 닿음」을 `TransientError` 로 표시하고, 모듈이 그것을 `detail.transient` 로 올리며,
흐름(`read-evidence.ts`)이 그 표시로 「재시도중」 갈래를 탄다. 서버 혼자 할 수 있는 다시 맡기기는 `POST /api/cron/evidence-resubmit`.
인프라는 팟 안 `watchdog.sh`(20초 · 조치 뒤 유예 180초)와 OCI 의 systemd 서비스 `finally-runpod-watch`(30초 · 세지 않음 ·
싼 조치부터)이고, 새 팟의 주소 교체는 기존 `vercel-env` 워크플로를 GitHub API 로 건다.

**기술:** Next 16 App Router · TypeScript · vitest · postgres(`Sql`) · Python 3.12 표준 라이브러리만(urllib · json · subprocess) ·
systemd · RunPod REST/GraphQL · GitHub REST · Brevo REST. **새 npm·pip 의존성 없음.**

**정본:** [ADR-091](../../decisions/091-evidence-retrying-not-failed.md) · [ADR-092](../../decisions/092-pod-self-heal-and-watcher.md) ·
[API §3.3 · §6](../../spec/common/08-14-api.md) · [에러 §2 · §3.1](../../spec/backend/08-16-errors.md) ·
[ADR-078](../../decisions/078-shell-polls-all-processing-evidence.md) · [`deploy/runpod-bench.md`](../../deploy/runpod-bench.md)

## 전역 제약

- **원문을 저장·응답에 싣지 않는다.** 토큰화가 실패한 원문은 함수 메모리에서 버린다 (불변 규칙 2·3 · ADR-091 §3).
- **`ingest_status` 의 허용값은 그대로** `pending`·`processing`·`done`·`failed`. 「재시도중」은 응답의 `progress.retrying: true` 로만 (ADR-091 §2). **마이그레이션 없음.**
- **재시도중의 `poll_after_ms` 는 5000**, 평소는 1500 (ADR-091 §2).
- **일시적 = 연결 실패 · 타임아웃 · 5xx.** 4xx 는 최종적. 묻기의 404 는 그대로 `missing` (ADR-091 §1).
- **오류 응답은 스스로 다시 부르지 않는다** (에러 §3.1) — 그래서 일시적 실패는 오류가 아니라 `processing` 으로 답한다.
- **횟수·시간 상한 없음** (ADR-091 §4). 서버 다시 맡기기는 48시간 · 한 번에 20건 (ADR-091 §5).
- **감시자는 세지 않는다.** 조치 뒤 유예 180초 · 주기 30초 · API 가 팟이 없다면 바로 새 팟 · RUNNING 인데 죽었으면 ssh 재시작 → 180초 뒤에도 안 되면 새 팟 (ADR-092 C).
- **비밀값은 저장소 밖.** OCI 는 `/etc/finally/watch.env`, 팟 ssh 키는 `~/.ssh/id_ed25519_finally` (RFC-001 「deploy/」).
- **기계가 부르는 앱 주소는 `/api/cron/` 아래** — 문지기가 `Authorization: Bearer <CRON_SECRET>` 로 지킨다. 새 문을 열지 않는다.
- **새 라우트는 `handleRoute` 를 지나고 POST 는 `rate:` 를 밝힌다** (route-contract 검사기).
- 명령은 앱은 `src/` 안에서: `cd src && npx vitest run <파일>` · `npm run typecheck` · `npm run lint`. 문서 검사기는 루트에서 `python3 .github/scripts/doc-integrity.py` · `python3 .github/scripts/route-contract.py`.
- 작업 폴더는 worktree `fsec-wt-autowake`(브랜치 `feat/runpod-auto-wake`). 공유 트리를 건드리지 않는다. 모든 셸 명령은 `cd <절대경로> && …` 로 시작한다.
- 커밋 메시지는 이 저장소의 결(한국어 제목 · 왜를 본문에)로, 끝에 `Co-Authored-By` 와 `Claude-Session` 줄.

---

## 파일 지도

| 파일 | 하는 일 | 태스크 |
| --- | --- | --- |
| `src/lib/errors.ts` (수정) | `TransientError` · `isTransient()` — 「닿지 못함」 표시 | 1 |
| `src/lib/inference.ts` · `src/lib/ner.ts` (수정) | 연결 실패 · 타임아웃 · 5xx 를 `TransientError` 로 | 2 · 3 |
| `src/modules/transcriber/transcribe.ts` (수정) | `IngestError.detail.transient` | 4 |
| `src/modules/pii-tokenizer/tokenize.ts` (수정) | `PiiTokenizerUnavailableError.detail.transient` | 5 |
| `src/flows/read-evidence.ts` (수정) | 「재시도중」 갈래 셋 · `retryOnce` · `RETRY_POLL_AFTER_MS` | 6 · 7 |
| `src/app/api/cases/[case_token]/evidence/[evidence_id]/route.ts` · `complete/route.ts` (수정) | 응답에 `progress.retrying` | 8 |
| `src/lib/db.ts` (수정) · `src/flows/resubmit-evidence.ts` (신설) · `src/app/api/cron/evidence-resubmit/route.ts` (신설) | 서버 혼자 다시 맡기기 | 9 |
| `src/app/c/[token]/load.ts` · `evidence.tsx` (수정) | 「다시 연결하는 중」 문구 | 10 |
| `spec/common/08-14-api.md` · `spec/backend/08-16-errors.md` · `src/modules/transcriber/README.md` (수정) | 계약 동기화 | 11 |
| `deploy/runpod-provision.sh` (수정) | `restart.sh` 가 시각을 남기고, `watchdog.sh` 를 만들고 띄움 | 12 |
| `deploy/runpod-pod.py` (수정) | 함수화(`PodError` · `list_pods` · `create_pod` · `provision` · `wait_ready` · `health_once` · `terminate`) — CLI 는 그대로 | 13 |
| `deploy/runpod-watch.py` (신설) · `deploy/test_runpod_watch.py` (신설) | 감시자 — 판단은 순수 함수 `decide()`, 조치는 따로 | 14 · 15 |
| `deploy/finally-runpod-watch.service` · `deploy/runpod-watch-install.sh` · `deploy/watch.env.example` (신설) · `deploy/README.md` · `deploy/runpod-bench.md` (수정) | OCI 설치와 운영 문서 | 16 |
| `docs/plans/README.md` (수정) | 이 계획 등록 | 11 |

---

### Task 1: `TransientError` — 「닿지 못함」을 표시하는 예외

**Files:**
- Modify: `src/lib/errors.ts` (`IngestError` 정의 아래, `StoreError` 앞)
- Test: `src/lib/errors.test.ts`

**Interfaces:**
- Produces: `class TransientError extends Error { readonly transient: true; readonly status?: number }` ·
  `function isTransient(error: unknown): boolean`. 뒤 태스크 전부가 이 둘을 `@/lib/errors` 에서 가져다 쓴다.

- [ ] **Step 1: 실패하는 시험을 쓴다**

`src/lib/errors.test.ts` 끝에 추가:

```ts
import { AppError, TransientError, isTransient } from './errors'

describe('TransientError — 닿지 못한 실패의 표시 (ADR-091)', () => {
  it('AppError 가 아니고, transient 표시와 상태 코드만 든다', () => {
    const e = new TransientError('전사 서비스가 답하지 못했습니다', 502)
    expect(e).toBeInstanceOf(Error)
    expect(e).not.toBeInstanceOf(AppError)
    expect(e).not.toHaveProperty('httpStatus')
    expect(e.message).toBe('전사 서비스가 답하지 못했습니다 (502)')
    expect(isTransient(e)).toBe(true)
  })

  it('보통 Error · null 은 일시적이 아니다', () => {
    expect(isTransient(new Error('x'))).toBe(false)
    expect(isTransient(null)).toBe(false)
    expect(isTransient(undefined)).toBe(false)
  })
})
```

(파일 머리의 기존 `import { … } from './errors'` 에 `TransientError, isTransient` 를 합쳐도 됩니다 — 중복 import 는 lint 가 막습니다.)

- [ ] **Step 2: 실패를 확인한다**

Run: `cd src && npx vitest run lib/errors.test.ts`
Expected: FAIL — `TransientError is not exported` 류.

- [ ] **Step 3: 구현한다**

`src/lib/errors.ts` 의 `IngestError` 클래스 바로 아래:

```ts
/**
 * 상대 서비스에 **닿지 못한** 실패 — 연결 실패 · 타임아웃 · 5xx.
 *
 * `AppError` 가 **아닙니다.** 어댑터(`lib/inference.ts` · `lib/ner.ts`)가 던지고, 모듈이
 * 자기 예외(`IngestError` · `PiiTokenizerUnavailableError`)로 감쌀 때 `detail.transient`
 * 로 옮깁니다 → ADR-091 §1. 흐름은 그 표시로 「재시도중」 갈래를 탑니다.
 *
 * 4xx 는 여기 안 듭니다 — 요청 자체가 거절된 것이라 다시 보내도 같습니다.
 */
export class TransientError extends Error {
  readonly transient = true as const

  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(status === undefined ? message : `${message} (${status})`)
    this.name = 'TransientError'
  }
}

/** 어댑터가 「일시적」이라고 표시한 실패인가 — 모듈이 감쌀 때, 흐름이 갈래를 정할 때 씁니다 */
export function isTransient(error: unknown): boolean {
  return (error as { transient?: unknown } | null)?.transient === true
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `cd src && npx vitest run lib/errors.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
cd /mnt/c/Users/TaeHyounKim/Documents/HACKERTON/finance2026/fsec-wt-autowake && git add src/lib/errors.ts src/lib/errors.test.ts && git commit -q -F - <<'MSG'
「닿지 못함」을 표시하는 TransientError 를 둔다 — 어댑터가 던지고 모듈이 detail.transient 로 옮긴다 (ADR-091 §1)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LaeBtmCj3cYVMYB39Z4gba
MSG
```

---

### Task 2: 전사 어댑터 — 연결 실패 · 타임아웃 · 5xx 를 `TransientError` 로

**Files:**
- Modify: `src/lib/inference.ts` (`call()` 안의 catch 와 `!res.ok` 분기)
- Test: `src/lib/inference.test.ts`

**Interfaces:**
- Consumes: `TransientError`, `isTransient` (Task 1)
- Produces: `stt.submit`·`stt.poll`·`ocr.*` 가 닿지 못하면 `TransientError` 를 던진다. 4xx 는 지금처럼 `RefusedError`(파일 안 클래스), 묻기 404 는 `{ status: 'missing' }`.

- [ ] **Step 1: 실패하는 시험을 쓴다**

`src/lib/inference.test.ts` 끝에 추가 (파일 머리 import 에 `import { isTransient } from './errors'` 추가):

```ts
describe('일시적 실패를 표시한다 — ADR-091 §1', () => {
  it('닿지 못하면 transient 다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    }))
    const { stt } = createInferenceEngines(CFG)

    const thrown = await stt.submit({ url: 'u', mimeType: 'audio/m4a' }).catch((e: unknown) => e)

    expect(isTransient(thrown)).toBe(true)
    expect(thrown).not.toHaveProperty('httpStatus')
  })

  it('5xx 도 transient 다 — RunPod 프록시가 팟 대신 내는 502 포함', async () => {
    server([{ status: 502 }])
    const { stt } = createInferenceEngines(CFG)

    expect(isTransient(await stt.poll('j1').catch((e: unknown) => e))).toBe(true)
  })

  it('4xx 는 일시적이 아니다 — 요청이 거절된 것', async () => {
    server([{ status: 413 }])
    const { stt } = createInferenceEngines(CFG)

    expect(isTransient(await stt.submit({ url: 'u', mimeType: 'audio/m4a' }).catch((e: unknown) => e))).toBe(false)
  })

  it('묻기의 404 는 여전히 「없다」다 — 회귀', async () => {
    server([{ status: 404 }])
    const { stt } = createInferenceEngines(CFG)

    expect(await stt.poll('j1')).toEqual({ status: 'missing' })
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd src && npx vitest run lib/inference.test.ts`
Expected: 새 시험 중 앞 둘이 FAIL (`isTransient` 가 false).

- [ ] **Step 3: 구현한다**

`src/lib/inference.ts` — import 에 `import { TransientError } from './errors'` 를 넣고, `call()` 을 이렇게 바꿉니다:

```ts
  let res: Response
  try {
    res = await fetch(`${cfg.baseUrl}${path}`, {
      ...init,
      headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
      signal: AbortSignal.timeout(cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      // 이 응답은 절대 캐시되면 안 됩니다 — 진행률이 굳어 버립니다
      cache: 'no-store',
    })
  } catch {
    // **닿지 못한 것은 일시적입니다** → ADR-091 §1. 흐름이 「재시도중」으로 답합니다
    throw new TransientError('전사 서비스에 닿지 못했습니다')
  }

  // 5xx 도 일시적입니다 — 팟이 없을 때 RunPod 프록시가 502·503·504 를 냅니다.
  // 4xx 는 요청이 거절된 것이라 다시 보내도 같습니다(아래 RefusedError 그대로)
  if (res.status >= 500) throw new TransientError('전사 서비스가 답하지 못했습니다', res.status)
  if (!res.ok) throw new RefusedError('전사 서비스가 거절했습니다', res.status)
```

파일 머리 주석의 「왜 기다리지 않나」 아래에 한 절을 더합니다:

```ts
 * ## 닿지 못한 것과 거절된 것을 가릅니다 — ADR-091
 *
 * 연결 실패 · 타임아웃 · 5xx 는 `TransientError`(일시적), 4xx 는 `RefusedError`(최종적)입니다.
 * 둘 다 이 계층의 `AppError` 는 아닙니다 — 모듈이 `IngestError` 로 감싸며 `detail.transient` 로 옮깁니다.
```

- [ ] **Step 4: 통과를 확인한다**

Run: `cd src && npx vitest run lib/inference.test.ts`
Expected: PASS (기존 「이 계층의 예외를 지어내지 않는다」 시험도 그대로 — `TransientError` 에는 `httpStatus` 가 없습니다).

- [ ] **Step 5: 커밋**

```bash
cd /mnt/c/Users/TaeHyounKim/Documents/HACKERTON/finance2026/fsec-wt-autowake && git add src/lib/inference.ts src/lib/inference.test.ts && git commit -q -F - <<'MSG'
전사 어댑터가 연결 실패·타임아웃·5xx 를 TransientError 로 던진다 — 4xx 와 묻기 404 는 그대로 (ADR-091 §1)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LaeBtmCj3cYVMYB39Z4gba
MSG
```

---

### Task 3: 이름 탐지 어댑터 — 같은 규칙

**Files:**
- Modify: `src/lib/ner.ts` (`find()` 안의 catch 와 `!res.ok`)
- Test: `src/lib/ner.test.ts`

**Interfaces:**
- Consumes: `TransientError` (Task 1)
- Produces: `NerModel.find()` 가 닿지 못하거나 5xx 면 `TransientError`. 4xx 는 지금처럼 일반 `Error`.

- [ ] **Step 1: 실패하는 시험을 쓴다**

`src/lib/ner.test.ts` 끝에 추가 (import 에 `import { isTransient } from './errors'`):

```ts
describe('일시적 실패를 표시한다 — ADR-091 §1', () => {
  const asResponse = (status: number) =>
    ({ ok: status < 400, status, json: async () => ({}) }) as Response

  it('닿지 못하면 transient 다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('ETIMEDOUT')
    }))
    const model = createNerModel({ baseUrl: BASE })

    expect(isTransient(await model.find('김도현').catch((e: unknown) => e))).toBe(true)
  })

  it('503 도 transient 다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => asResponse(503)))
    const model = createNerModel({ baseUrl: BASE })

    expect(isTransient(await model.find('김도현').catch((e: unknown) => e))).toBe(true)
  })

  it('401 은 아니다 — 비밀값이 틀린 것은 기다려도 안 낫는다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => asResponse(401)))
    const model = createNerModel({ baseUrl: BASE })

    const thrown = await model.find('김도현').catch((e: unknown) => e)
    expect(thrown).toBeInstanceOf(Error)
    expect(isTransient(thrown)).toBe(false)
  })
})
```

(이 파일의 다른 시험이 `afterEach(() => vi.unstubAllGlobals())` 를 이미 하고 있는지 확인하고, 없으면 같은 줄을 더합니다.)

- [ ] **Step 2: 실패를 확인한다**

Run: `cd src && npx vitest run lib/ner.test.ts`
Expected: 앞 둘 FAIL.

- [ ] **Step 3: 구현한다**

`src/lib/ner.ts` — import 에 `import { TransientError } from './errors'`, `find()` 안:

```ts
      } catch {
        // **닿지 못한 것은 일시적입니다** → ADR-091 §1. `pii-tokenizer` 가 감쌀 때
        // `detail.transient` 로 옮기고, 자료 흐름은 원문을 버리고 「재시도중」으로 답합니다
        throw new TransientError('탐지 서비스에 닿지 못했습니다')
      }

      if (res.status >= 500) throw new TransientError('탐지 서비스가 답하지 못했습니다', res.status)
      if (!res.ok) throw failed('탐지 서비스가 거절했습니다', res.status)
```

- [ ] **Step 4: 통과를 확인한다**

Run: `cd src && npx vitest run lib/ner.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
cd /mnt/c/Users/TaeHyounKim/Documents/HACKERTON/finance2026/fsec-wt-autowake && git add src/lib/ner.ts src/lib/ner.test.ts && git commit -q -F - <<'MSG'
이름 탐지 어댑터도 닿지 못함·5xx 를 TransientError 로 던진다 (ADR-091 §1)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LaeBtmCj3cYVMYB39Z4gba
MSG
```

---

### Task 4: `transcriber` 모듈 — `IngestError.detail.transient`

**Files:**
- Modify: `src/modules/transcriber/transcribe.ts` (`ingestFailed` 의 detail 타입 · `start` 의 submit catch · `collect` 의 poll catch)
- Test: `src/modules/transcriber/transcribe.test.ts`

**Interfaces:**
- Consumes: `isTransient` (Task 1)
- Produces: `IngestError.detail.transient: boolean` — `submit_failed`·`poll_failed` 에 붙는다. `read_url_failed` 에는 안 붙는다(최종적).

- [ ] **Step 1: 실패하는 시험을 쓴다**

`src/modules/transcriber/transcribe.test.ts` 끝에 추가 (import 에 `import { IngestError, TransientError } from '@/lib/errors'` — 이미 있는 것과 합칩니다):

```ts
describe('닿지 못한 것은 detail.transient 로 올린다 — ADR-091 §1', () => {
  const media = { objectKey: 'c/e', kind: 'audio' as const, mimeType: 'audio/m4a' }
  const deps = (submit: () => Promise<string>, poll: () => Promise<never>) => ({
    media: { readUrl: async () => 'https://store/x', readText: async () => '' },
    stt: { submit, poll },
    ocr: { submit, poll },
  })

  it('맡기기가 TransientError 면 transient: true', async () => {
    const t = createTranscriber(
      deps(
        async () => {
          throw new TransientError('닿지 못함')
        },
        async () => {
          throw new Error('unused')
        },
      ) as never,
    )

    const thrown = (await t.start({ media, jobId: 'j1' }).catch((e: unknown) => e)) as IngestError
    expect(thrown).toBeInstanceOf(IngestError)
    expect(thrown.detail).toMatchObject({ reason: 'submit_failed', transient: true })
  })

  it('맡기기가 보통 Error 면 transient: false', async () => {
    const t = createTranscriber(
      deps(
        async () => {
          throw new Error('거절 (413)')
        },
        async () => {
          throw new Error('unused')
        },
      ) as never,
    )

    const thrown = (await t.start({ media, jobId: 'j1' }).catch((e: unknown) => e)) as IngestError
    expect(thrown.detail).toMatchObject({ reason: 'submit_failed', transient: false })
  })

  it('묻기가 TransientError 면 poll_failed 에 transient: true', async () => {
    const t = createTranscriber(
      deps(
        async () => 'j1',
        async () => {
          throw new TransientError('닿지 못함', 502)
        },
      ) as never,
    )

    const thrown = (await t
      .collect({ jobId: 'j1', phase: 'stt', kind: 'audio' })
      .catch((e: unknown) => e)) as IngestError
    expect(thrown.detail).toMatchObject({ reason: 'poll_failed', transient: true })
  })
})
```

(`createTranscriber` 의 `deps` 에 다른 필수 칸이 있으면 — 파일 머리 `TranscriberDeps` 를 보고 — 위 `deps()` 에 빈 구현을 더합니다. `as never` 는 시험용 좁힘입니다.)

- [ ] **Step 2: 실패를 확인한다**

Run: `cd src && npx vitest run modules/transcriber/transcribe.test.ts`
Expected: 셋 FAIL (`transient` 가 detail 에 없음).

- [ ] **Step 3: 구현한다**

`src/modules/transcriber/transcribe.ts`:

1. import 줄을 `import { AppError, IngestError, isTransient } from '@/lib/errors'` 로.
2. `ingestFailed` 의 detail 타입에 한 칸:

```ts
    /** 어디서 틀어졌나. **짧은 표시값만** — 예외 문구를 그대로 담지 않습니다 */
    readonly reason: string
    /** 닿지 못한 것인가(연결 · 타임아웃 · 5xx). 흐름이 「재시도중」 갈래를 정하는 표시 → ADR-091 §1 */
    readonly transient?: boolean
```

3. `start` 의 submit catch:

```ts
      } catch (error) {
        if (error instanceof AppError) throw error
        throw ingestFailed('읽어 달라고 맡기지 못했습니다', {
          objectKey: media.objectKey,
          kind: media.kind,
          phase,
          reason: 'submit_failed',
          transient: isTransient(error),
        })
      }
```

4. `collect` 의 poll catch:

```ts
      } catch (error) {
        if (error instanceof AppError) throw error
        throw ingestFailed('맡긴 일을 물어보지 못했습니다', {
          jobId: job.jobId,
          kind: job.kind,
          phase: job.phase,
          reason: 'poll_failed',
          transient: isTransient(error),
        })
      }
```

`read_url_failed` 는 손대지 않습니다(저장소 문제는 최종적으로 둡니다 — ADR-091 §1 표).

- [ ] **Step 4: 통과를 확인한다**

Run: `cd src && npx vitest run modules/transcriber/transcribe.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
cd /mnt/c/Users/TaeHyounKim/Documents/HACKERTON/finance2026/fsec-wt-autowake && git add src/modules/transcriber/transcribe.ts src/modules/transcriber/transcribe.test.ts && git commit -q -F - <<'MSG'
transcriber 가 맡기기·묻기의 「닿지 못함」을 IngestError.detail.transient 로 올린다 (ADR-091 §1)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LaeBtmCj3cYVMYB39Z4gba
MSG
```

---

### Task 5: `pii-tokenizer` — `PiiTokenizerUnavailableError.detail.transient`

**Files:**
- Modify: `src/modules/pii-tokenizer/tokenize.ts` (`tokenize()` 안 `ner.find` 의 catch)
- Test: `src/modules/pii-tokenizer/tokenize.test.ts`

**Interfaces:**
- Consumes: `isTransient` (Task 1)
- Produces: `PiiTokenizerUnavailableError.detail.transient: boolean`

- [ ] **Step 1: 실패하는 시험을 쓴다**

`src/modules/pii-tokenizer/tokenize.test.ts` 끝에 추가 (import 에 `import { PiiTokenizerUnavailableError, TransientError } from '@/lib/errors'`):

```ts
describe('모델이 닿지 않는 것은 detail.transient 로 올린다 — ADR-091 §1', () => {
  it('TransientError 면 transient: true', async () => {
    const tokenizer = createPiiTokenizer({
      ner: {
        find: async () => {
          throw new TransientError('닿지 못함')
        },
      },
    })

    const thrown = (await tokenizer.tokenize('김민수 고객님').catch((e: unknown) => e)) as PiiTokenizerUnavailableError
    expect(thrown).toBeInstanceOf(PiiTokenizerUnavailableError)
    expect(thrown.detail).toMatchObject({ transient: true })
  })

  it('보통 Error 면 transient: false — 지금까지의 503 그대로', async () => {
    const tokenizer = createPiiTokenizer({
      ner: {
        find: async () => {
          throw new Error('거절 (401)')
        },
      },
    })

    const thrown = (await tokenizer.tokenize('김민수 고객님').catch((e: unknown) => e)) as PiiTokenizerUnavailableError
    expect(thrown.detail).toMatchObject({ transient: false })
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd src && npx vitest run modules/pii-tokenizer/tokenize.test.ts`
Expected: 둘 FAIL.

- [ ] **Step 3: 구현한다**

`src/modules/pii-tokenizer/tokenize.ts` — errors import 에 `isTransient` 를 더하고:

```ts
        } catch (error) {
          // 통과시키고 로그만 남기는 경로를 만들지 않습니다 → 10-errors.md 원칙 1.
          // **닿지 못한 것인지는 표시해 올립니다** — 자료 흐름이 원문을 버리고 「재시도중」으로
          // 답할지, 오류(503)로 낼지를 이 표시로 정합니다 → ADR-091 §1
          throw new PiiTokenizerUnavailableError(
            '개인정보 탐지 모델을 쓸 수 없습니다',
            { cause: error instanceof Error ? error.name : 'unknown', transient: isTransient(error) },
          )
        }
```

- [ ] **Step 4: 통과를 확인한다**

Run: `cd src && npx vitest run modules/pii-tokenizer/tokenize.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
cd /mnt/c/Users/TaeHyounKim/Documents/HACKERTON/finance2026/fsec-wt-autowake && git add src/modules/pii-tokenizer/tokenize.ts src/modules/pii-tokenizer/tokenize.test.ts && git commit -q -F - <<'MSG'
pii-tokenizer 가 모델의 「닿지 못함」을 detail.transient 로 올린다 (ADR-091 §1)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LaeBtmCj3cYVMYB39Z4gba
MSG
```

---

### Task 6: `startReading` — 일시적이면 `failed` 로 적지 않고, 완료 통지에서는 2초 뒤 한 번 더

**Files:**
- Modify: `src/flows/read-evidence.ts` (`StartOutcome` · `startReading`)
- Test: `src/flows/read-evidence.test.ts`

**Interfaces:**
- Consumes: `IngestError.detail.transient` (Task 4)
- Produces:
  ```ts
  export type StartOutcome =
    | { readonly ok: true }
    | { readonly ok: false; readonly reason: string; readonly transient: boolean }
  export interface StartOptions {
    /** 일시적 실패면 2초 뒤 한 번 더 — 완료 통지 라우트만 켭니다 (에러 §2 IngestError 1회) */
    readonly retryOnce?: boolean
    /** 시험이 기다림을 건너뛰려고 갈아 끼웁니다 */
    readonly sleep?: (ms: number) => Promise<void>
  }
  export async function startReading(input, container, opts?: StartOptions): Promise<StartOutcome>
  ```
  Task 7·8·9 가 `started.transient` 를 본다.

- [ ] **Step 1: 실패하는 시험을 쓴다**

`src/flows/read-evidence.test.ts` 끝에 추가:

```ts
describe('맡기기가 닿지 못하면 실패로 적지 않는다 — ADR-091 §3', () => {
  const input = {
    caseId: CASE_ID,
    evidenceId: EVIDENCE_ID,
    objectKey: KEY,
    kind: 'audio' as const,
    mimeType: 'audio/m4a',
  }

  function containerWhere(start: () => Promise<unknown>) {
    const failed: unknown[] = []
    const container = {
      transcriber: { start },
      evidenceWrite: {
        finish: async () => {},
        fail: async (one: unknown) => {
          failed.push(one)
        },
      },
    } as unknown as Container
    return { container, failed }
  }

  it('일시적이면 { ok: false, transient: true } 이고 evidenceWrite.fail 을 안 부른다', async () => {
    const { container, failed } = containerWhere(async () => {
      throw new IngestError('맡기지 못했습니다', { reason: 'submit_failed', transient: true })
    })

    const got = await startReading(input, container)

    expect(got).toEqual({ ok: false, reason: 'submit_failed', transient: true })
    expect(failed).toEqual([])
  })

  it('최종적이면 지금처럼 failed 로 적는다 — 회귀', async () => {
    const { container, failed } = containerWhere(async () => {
      throw new IngestError('맡기지 못했습니다', { reason: 'submit_failed', transient: false })
    })

    const got = await startReading(input, container)

    expect(got).toEqual({ ok: false, reason: 'submit_failed', transient: false })
    expect(failed).toEqual([{ caseId: CASE_ID, evidenceId: EVIDENCE_ID, reason: 'submit_failed' }])
  })

  it('retryOnce 면 일시적 실패 뒤 2초 기다렸다 한 번 더 맡긴다 — 두 번째가 되면 ok', async () => {
    let calls = 0
    const waited: number[] = []
    const { container, failed } = containerWhere(async () => {
      calls += 1
      if (calls === 1) throw new IngestError('맡기지 못했습니다', { reason: 'submit_failed', transient: true })
      return { started: true, job: { jobId: EVIDENCE_ID, phase: 'stt', kind: 'audio' } }
    })

    const got = await startReading(input, container, {
      retryOnce: true,
      sleep: async (ms) => {
        waited.push(ms)
      },
    })

    expect(got).toEqual({ ok: true })
    expect(calls).toBe(2)
    expect(waited).toEqual([2000])
    expect(failed).toEqual([])
  })

  it('retryOnce 라도 두 번 다 일시적이면 transient 로 답하고 failed 는 안 적는다', async () => {
    const { container, failed } = containerWhere(async () => {
      throw new IngestError('맡기지 못했습니다', { reason: 'submit_failed', transient: true })
    })

    const got = await startReading(input, container, { retryOnce: true, sleep: async () => {} })

    expect(got).toEqual({ ok: false, reason: 'submit_failed', transient: true })
    expect(failed).toEqual([])
  })

  it('최종적 실패는 retryOnce 여도 다시 안 맡긴다 — 같은 요청은 같은 결과', async () => {
    let calls = 0
    const { container } = containerWhere(async () => {
      calls += 1
      throw new IngestError('맡기지 못했습니다', { reason: 'submit_failed', transient: false })
    })

    await startReading(input, container, { retryOnce: true, sleep: async () => {} })

    expect(calls).toBe(1)
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd src && npx vitest run flows/read-evidence.test.ts`
Expected: 새 describe 의 시험이 FAIL (`transient` 칸 없음 · `fail` 이 불림). 기존 시험 중 `'다시 맡기는 것도 안 되면 그때는 실패로 적는다'` 는 그대로 PASS 여야 합니다(그 시험의 IngestError 에는 `transient` 가 없어 최종적으로 읽힙니다).

- [ ] **Step 3: 구현한다**

`src/flows/read-evidence.ts` — `StartOutcome` 과 `startReading` 을 이렇게 바꿉니다:

```ts
/**
 * 맡긴 결과.
 *
 * **최종적 실패는 이미 `failed` 로 적힌 뒤입니다** — 부르는 쪽이 다시 적지 않습니다.
 * **일시적 실패(`transient: true`)는 적지 않았습니다** — 부르는 쪽이 「재시도중」으로 답하고,
 * 다음 폴링이 다시 맡깁니다 → ADR-091 §3.
 */
export type StartOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string; readonly transient: boolean }

export interface StartOptions {
  /**
   * 일시적 실패면 **2초 뒤 한 번 더** 맡깁니다 — 에러 §2 의 `IngestError` 1회.
   * 완료 통지 라우트만 켭니다. 폴링 안의 다시 맡기기는 안 켭니다 — 5초 뒤 다음 폴링이 곧 재시도입니다
   */
  readonly retryOnce?: boolean
  /** 시험이 기다림을 건너뛰려고 갈아 끼웁니다 */
  readonly sleep?: (ms: number) => Promise<void>
}

/** 에러 §2.1 — `IngestError` 의 1차 대기 */
const SUBMIT_RETRY_DELAY_MS = 2000

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export async function startReading(
  input: {
    readonly caseId: string
    readonly evidenceId: string
    readonly objectKey: string
    readonly kind: EvidenceKind
    readonly mimeType: string
  },
  container: Container,
  opts: StartOptions = {},
): Promise<StartOutcome> {
  // 글로 올라온 것은 **맡길 것이** 없습니다 — 이미 글이라 엔진이 할 일이
  // 없습니다. 다만 **아무도 안 읽는다는 뜻은 아닙니다** — 본문을 가져와
  // 토큰화하는 것은 `collectReading` 이 합니다 (아래 `readWritten`)
  if (input.kind === 'text') return { ok: true }

  const attempt = async (): Promise<StartOutcome> => {
    try {
      await container.transcriber.start({
        media: { objectKey: input.objectKey, kind: input.kind, mimeType: input.mimeType },
        jobId: input.evidenceId,
      })
      return { ok: true }
    } catch (error) {
      // 미설정(AppError · 500)은 그대로 올립니다 — 고칠 수 없는 상태를 전사 실패로 덮지
      // 않습니다(`transcribe.ts` 의 같은 판단)
      if (!(error instanceof IngestError)) throw error
      const reason = error.detail.reason
      const why = typeof reason === 'string' ? reason : 'submit_failed'
      return { ok: false, reason: why, transient: error.detail.transient === true }
    }
  }

  let outcome = await attempt()
  if (!outcome.ok && outcome.transient && opts.retryOnce) {
    await (opts.sleep ?? realSleep)(SUBMIT_RETRY_DELAY_MS)
    outcome = await attempt()
  }

  // **일시적 실패는 적지 않습니다** → ADR-091 §3. 파일은 저장소에 그대로 있고 작업 번호는
  // 증거 번호라, 브라우저의 다음 폴링(5초 뒤)이 같은 번호로 다시 맡깁니다. 여기서 `failed`
  // 로 적으면 팟이 10분 뒤 돌아와도 사용자가 파일을 다시 올려야 합니다
  if (!outcome.ok && !outcome.transient) {
    // **최종적 실패는 그 자리에서 `failed` 로 적습니다.** 2026-09-06 까지는 이 예외가 202 뒤로
    // 사라져, 화면이 첫 폴링(§3.3)에서 다시 부딪히고서야 알았습니다. 에러로 올리지 않는 이유는
    // `collectReading` 의 같은 자리와 같습니다 → 불변 규칙 5
    await container.evidenceWrite.fail({
      caseId: input.caseId,
      evidenceId: input.evidenceId,
      reason: outcome.reason,
    })
  }
  return outcome
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `cd src && npx vitest run flows/read-evidence.test.ts`
Expected: PASS. (기존 `missing` 시험 `'다시 맡기는 것도 안 되면 …'` 은 Task 7 에서 `transient` 를 보게 되기 전까지 `{ status: 'failed', reason: 'submit_failed' }` 그대로 통과합니다 — `started.transient` 가 false 이므로.)

`cd src && npm run typecheck` 도 돌립니다 — `collectReading` 의 `missing` 갈래가 `started.ok` 만 보므로 타입은 그대로 맞습니다.

- [ ] **Step 5: 커밋**

```bash
cd /mnt/c/Users/TaeHyounKim/Documents/HACKERTON/finance2026/fsec-wt-autowake && git add src/flows/read-evidence.ts src/flows/read-evidence.test.ts && git commit -q -F - <<'MSG'
맡기기가 닿지 못하면 failed 로 적지 않는다 — 완료 통지에서는 2초 뒤 한 번 더 (ADR-091 §3)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LaeBtmCj3cYVMYB39Z4gba
MSG
```

---

### Task 7: `collectReading` — 묻기 · 다시 맡기기 · 토큰화의 「재시도중」 갈래

**Files:**
- Modify: `src/flows/read-evidence.ts` (`POLL_AFTER_MS` 옆 · `ReadState` · `collectReading` 의 collect 호출 · `missing` 갈래 · `maskLines` 호출)
- Test: `src/flows/read-evidence.test.ts`

**Interfaces:**
- Consumes: `IngestError.detail.transient` (Task 4) · `PiiTokenizerUnavailableError.detail.transient` (Task 5) · `startReading` 의 `transient` (Task 6)
- Produces:
  ```ts
  export const RETRY_POLL_AFTER_MS = 5000
  export type ReadState =
    | { status: 'running'; phase: IngestPhase; percent: number; pollAfterMs: number; retrying?: true }
    | { status: 'done'; … }   // 그대로
    | { status: 'failed'; reason: string }
  ```
  Task 8 이 `state.retrying` 을 응답 `progress.retrying` 으로 옮긴다.

- [ ] **Step 1: 실패하는 시험을 쓴다**

`src/flows/read-evidence.test.ts` 끝에 추가 (import 에 `PiiTokenizerUnavailableError` 를 `@/lib/errors` 에서 더합니다):

```ts
describe('팟이나 모델에 닿지 못하면 「재시도중」으로 답한다 — ADR-091 §3', () => {
  const asked = () => ({
    caseId: CASE_ID,
    evidenceId: EVIDENCE_ID,
    kind: 'audio' as const,
    mimeType: 'audio/m4a',
    objectKey: KEY,
    stored: null,
  })
  const RETRYING = { status: 'running', phase: 'stt', percent: 0, pollAfterMs: 5000, retrying: true }

  it('묻기가 닿지 못하면 다시 맡겨 보고, 그것도 닿지 못하면 재시도중', async () => {
    const one = harness({ lines: [] })
    const started: unknown[] = []
    const failed: unknown[] = []
    Object.assign(one.container, {
      transcriber: {
        collect: async () => {
          throw new IngestError('물어보지 못했습니다', { reason: 'poll_failed', transient: true })
        },
        start: async (input: unknown) => {
          started.push(input)
          throw new IngestError('맡기지 못했습니다', { reason: 'submit_failed', transient: true })
        },
      },
      evidenceWrite: { finish: async () => {}, fail: async (i: unknown) => { failed.push(i) } },
    })

    const got = await collectReading(asked(), one.container)

    expect(got).toEqual(RETRYING)
    expect(started).toHaveLength(1)
    expect(failed).toEqual([])
    expect(one.finished).toHaveLength(0)
  })

  it('묻기가 닿지 못했는데 다시 맡기기가 되면 평소 처리중으로 답한다', async () => {
    const one = harness({ lines: [] })
    Object.assign(one.container, {
      transcriber: {
        collect: async () => {
          throw new IngestError('물어보지 못했습니다', { reason: 'poll_failed', transient: true })
        },
        start: async () => ({ started: true, job: { jobId: EVIDENCE_ID, phase: 'stt', kind: 'audio' } }),
      },
    })

    const got = await collectReading(asked(), one.container)

    expect(got).toEqual({ status: 'running', phase: 'stt', percent: 0, pollAfterMs: 1500 })
  })

  it('묻기의 최종적 실패(poll_failed · transient 아님)는 지금처럼 던진다 — 회귀', async () => {
    const one = harness({ lines: [] })
    Object.assign(one.container, {
      transcriber: {
        collect: async () => {
          throw new IngestError('물어보지 못했습니다', { reason: 'poll_failed' })
        },
      },
    })

    await expect(collectReading(asked(), one.container)).rejects.toBeInstanceOf(IngestError)
  })

  it('팟이 작업을 잊었고(404) 다시 맡기기가 닿지 못하면 failed 가 아니라 재시도중', async () => {
    const one = harness({ lines: [] })
    const failed: unknown[] = []
    Object.assign(one.container, {
      transcriber: {
        collect: async () => ({ status: 'missing' }),
        start: async () => {
          throw new IngestError('맡기지 못했습니다', { reason: 'submit_failed', transient: true })
        },
      },
      evidenceWrite: { finish: async () => {}, fail: async (i: unknown) => { failed.push(i) } },
    })

    const got = await collectReading(asked(), one.container)

    expect(got).toEqual(RETRYING)
    expect(failed).toEqual([])
  })

  it('원문은 받았는데 모델이 닿지 않으면 원문을 버리고 재시도중 — 저장도 대응표도 없다', async () => {
    const one = harness({ lines: [lineOf(`${THEIRS} 로 보내라고 했어요`)] })
    Object.assign(one.container, {
      piiTokenizer: createPiiTokenizer({
        ner: {
          find: async () => {
            throw new TransientError('닿지 못함')
          },
        },
      }),
    })

    const got = await collectReading(asked(), one.container)

    expect(got).toEqual(RETRYING)
    expect(one.finished).toHaveLength(0)
    expect(JSON.stringify(got)).not.toContain(THEIRS)
  })

  it('모델의 최종적 실패(transient 아님)는 지금처럼 503 예외로 올린다 — 회귀', async () => {
    const one = harness({ lines: [lineOf('김민수 고객님')] })
    Object.assign(one.container, {
      piiTokenizer: createPiiTokenizer({
        ner: {
          find: async () => {
            throw new Error('거절 (401)')
          },
        },
      }),
    })

    await expect(collectReading(asked(), one.container)).rejects.toBeInstanceOf(PiiTokenizerUnavailableError)
  })
})
```

(`TransientError` 도 import 에 더합니다.)

- [ ] **Step 2: 실패를 확인한다**

Run: `cd src && npx vitest run flows/read-evidence.test.ts`
Expected: 새 describe 의 회귀 둘을 뺀 넷이 FAIL.

- [ ] **Step 3: 구현한다**

`src/flows/read-evidence.ts`:

1. import 줄에 `PiiTokenizerUnavailableError` 를 더합니다: `import { IngestError, PiiTokenizerUnavailableError } from '@/lib/errors'`.
2. 상수:

```ts
/** 화면이 다음에 언제 물을지 → §3.3 `poll_after_ms` */
const POLL_AFTER_MS = 1500
/**
 * 「재시도중」일 때의 간격 → ADR-091 §2. 죽은 서버를 1.5초마다 두드릴 이유가 없고,
 * 팟이 돌아온 뒤 늦어도 5초 안에 다음 시도가 갑니다
 */
export const RETRY_POLL_AFTER_MS = 5000
```

3. `ReadState` 의 `running` 갈래에 한 칸:

```ts
  | {
      readonly status: 'running'
      readonly phase: IngestPhase
      readonly percent: number
      readonly pollAfterMs: number
      /**
       * **서버에 닿지 못해 다시 맡기는 중** → ADR-091 §2. `ingest_status` 는 그대로 `processing`.
       * 화면은 진행률 대신 「다시 연결하는 중」을 그립니다
       */
      readonly retrying?: true
    }
```

4. `collectReading` 안에 도우미 둘을 두고(함수 안, `progress` 를 얻기 전에):

```ts
  const phase: IngestPhase = input.kind === 'audio' ? 'stt' : 'ocr'
  const retrying = (): ReadState => ({
    status: 'running',
    phase,
    percent: 0,
    pollAfterMs: RETRY_POLL_AFTER_MS,
    retrying: true,
  })
  /**
   * 같은 번호로 다시 맡긴 뒤 답을 정합니다 — `missing`(팟이 잊음)과 「닿지 못함」이 함께 씁니다.
   * 됐으면 평소 처리중, 닿지 못했으면 재시도중, 최종적으로 안 됐으면(`startReading` 이 이미 `failed` 로 적음) failed
   */
  const resubmit = async (): Promise<ReadState> => {
    const started = await startReading(
      {
        caseId: input.caseId,
        evidenceId: input.evidenceId,
        objectKey: input.objectKey,
        kind: input.kind,
        mimeType: input.mimeType,
      },
      container,
    )
    if (started.ok) return { status: 'running', phase, percent: 0, pollAfterMs: POLL_AFTER_MS }
    if (started.transient) return retrying()
    return { status: 'failed', reason: started.reason }
  }
```

5. 팟에 묻는 호출을 try/catch 로 감쌉니다:

```ts
  let progress: CollectResult
  try {
    progress =
      input.kind === 'text'
        ? await readWritten(input.objectKey, container)
        : await container.transcriber.collect({
            jobId: input.evidenceId,
            // 아래 둘은 `collect` 가 결과를 어느 갈래로 읽을지 정할 때만 씁니다
            phase,
            kind: input.kind,
          })
  } catch (error) {
    // **닿지 못한 것은 오류가 아닙니다** → ADR-091 §3. 팟이 죽어 있거나 프록시가 5xx 를 내는
    // 동안입니다. 같은 번호로 다시 맡겨 보고(팟이 살아 있으면 여기서 이어집니다), 그것도
    // 닿지 못하면 「재시도중」으로 답해 다음 폴링이 또 맡기게 합니다. 2026-09-06 까지는
    // 422 를 내서 사람이 「다시 확인」을 눌러야 했습니다. 최종적 실패(미설정 · 4xx)는 그대로 올립니다
    if (error instanceof IngestError && error.detail.transient === true) return resubmit()
    throw error
  }
```

6. `missing` 갈래를 `resubmit()` 로 바꿉니다:

```ts
  if (progress.status === 'missing') {
    // **팟이 그 번호를 모릅니다** — 끝난 작업을 30분 뒤 버렸거나 서비스가 다시 떴습니다.
    // (기존 주석 유지) … 다시 맡기는 것도 안 되면 그때 `failed` 로 적히고(`startReading` 안에서),
    // 닿지 못한 것이면 「재시도중」입니다(ADR-091 §3)
    return resubmit()
  }
```

7. 토큰화 호출을 감쌉니다:

```ts
  let masked: Awaited<ReturnType<typeof maskLines>>
  try {
    masked = await maskLines(progress.result.lines, container, allowed, issued)
  } catch (error) {
    // **이름 탐지 서비스에 닿지 못했습니다** → ADR-091 §3. 원문(`progress.result.lines`)은 이 함수의
    // 메모리에만 있고 여기서 버려집니다 — 저장도 응답도 없습니다. 다음 폴링이 팟에서 같은 결과를
    // 다시 받아(30분 보관) 다시 토큰화합니다. 최종적 실패(비밀값 틀림 등)는 지금처럼 503 입니다
    if (error instanceof PiiTokenizerUnavailableError && error.detail.transient === true) return retrying()
    throw error
  }
```

`CollectResult` 는 `@/modules/transcriber` 에서 이미 import 하고 있습니다. `phase` 지역 변수가 생겼으니 아래 `running` 갈래와 `resubmit` 이 같은 값을 씁니다(기존 `input.kind === 'audio' ? 'stt' : 'ocr'` 반복은 지웁니다).

- [ ] **Step 4: 통과를 확인한다**

Run: `cd src && npx vitest run flows/read-evidence.test.ts && npm run typecheck`
Expected: PASS · 타입 오류 없음.

- [ ] **Step 5: 커밋**

```bash
cd /mnt/c/Users/TaeHyounKim/Documents/HACKERTON/finance2026/fsec-wt-autowake && git add src/flows/read-evidence.ts src/flows/read-evidence.test.ts && git commit -q -F - <<'MSG'
묻기·다시 맡기기·토큰화에서 닿지 못하면 오류 대신 「재시도중」으로 답한다 — 원문은 버리고 다음 폴링이 다시 받는다 (ADR-091 §3)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LaeBtmCj3cYVMYB39Z4gba
MSG
```

---

### Task 8: 라우트 둘 — 응답에 `progress.retrying`

**Files:**
- Modify: `src/app/api/cases/[case_token]/evidence/[evidence_id]/route.ts` (`state.status === 'running'` 갈래)
- Modify: `src/app/api/cases/[case_token]/evidence/[evidence_id]/complete/route.ts` (`startReading` 호출과 응답)
- Test: `src/app/api/cases/[case_token]/evidence/[evidence_id]/route.test.ts` · `…/complete/route.test.ts`

**Interfaces:**
- Consumes: `ReadState.retrying` · `RETRY_POLL_AFTER_MS` · `StartOutcome.transient` · `StartOptions.retryOnce` (Task 6·7)
- Produces (API §3.3 · §3.2):
  ```jsonc
  { "evidence_id": "…", "ingest_status": "processing",
    "progress": { "phase": "stt", "percent": 0, "retrying": true }, "poll_after_ms": 5000 }
  ```
  완료 통지도 일시적 실패면 같은 모양으로 202.

- [ ] **Step 1: 실패하는 시험을 쓴다**

`…/[evidence_id]/route.test.ts` 끝에 (이 파일은 `collectReading` 을 `vi.hoisted` 로 가짜로 두고 있습니다 — 그 가짜에 값을 넣습니다. `build()` 의 인자 규약은 파일 위쪽 `build(caseId, pendingCreatedAt)` 을 따릅니다):

```ts
describe('재시도중은 processing 인 채 progress.retrying 으로 — ADR-091 §2', () => {
  it('retrying 이 붙은 running 은 poll_after_ms 5000 과 progress.retrying: true 로 나간다', async () => {
    build(CASE_ID, null)
    collectReading.mockResolvedValueOnce({
      status: 'running',
      phase: 'stt',
      percent: 0,
      pollAfterMs: 5000,
      retrying: true,
    })

    const res = await GET(ask(), params())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({
      evidence_id: EVIDENCE_ID,
      ingest_status: 'processing',
      progress: { phase: 'stt', percent: 0, retrying: true },
      poll_after_ms: 5000,
    })
  })

  it('평소 running 에는 retrying 칸이 없다 — 회귀', async () => {
    build(CASE_ID, null)
    collectReading.mockResolvedValueOnce({ status: 'running', phase: 'stt', percent: 40, pollAfterMs: 1500 })

    const body = await (await GET(ask(), params())).json()

    expect(body.progress).toEqual({ phase: 'stt', percent: 40 })
  })
})
```

(`ask()`·`params()` 는 파일에 이미 있는 요청 도우미 이름에 맞춥니다 — 없으면 위쪽 시험이 `GET(...)` 을 부르는 모양을 그대로 씁니다. `processing` 행이 되게 `build` 를 부르는 법도 위쪽 `'오래된 pending …'` 시험을 참고합니다.)

`…/complete/route.test.ts` 가 있으면 끝에, 없으면 `route.test.ts` 의 껍데기(`vi.mock('@/lib/wire')` · `startReading` 가짜)를 복사해 새로 만들고:

```ts
describe('맡기기가 닿지 못하면 202 에 재시도중을 싣는다 — ADR-091 §3', () => {
  it('startReading 이 transient 면 processing + progress.retrying + poll_after_ms 5000', async () => {
    build(CASE_ID)
    startReading.mockResolvedValueOnce({ ok: false, reason: 'submit_failed', transient: true })

    const res = await POST(new Request('http://x', { method: 'POST' }), params())
    const body = await res.json()

    expect(res.status).toBe(202)
    expect(body).toEqual({
      evidence_id: EVIDENCE_ID,
      ingest_status: 'processing',
      progress: { phase: 'stt', percent: 0, retrying: true },
      poll_after_ms: 5000,
    })
    // 완료 통지만 2초 뒤 한 번 더를 켭니다
    expect(startReading.mock.calls[0][2]).toMatchObject({ retryOnce: true })
  })

  it('맡기기가 되면 지금처럼 { evidence_id, ingest_status } 만 — 회귀', async () => {
    build(CASE_ID)
    startReading.mockResolvedValueOnce({ ok: true })

    const body = await (await POST(new Request('http://x', { method: 'POST' }), params())).json()

    expect(body).toEqual({ evidence_id: EVIDENCE_ID, ingest_status: 'processing' })
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd src && npx vitest run "app/api/cases/\[case_token\]/evidence/\[evidence_id\]"`
Expected: 새 시험 FAIL (`retrying` 이 응답에 없음 · `retryOnce` 안 넘김).

- [ ] **Step 3: 구현한다**

`…/[evidence_id]/route.ts` 의 `running` 갈래:

```ts
    if (state.status === 'running') {
      return {
        body: {
          evidence_id: evidenceId,
          ingest_status: 'processing',
          progress: {
            phase: state.phase,
            percent: state.percent,
            // **서버에 닿지 못해 다시 맡기는 중** → ADR-091 §2. 없으면 칸을 아예 안 냅니다 — 옛 화면과 호환
            ...(state.retrying ? { retrying: true } : {}),
          },
          poll_after_ms: state.pollAfterMs,
        },
      }
    }
```

`…/complete/route.ts`:

```ts
import { RETRY_POLL_AFTER_MS, startReading } from '@/flows/read-evidence'
…
    // **여기서 읽기를 맡깁니다.** 결과를 기다리지 않습니다 — 서버 함수가
    // 몇 분을 못 살고, 화면은 §3.3 으로 물어봅니다.
    // 작업 번호로 증거 번호를 그대로 쓰므로 어디에도 적어 둘 필요가 없습니다.
    // **닿지 못하면 2초 뒤 한 번 더**(에러 §2) — 그래도 안 되면 `failed` 가 아니라 「재시도중」으로
    // 답합니다(ADR-091 §3). 브라우저의 첫 폴링이 5초 뒤 다시 맡깁니다
    const started = await startReading(
      {
        caseId,
        evidenceId,
        objectKey: found.objectKey,
        kind: found.kind,
        mimeType: found.mimeType,
      },
      container,
      { retryOnce: true },
    )

    if (!started.ok && started.transient) {
      return {
        status: 202,
        body: {
          evidence_id: evidenceId,
          ingest_status: 'processing',
          progress: { phase: found.kind === 'audio' ? 'stt' : 'ocr', percent: 0, retrying: true },
          poll_after_ms: RETRY_POLL_AFTER_MS,
        },
      }
    }

    return {
      // 202 — 접수했고 아직 안 끝났습니다. 진행 상태는 §3.3 으로 묻습니다
      status: 202,
      body: { evidence_id: evidenceId, ingest_status: status },
    }
```

- [ ] **Step 4: 통과를 확인한다**

Run: `cd src && npx vitest run "app/api/cases/\[case_token\]/evidence" && npm run typecheck && cd .. && python3 .github/scripts/route-contract.py`
Expected: PASS · 라우트 검사기 「문제 없습니다」.

- [ ] **Step 5: 커밋**

```bash
cd /mnt/c/Users/TaeHyounKim/Documents/HACKERTON/finance2026/fsec-wt-autowake && git add "src/app/api/cases/[case_token]/evidence/[evidence_id]" && git commit -q -F - <<'MSG'
자료 조회·완료 통지 응답에 progress.retrying 을 싣는다 — 완료 통지는 2초 뒤 한 번 더 맡긴다 (ADR-091 §2·§3)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LaeBtmCj3cYVMYB39Z4gba
MSG
```

---

### Task 9: 서버 혼자 다시 맡기기 — `POST /api/cron/evidence-resubmit`

**Files:**
- Modify: `src/lib/db.ts` (`EvidenceReader` 에 `listRetryCandidates` · `createEvidenceReader` 에 구현)
- Create: `src/flows/resubmit-evidence.ts` · `src/flows/resubmit-evidence.test.ts`
- Create: `src/app/api/cron/evidence-resubmit/route.ts` · `route.test.ts`

**Interfaces:**
- Consumes: `startReading`(Task 6) · `container.transcriber.collect` · `IngestError.detail.transient`(Task 4)
- Produces:
  ```ts
  // db.ts
  listRetryCandidates(input: { withinMs: number; limit: number }): Promise<readonly {
    caseId: string; evidenceId: string; kind: EvidenceKind; objectKey: string; mimeType: string
  }[]>
  // flows/resubmit-evidence.ts
  export interface ResubmitReport { scanned: number; resubmitted: number; running: number; unreachable: number; failed: number }
  export const RESUBMIT_WITHIN_MS = 48 * 60 * 60 * 1000
  export const RESUBMIT_LIMIT = 20
  export async function resubmitEvidence(container: Container): Promise<ResubmitReport>
  ```
  Task 15 의 감시자가 `POST {APP_ORIGIN}/api/cron/evidence-resubmit` 를 `Authorization: Bearer <CRON_SECRET>` 로 부른다.

- [ ] **Step 1: 흐름의 실패하는 시험을 쓴다**

`src/flows/resubmit-evidence.test.ts`:

```ts
/**
 * 서버 혼자 하는 다시 맡기기 시험 — ADR-091 §5.
 *
 * **여기서 못 박는 것 셋:**
 * 1. 팟이 모르는 것(404 · 닿지 못함)만 다시 맡긴다 — 돌고 있거나 끝난 것은 브라우저 몫
 * 2. 토큰화하지 않는다 — collect 가 done 을 줘도 저장하지 않는다
 * 3. 미설정(AppError)은 그대로 올린다
 */
import { describe, expect, it } from 'vitest'

import type { Container } from '@/lib/container'
import { AppError, IngestError } from '@/lib/errors'

import { RESUBMIT_LIMIT, RESUBMIT_WITHIN_MS, resubmitEvidence } from './resubmit-evidence'

const CASE_ID = '01J8XKQZ3M7N2P4R6T8V0W2Y4A'
const row = (evidenceId: string, kind: 'audio' | 'image' = 'audio') => ({
  caseId: CASE_ID,
  evidenceId,
  kind,
  objectKey: `${CASE_ID}/${evidenceId}`,
  mimeType: kind === 'audio' ? 'audio/m4a' : 'image/png',
})

function harness(input: {
  rows: ReturnType<typeof row>[]
  collect: (jobId: string) => Promise<unknown>
  start?: () => Promise<unknown>
}) {
  const asked: { withinMs: number; limit: number }[] = []
  const started: string[] = []
  const finished: unknown[] = []
  const container = {
    evidence: {
      listRetryCandidates: async (q: { withinMs: number; limit: number }) => {
        asked.push(q)
        return input.rows
      },
    },
    transcriber: {
      collect: async (job: { jobId: string }) => input.collect(job.jobId),
      start: async (i: { jobId: string }) => {
        started.push(i.jobId)
        if (input.start) return input.start()
        return { started: true, job: { jobId: i.jobId, phase: 'stt', kind: 'audio' } }
      },
    },
    evidenceWrite: {
      finish: async (one: unknown) => {
        finished.push(one)
      },
      fail: async () => {},
    },
  } as unknown as Container
  return { container, asked, started, finished }
}

describe('팟이 모르는 것만 다시 맡긴다', () => {
  it('48시간 · 20건으로 묻는다', async () => {
    const h = harness({ rows: [], collect: async () => ({ status: 'missing' }) })

    await resubmitEvidence(h.container)

    expect(h.asked).toEqual([{ withinMs: RESUBMIT_WITHIN_MS, limit: RESUBMIT_LIMIT }])
    expect(RESUBMIT_WITHIN_MS).toBe(48 * 60 * 60 * 1000)
    expect(RESUBMIT_LIMIT).toBe(20)
  })

  it('404 면 다시 맡기고, 도는 중이면 두고, 끝났으면 저장하지 않고 둔다', async () => {
    const h = harness({
      rows: [row('E1'), row('E2'), row('E3', 'image')],
      collect: async (id) =>
        id === 'E1'
          ? { status: 'missing' }
          : id === 'E2'
            ? { status: 'running', phase: 'stt', percent: 30 }
            : { status: 'done', result: { lines: [], shortfalls: [] } },
    })

    const report = await resubmitEvidence(h.container)

    expect(h.started).toEqual(['E1'])
    expect(h.finished).toEqual([])
    expect(report).toEqual({ scanned: 3, resubmitted: 1, running: 2, unreachable: 0, failed: 0 })
  })

  it('묻기가 닿지 못하면 다시 맡겨 보고, 그것도 닿지 못하면 unreachable 로 센다', async () => {
    const h = harness({
      rows: [row('E1')],
      collect: async () => {
        throw new IngestError('물어보지 못했습니다', { reason: 'poll_failed', transient: true })
      },
      start: async () => {
        throw new IngestError('맡기지 못했습니다', { reason: 'submit_failed', transient: true })
      },
    })

    const report = await resubmitEvidence(h.container)

    expect(h.started).toEqual(['E1'])
    expect(report).toEqual({ scanned: 1, resubmitted: 0, running: 0, unreachable: 1, failed: 0 })
  })

  it('다시 맡기기가 최종적으로 안 되면 failed 로 센다(startReading 이 이미 적음)', async () => {
    const h = harness({
      rows: [row('E1')],
      collect: async () => ({ status: 'missing' }),
      start: async () => {
        throw new IngestError('맡기지 못했습니다', { reason: 'submit_failed', transient: false })
      },
    })

    const report = await resubmitEvidence(h.container)

    expect(report.failed).toBe(1)
  })

  it('미설정은 그대로 올린다', async () => {
    const h = harness({
      rows: [row('E1')],
      collect: async () => {
        throw new AppError('전사 서비스가 아직 설정되지 않았습니다')
      },
    })

    await expect(resubmitEvidence(h.container)).rejects.toBeInstanceOf(AppError)
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd src && npx vitest run flows/resubmit-evidence.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 흐름과 DB 조회를 구현한다**

`src/lib/db.ts` — `EvidenceReader` 인터페이스에 (`list` 아래):

```ts
  /**
   * **서버 혼자 다시 맡길 후보** → ADR-091 §5. 처리중이고 최근에 만들어진 녹음·이미지 자료.
   *
   * 글(`text`)은 뺍니다 — 팟에 맡기는 것이 없습니다. 오래된 것도 뺍니다 — 사건 화면을 닫고
   * 이틀 넘게 안 돌아온 자료까지 GPU 를 태울 이유가 없고, 돌아오면 셸의 폴링이 맡깁니다.
   * `transcript_masked` 는 고르지 않습니다 — 여기서 토큰화하지 않습니다
   */
  listRetryCandidates(input: { readonly withinMs: number; readonly limit: number }): Promise<
    readonly {
      readonly caseId: string
      readonly evidenceId: string
      readonly kind: EvidenceKind
      readonly objectKey: string
      readonly mimeType: string
    }[]
  >
```

`createEvidenceReader` 에 구현 (`list` 다음):

```ts
    async listRetryCandidates({ withinMs, limit }) {
      const rows = await sql<
        { case_id: string; evidence_id: string; kind: EvidenceKind; object_key: string | null; mime_type: string | null }[]
      >`
        SELECT case_id, evidence_id, kind, object_key, mime_type
        FROM evidence
        WHERE ingest_status = 'processing'
          AND kind <> 'text'
          AND created_at > now() - make_interval(secs => ${Math.floor(withinMs / 1000)})
        ORDER BY created_at ASC
        LIMIT ${limit}
      `
      return rows.map((row) => ({
        caseId: row.case_id,
        evidenceId: row.evidence_id,
        kind: row.kind,
        objectKey: row.object_key ?? '',
        mimeType: row.mime_type ?? '',
      }))
    },
```

`src/flows/resubmit-evidence.ts`:

```ts
/**
 * 서버 혼자 하는 다시 맡기기 → ADR-091 §5.
 *
 * 재시도의 주인은 브라우저 셸입니다(ADR-078) — 결과를 받아 토큰화하는 단계는 대응표를 받을
 * 브라우저가 있어야 합니다(ADR-062). **팟에 다시 맡기는 단계만은 원문을 다루지 않으므로**
 * 서버 혼자 할 수 있습니다. 감시자(ADR-092)가 팟을 되살린 직후 한 번 부릅니다 — 사용자가 창을
 * 닫아 둔 자료도 팟에서 미리 처리돼 있다가, 돌아왔을 때 첫 폴링에서 결과가 뜹니다.
 *
 * **여기서 토큰화하지 않습니다.** `collect` 가 `done` 을 줘도 저장하지 않고 둡니다.
 */

import 'server-only'

import type { Container } from '@/lib/container'
import { IngestError } from '@/lib/errors'

import { startReading } from './read-evidence'

/** 사건 화면을 닫고 이틀 넘게 안 돌아온 자료는 셸의 폴링에 맡깁니다 */
export const RESUBMIT_WITHIN_MS = 48 * 60 * 60 * 1000
/** 팟이 막 돌아온 순간 수십 건이 몰리지 않게 */
export const RESUBMIT_LIMIT = 20

export interface ResubmitReport {
  readonly scanned: number
  /** 팟이 몰라서(404 · 닿지 못함) 같은 번호로 다시 맡긴 것 */
  readonly resubmitted: number
  /** 팟이 알고 있어서(도는 중 · 끝남 · 팟이 실패라 함) 둔 것 — 브라우저 몫 */
  readonly running: number
  /** 다시 맡기는 것도 닿지 못한 것 — 다음 호출이 다시 집습니다 */
  readonly unreachable: number
  /** 다시 맡기기가 최종적으로 거절된 것 — `startReading` 이 `failed` 로 적었습니다 */
  readonly failed: number
}

export async function resubmitEvidence(container: Container): Promise<ResubmitReport> {
  const rows = await container.evidence.listRetryCandidates({
    withinMs: RESUBMIT_WITHIN_MS,
    limit: RESUBMIT_LIMIT,
  })
  const report = { scanned: rows.length, resubmitted: 0, running: 0, unreachable: 0, failed: 0 }

  for (const row of rows) {
    let known = false
    try {
      const progress = await container.transcriber.collect({
        jobId: row.evidenceId,
        phase: row.kind === 'audio' ? 'stt' : 'ocr',
        kind: row.kind,
      })
      known = progress.status !== 'missing'
    } catch (error) {
      // 닿지 못한 것만 「모른다」로 봅니다. 미설정(AppError)·최종적 실패는 그대로 올립니다
      if (!(error instanceof IngestError) || error.detail.transient !== true) throw error
    }
    if (known) {
      report.running += 1
      continue
    }

    const started = await startReading(
      {
        caseId: row.caseId,
        evidenceId: row.evidenceId,
        objectKey: row.objectKey,
        kind: row.kind,
        mimeType: row.mimeType,
      },
      container,
    )
    if (started.ok) report.resubmitted += 1
    else if (started.transient) report.unreachable += 1
    else report.failed += 1
  }

  return report
}
```

- [ ] **Step 4: 흐름 시험 통과를 확인한다**

Run: `cd src && npx vitest run flows/resubmit-evidence.test.ts && npm run typecheck`
Expected: PASS. (`EvidenceReader` 를 구현하는 다른 가짜가 시험에 있으면 — `unconfiguredPorts` 등 — 타입 오류가 나는 자리에 `listRetryCandidates: async () => []` 를 더합니다.)

- [ ] **Step 5: 라우트의 실패하는 시험을 쓴다**

`src/app/api/cron/evidence-resubmit/route.test.ts` (`api/cron/purge/route.test.ts` 의 껍데기와 같은 방식):

```ts
/**
 * `POST /api/cron/evidence-resubmit` 시험 — 비밀값이 관문이고, 응답은 건수뿐인가 (ADR-091 §5).
 */
import { describe, expect, it, vi } from 'vitest'

import { createContainer } from '@/lib/container'
import { readEnv } from '@/lib/env'

import { POST } from './route'

const SECRET = 'a-long-random-cron-secret'
const holder = vi.hoisted(() => ({ container: undefined as unknown }))
vi.mock('@/lib/wire', () => ({
  getContainer: () => holder.container,
  resetContainer: () => {
    holder.container = undefined
  },
}))

const report = { scanned: 2, resubmitted: 1, running: 1, unreachable: 0, failed: 0 }
const resubmitEvidence = vi.hoisted(() => vi.fn(async () => report))
vi.mock('@/flows/resubmit-evidence', () => ({ resubmitEvidence }))

function ask(headers: Record<string, string> = {}) {
  return new Request('http://x/api/cron/evidence-resubmit', { method: 'POST', headers })
}

function wire(env: Record<string, string> = { CRON_SECRET: SECRET }) {
  holder.container = createContainer(readEnv(env))
}

describe('두 번째 관문 — §6.1', () => {
  it('헤더가 없으면 401 이다', async () => {
    wire()
    expect((await POST(ask())).status).toBe(401)
  })

  it('비밀값이 비어 있는 서버는 맞는 헤더로도 401 이다', async () => {
    wire({})
    expect((await POST(ask({ authorization: `Bearer ${SECRET}` }))).status).toBe(401)
  })
})

describe('건수만 답한다', () => {
  it('흐름을 한 번 부르고 그 보고를 그대로 낸다', async () => {
    wire()
    const res = await POST(ask({ authorization: `Bearer ${SECRET}` }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(report)
    expect(resubmitEvidence).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 6: 실패를 확인한다**

Run: `cd src && npx vitest run app/api/cron/evidence-resubmit`
Expected: FAIL — 라우트 없음.

- [ ] **Step 7: 라우트를 만든다**

`src/app/api/cron/evidence-resubmit/route.ts`:

```ts
/**
 * `POST /api/cron/evidence-resubmit` — 팟이 모르는 처리중 자료를 같은 번호로 다시 맡긴다.
 * 정본: spec/common/08-14-api.md §6.6 · ADR-091 §5
 * 근거: ADR-078(재시도의 주인은 셸 — 다시 맡기기만 서버 혼자) · ADR-092(감시자가 팟을 되살린 직후 부른다)
 *
 * ## 크론이 아닌데 왜 `/api/cron/` 아래인가
 *
 * 기계가 비밀값으로 부르는 주소이고, 문지기(`proxy.ts`)와 껍데기(`lib/request.ts`)가
 * `/api/cron/` 아래를 `Authorization: Bearer <CRON_SECRET>` 로 이미 지킵니다(§6.1).
 * 새 문을 열면 받는 문이 둘이 되고, 그중 하나만 약해도 전체가 약해집니다.
 *
 * ## 여기는 트리거일 뿐입니다
 *
 * 무엇을 다시 맡기고 무엇을 두는지는 `flows/resubmit-evidence.ts` 가 압니다. **토큰화는 하지
 * 않습니다** — 대응표를 받을 브라우저가 없습니다(ADR-062).
 *
 * ## 실패해도 200 입니다 — 건수뿐
 *
 * 닿지 못한 자료는 `unreachable` 로 세고 다음 호출이 다시 집습니다. 사건·증거 식별자는 싣지
 * 않습니다 — 크론 응답은 실행 기록에 남는 자리입니다(§6.2 와 같은 규칙).
 */

import { resubmitEvidence } from '@/flows/resubmit-evidence'
import { handleRoute } from '@/lib/request'

export const maxDuration = 60

export async function POST(request: Request) {
  return handleRoute(
    request,
    async (ctx) => ({ body: await resubmitEvidence(ctx.container) }),
    // 기계가 비밀값으로 부르는 자리라 창으로 세지 않습니다 — 관문은 CRON_SECRET 입니다
    { rate: 'none' },
  )
}
```

- [ ] **Step 8: 통과를 확인한다**

Run: `cd src && npx vitest run app/api/cron/evidence-resubmit && npm run typecheck && cd .. && python3 .github/scripts/route-contract.py`
Expected: PASS · 라우트 검사기 통과.

- [ ] **Step 9: 커밋**

```bash
cd /mnt/c/Users/TaeHyounKim/Documents/HACKERTON/finance2026/fsec-wt-autowake && git add src/lib/db.ts src/flows/resubmit-evidence.ts src/flows/resubmit-evidence.test.ts src/app/api/cron/evidence-resubmit && git commit -q -F - <<'MSG'
팟이 모르는 처리중 자료를 서버 혼자 다시 맡기는 POST /api/cron/evidence-resubmit 를 둔다 — 48시간·20건·토큰화 없음 (ADR-091 §5)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LaeBtmCj3cYVMYB39Z4gba
MSG
```

---

### Task 10: 화면 — 「전사 서버에 다시 연결하는 중」

**Files:**
- Modify: `src/app/c/[token]/load.ts` (`EvidenceRead.progress` 타입)
- Modify: `src/app/c/[token]/evidence.tsx` (`status === "processing"` 갈래)
- Test: `src/app/c/[token]/evidence.test.tsx`

**Interfaces:**
- Consumes: 응답의 `progress.retrying` (Task 8)
- Produces: 화면 문구. 다른 태스크가 의존하지 않는다.

- [ ] **Step 1: 실패하는 시험을 쓴다**

`src/app/c/[token]/evidence.test.tsx` 의 기존 「처리중」 시험이 `server` 를 만드는 방식(`{ phase: "ready", read: {...}, verdict }`)을 그대로 따라 끝에 추가:

```tsx
describe('재시도중 — ADR-091 §6', () => {
  it('progress.retrying 이면 진행률 대신 「다시 연결하는 중」을 그린다', () => {
    render(
      <EvidencePanel
        {...baseProps}
        server={{
          phase: 'ready',
          read: {
            evidence_id: EVIDENCE_ID,
            ingest_status: 'processing',
            progress: { phase: 'stt', percent: 0, retrying: true },
          },
          verdict: { poll: true, delayMs: 5000 },
        }}
      />,
    )

    expect(screen.getByText(/전사 서버에 다시 연결하는 중입니다/)).toBeInTheDocument()
    expect(screen.queryByText(/개인정보 보호 처리중입니다/)).toBeNull()
    expect(screen.queryByText(/0%/)).toBeNull()
  })
})
```

(`EvidencePanel`·`baseProps`·`EVIDENCE_ID` 는 그 파일이 이미 쓰는 컴포넌트 이름·기본 props 도우미로 맞춥니다 — 파일 위쪽 「처리중」 시험을 복사해 `progress` 만 바꾸는 것이 가장 안전합니다.)

- [ ] **Step 2: 실패를 확인한다**

Run: `cd src && npx vitest run "app/c/\[token\]/evidence.test.tsx"`
Expected: 새 시험 FAIL.

- [ ] **Step 3: 구현한다**

`load.ts` 의 `EvidenceRead`:

```ts
  /** `processing` 일 때만. `retrying` 은 **서버에 닿지 못해 다시 맡기는 중** → ADR-091 §2 */
  readonly progress?: { phase: string; percent: number; retrying?: boolean };
```

`evidence.tsx` — `percent` 상수 아래에:

```ts
  /** §3.3 `progress.retrying` — 서버에 닿지 못해 다시 맡기는 중. 진행률 대신 이 사실을 그립니다(ADR-091 §6) */
  const retrying = read?.progress?.retrying === true;
```

`status === "processing"` 갈래를:

```tsx
        ) : status === "processing" ? (
          <div className="grid gap-2 p-[18px_16px]">
            {retrying ? (
              /* **서버에 닿지 못해 다시 맡기는 중** (ADR-091). 오류가 아니라 처리중이고, 셸의 폴링이
                 5초마다 다시 맡깁니다. 진행률은 안 적습니다 — 0% 는 멈춘 것으로 보입니다 */
              <p className="flex items-center gap-2 text-[14px] text-ink-2">
                <span
                  aria-hidden
                  className="size-1.5 shrink-0 rounded-full bg-pii [animation:pulse-dot_1.6s_ease-in-out_infinite]"
                />
                전사 서버에 다시 연결하는 중입니다. 파일은 안전하게 보관돼 있습니다
              </p>
            ) : (
              <p className="flex items-center gap-2 text-[14px] text-ink-2">
                <span
                  aria-hidden
                  className="size-1.5 shrink-0 rounded-full bg-pii [animation:pulse-dot_1.6s_ease-in-out_infinite]"
                />
                개인정보 보호 처리중입니다. 끝나면 전사가 여기 뜹니다
                {typeof percent === "number" && (
                  <span data-numeric className="text-ink-3">
                    · {percent}%
                  </span>
                )}
              </p>
            )}
            {/* (기존 「다른 화면에 가셔도 됩니다」 문단 그대로 — 재시도중에도 참입니다) */}
            <p className="text-[12.5px] leading-[1.6] text-ink-3">
              원본은 아직 이 브라우저 안에 있습니다.{" "}
              <b className="font-[620] text-ink-2">다른 화면에 가셔도 됩니다</b> — 이 창을 열어
              두면 {retrying ? "연결되면 이어서 처리하고, " : ""}끝났을 때 자료함에 「전사 완료」로 표시됩니다.
            </p>
          </div>
```

- [ ] **Step 4: 통과를 확인한다**

Run: `cd src && npx vitest run "app/c/\[token\]/evidence" && npm run typecheck && npm run lint`
Expected: PASS · lint 깨끗.

- [ ] **Step 5: 커밋**

```bash
cd /mnt/c/Users/TaeHyounKim/Documents/HACKERTON/finance2026/fsec-wt-autowake && git add "src/app/c/[token]/load.ts" "src/app/c/[token]/evidence.tsx" "src/app/c/[token]/evidence.test.tsx" && git commit -q -F - <<'MSG'
자료함이 재시도중을 「전사 서버에 다시 연결하는 중」으로 그린다 — 진행률 대신 (ADR-091 §6)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LaeBtmCj3cYVMYB39Z4gba
MSG
```

---

### Task 11: 계약 문서 동기화

**Files:**
- Modify: `spec/common/08-14-api.md` (§3.3 응답 예 · 라우트 표 두 곳 · §6.6 신설)
- Modify: `spec/backend/08-16-errors.md` (§2 표의 `IngestError` 줄 아래 주)
- Modify: `src/modules/transcriber/README.md` (오류 표)
- Modify: `docs/plans/README.md` (이 계획 등록)

- [ ] **Step 1: API §3.3 에 재시도중 예를 더한다**

`### 3.3` 의 첫 코드 블록 「처리 중」 아래에:

```jsonc
// 응답 200 — 재시도중 (2026-09-07 · ADR-091). ingest_status 는 그대로 processing
{
  "evidence_id": "01J8XKR6...",
  "ingest_status": "processing",
  "progress": { "phase": "stt", "percent": 0, "retrying": true },
  "poll_after_ms": 5000
}
```

그리고 2026-09-06 인용 블록 뒤에 인용 블록 하나:

```markdown
> **2026-09-07 — 닿지 못한 것은 실패가 아닙니다** ([ADR-091](../../decisions/091-evidence-retrying-not-failed.md)).
>
> 전사·판독 서버나 이름 탐지 서버에 **닿지 못하면**(연결 실패 · 타임아웃 · 5xx) `failed` 로 적지 않고
> `processing` 인 채 `progress.retrying: true` · `poll_after_ms: 5000` 으로 답합니다. 셸의 폴링이 물을 때마다
> 서버가 같은 번호로 다시 맡기고, 이름 탐지만 죽었으면 원문을 버리고 다음 폴링에 다시 토큰화합니다(팟은
> 끝난 결과를 30분 보관). 상한은 없습니다. 팟이 파일을 읽어 보고 실패한 것(`failed`)과 4xx 는 지금처럼입니다.
> 완료 통지(§3.2)도 맡기기가 닿지 못하면 같은 모양으로 202 를 냅니다.
```

- [ ] **Step 2: 라우트 표 두 곳과 §6.6**

`| GET | /api/cron/kb-collect | …` 줄(두 표 모두) 아래에:

```markdown
| `POST` | `/api/cron/evidence-resubmit` | 팟이 모르는 처리중 자료를 같은 번호로 다시 맡기는 한 바퀴 — 크론이 아니라 감시자가 팟을 되살린 직후 부릅니다. 계약은 **§6.6** (2026-09-07 · [ADR-091](../../decisions/091-evidence-retrying-not-failed.md) §5) |
```

`### 6.5` 절 끝(「§6.4 실행 주기」 앞)에:

```markdown
### 6.6 `POST /api/cron/evidence-resubmit`

`processing` 이고 **48시간 안에** 만들어진 녹음·이미지 자료 중 팟이 모르는 것(404 · 닿지 못함)을 같은 번호로 다시 맡깁니다
→ [ADR-091](../../decisions/091-evidence-retrying-not-failed.md) §5. **토큰화하지 않습니다** — 대응표를 받을 브라우저가 없습니다
([ADR-062](../../decisions/062-transcript-mapping-handover.md)). 한 번에 20건.

```jsonc
// 응답 200 — 건수뿐입니다. 사건·증거 식별자는 싣지 않습니다
{ "scanned": 3, "resubmitted": 1, "running": 2, "unreachable": 0, "failed": 0 }
```

| 칸 | 뜻 |
| --- | --- |
| `resubmitted` | 팟이 몰라서 다시 맡긴 것 |
| `running` | 팟이 알고 있어서(도는 중 · 끝남 · 팟이 실패라 함) 둔 것 — 셸의 폴링 몫 |
| `unreachable` | 다시 맡기는 것도 닿지 못한 것 — 다음 호출이 다시 집습니다 |
| `failed` | 다시 맡기기가 최종적으로 거절돼 `failed` 로 적힌 것 |

**크론(`vercel.json`)에는 넣지 않습니다.** 부르는 것은 감시자([ADR-092](../../decisions/092-pod-self-heal-and-watcher.md) D-⑤)와 사람입니다.
관문은 §6.1 그대로 `Authorization: Bearer <CRON_SECRET>` 입니다.
```

- [ ] **Step 3: 에러 §2 · transcriber README**

`spec/backend/08-16-errors.md` §2 표 아래(「### 2.1」 앞)에:

```markdown
> 2026-09-07 — **`IngestError` 와 `PiiTokenizerUnavailableError` 의 `detail.transient`** ([ADR-091](../../decisions/091-evidence-retrying-not-failed.md)).
> 어댑터가 「닿지 못함」(연결 실패 · 타임아웃 · 5xx)을 `TransientError` 로 던지면 모듈이 이 표시로 옮깁니다. 자료 읽기 흐름은
> 이 표시가 있을 때 **오류 응답 대신 `processing` + `progress.retrying`** 으로 답해 셸의 폴링이 재시도가 되게 합니다 —
> §3.1 「오류 응답은 스스로 다시 부르지 않는다」는 그대로입니다(오류를 내지 않으므로). 위 표의 재시도 횟수는 **최종적** 실패에
> 대한 것이고, 일시적 실패의 다시 맡기기는 횟수 상한이 없습니다.
```

`src/modules/transcriber/README.md` 의 오류 표(`읽는 도구 **호출 자체**가 실패` 줄) 아래:

```markdown
| 읽는 도구에 **닿지 못함**(연결 · 타임아웃 · 5xx) | 같은 `IngestError` 에 `detail.transient: true` — 흐름이 「재시도중」으로 답합니다 → [ADR-091](../../../decisions/091-evidence-retrying-not-failed.md) |
```

- [ ] **Step 4: 계획 등록 확인과 검사기**

`docs/plans/README.md` 표에 아래 줄이 **이미 있는지** 확인합니다(계획을 쓸 때 함께 넣었습니다 — 없으면 더합니다):

```markdown
| [09-07-runpod-auto-wake.md](09-07-runpod-auto-wake.md) | **추론 팟 자동 복구** — 태스크 19개. 자료 「재시도중」(앱) · 팟 안 `watchdog.sh` · OCI 감시자 `finally-runpod-watch` · 운영 설치. 정본은 [ADR-091](../../decisions/091-evidence-retrying-not-failed.md) · [ADR-092](../../decisions/092-pod-self-heal-and-watcher.md) |
```

Run: `cd /mnt/c/Users/TaeHyounKim/Documents/HACKERTON/finance2026/fsec-wt-autowake && python3 .github/scripts/doc-integrity.py && python3 .github/scripts/route-contract.py`
Expected: 둘 다 「문제 없습니다」.

- [ ] **Step 5: 커밋**

```bash
cd /mnt/c/Users/TaeHyounKim/Documents/HACKERTON/finance2026/fsec-wt-autowake && git add spec/common/08-14-api.md spec/backend/08-16-errors.md src/modules/transcriber/README.md docs/plans/README.md && git commit -q -F - <<'MSG'
API §3.3·§6.6 와 에러 §2 에 「재시도중」과 evidence-resubmit 를 적는다 (ADR-091)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LaeBtmCj3cYVMYB39Z4gba
MSG
```

---

### Task 12: 팟 안 자가 재시작 — `watchdog.sh`, 그리고 지금 팟에 넣기

**Files:**
- Modify: `deploy/runpod-provision.sh` (`restart.sh` 본문 · 「── 4. 확인」 뒤에 「── 5. watchdog」)

**Interfaces:**
- Produces (팟 안): `/opt/finally/restart.sh` 가 `/opt/finally/last-restart`(epoch 초)를 쓴다 · `/opt/finally/watchdog.sh` 가 20초마다 돌며 `watchdog.pid` · `/tmp/watchdog.log`. Task 15 의 감시자가 ssh 로 부르는 `restart.sh` 도 같은 파일을 써서 **팟 안 루프와 유예를 공유**한다.

- [ ] **Step 1: `restart.sh` 가 시각을 남기게 한다**

`deploy/runpod-provision.sh` 의 `restart.sh` heredoc 끝 `echo $! > uvicorn.pid` 아래에 한 줄:

```bash
# 마지막 재시작 시각 — 팟 안 watchdog 와 밖의 감시자가 **같은 유예(180초)** 를 이 파일로 셉니다 (ADR-092 B·C)
date +%s > last-restart
```

- [ ] **Step 2: `watchdog.sh` 를 만들고 띄우는 절을 더한다**

「── 4. 확인 — ready 를 기다립니다」 절이 끝난 뒤(`ollama ps` 앞)에:

```bash
# ── 5. 자가 재시작 루프 — ready 가 확인된 **뒤에** 띄웁니다 (ADR-092 B)
#    첫 적재(모델 내려받기)를 재시작으로 끊지 않게 하려는 순서입니다.
#    조건은 「연속 실패 횟수」가 아니라 「마지막 재시작 뒤 180초가 지났는가」입니다 —
#    재시작 직후 20~40초는 정상이어도 /health 가 안 잡히므로, 세면 자기를 끝없이 죽입니다.
say "watchdog.sh"
cat > /opt/finally/watchdog.sh <<'EOF'
#!/usr/bin/env bash
# 20초마다 /health · ready 아니고 last-restart 가 180초보다 오래됐으면 restart.sh (ADR-092 B)
cd /opt/finally
GRACE=180
while true; do
  now=$(date +%s)
  last=$(cat last-restart 2>/dev/null || echo 0)
  body=$(curl -s -m 8 -H "x-finally-token: $(cat token)" localhost:8917/health || true)
  case "$body" in *'"ready":true'*|*'"ready": true'*) ready=1 ;; *) ready=0 ;; esac
  if [ "$ready" = 0 ] && [ $((now - last)) -ge "$GRACE" ]; then
    echo "$(date -Is) health 실패 → restart.sh (last-restart $((now - last))초 전)" >> /tmp/watchdog.log
    if ! curl -fs -m 3 localhost:11434/api/tags >/dev/null 2>&1; then
      echo "$(date -Is) ollama 도 안 잡힘 → 다시 띄움" >> /tmp/watchdog.log
      setsid nohup ollama serve > /tmp/ollama.log 2>&1 < /dev/null &
      sleep 5
    fi
    setsid /opt/finally/restart.sh < /dev/null
  fi
  sleep 20
done
EOF
chmod +x /opt/finally/watchdog.sh
# 여러 번 돌려도 하나만 — 앞의 것을 pid 파일로만 죽입니다 (pkill -f 는 ssh 세션을 죽입니다)
if [ -f /opt/finally/watchdog.pid ] && kill -0 "$(cat /opt/finally/watchdog.pid)" 2>/dev/null; then
  kill "$(cat /opt/finally/watchdog.pid)"; sleep 1
fi
setsid nohup bash /opt/finally/watchdog.sh > /dev/null 2>&1 < /dev/null &
echo $! > /opt/finally/watchdog.pid
echo "  watchdog pid $(cat /opt/finally/watchdog.pid)"
```

- [ ] **Step 3: 문법을 확인한다**

Run: `cd /mnt/c/Users/TaeHyounKim/Documents/HACKERTON/finance2026/fsec-wt-autowake && bash -n deploy/runpod-provision.sh && echo ok`
Expected: `ok`.

- [ ] **Step 4: 지금 팟에 같은 것을 넣는다 (운영 — 서비스 중단 없음)**

팟 안에서 `restart.sh` 를 **돌리지 않고** 파일만 고치고, watchdog 만 띄웁니다. 아래를 그대로 실행합니다(팟 주소·포트는 `python3 deploy/runpod-pod.py status` 로 확인):

```bash
cd /mnt/c/Users/TaeHyounKim/Documents/HACKERTON/finance2026/fsec-wt-autowake && ssh -i ~/.ssh/id_ed25519_finally -p 10449 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR root@47.47.180.54 'bash -s' <<'REMOTE'
set -e
cd /opt/finally
# restart.sh 에 last-restart 한 줄 (없을 때만)
grep -q 'last-restart' restart.sh || sed -i 's|^echo \$! > uvicorn.pid$|echo $! > uvicorn.pid\ndate +%s > last-restart|' restart.sh
grep -q 'last-restart' restart.sh
# 지금 도는 uvicorn 의 시작 시각을 last-restart 로 — 10시간 전이라 유예는 이미 지났습니다
[ -f last-restart ] || date +%s -d "$(ps -o lstart= -p "$(cat uvicorn.pid)")" > last-restart
REMOTE
```

그다음 provision.sh 의 「── 5」 절만 뽑아 팟에서 돌립니다:

```bash
cd /mnt/c/Users/TaeHyounKim/Documents/HACKERTON/finance2026/fsec-wt-autowake && sed -n '/^# ── 5\. 자가 재시작 루프/,/^echo "  watchdog pid/p' deploy/runpod-provision.sh > /tmp/claude-1000/-mnt-c-Users-TaeHyounKim-Documents-HACKERTON-finance2026-fsec-ai-challenge/92ba212d-91ca-4ec2-8c48-ab148df97683/scratchpad/watchdog-install.sh && (echo 'say() { printf "\n▸ %s\n" "$*"; }'; cat /tmp/claude-1000/-mnt-c-Users-TaeHyounKim-Documents-HACKERTON-finance2026-fsec-ai-challenge/92ba212d-91ca-4ec2-8c48-ab148df97683/scratchpad/watchdog-install.sh) | ssh -i ~/.ssh/id_ed25519_finally -p 10449 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR root@47.47.180.54 'bash -s'
```

- [ ] **Step 5: 확인한다**

```bash
ssh -i ~/.ssh/id_ed25519_finally -p 10449 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR root@47.47.180.54 'ps -o pid,etime,cmd -p $(cat /opt/finally/watchdog.pid); cat /opt/finally/last-restart; sleep 25; cat /tmp/watchdog.log 2>/dev/null | tail -3; ps -o pid,etime -p $(cat /opt/finally/uvicorn.pid)'
```

Expected: watchdog 프로세스가 있고, 25초 뒤에도 `/tmp/watchdog.log` 에 「재시작」 줄이 없으며(서버가 ready 라서), uvicorn 의 `etime` 이 끊기지 않고 이어집니다. 그다음 `python3 deploy/runpod-pod.py health` 가 `ready` 를 냅니다.

⚠️ **uvicorn 을 일부러 죽여서 시험하지 않습니다** — 배포본이 이 팟을 쓰고 있습니다. 재시작 경로는 Task 18 의 시험 팟에서 봅니다.

- [ ] **Step 6: 커밋**

```bash
cd /mnt/c/Users/TaeHyounKim/Documents/HACKERTON/finance2026/fsec-wt-autowake && git add deploy/runpod-provision.sh && git commit -q -F - <<'MSG'
팟 안에 자가 재시작 루프 watchdog.sh 를 둔다 — 20초마다 /health · 마지막 재시작 뒤 180초 유예 · 세지 않는다 (ADR-092 B)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LaeBtmCj3cYVMYB39Z4gba
MSG
```

---

### Task 13: `runpod-pod.py` 를 감시자가 부를 수 있게 — 함수화

**Files:**
- Modify: `deploy/runpod-pod.py`

**Interfaces:**
- Produces (모듈로 import 했을 때 — 파일명에 `-` 가 있어 `importlib` 로 읽습니다):
  ```python
  class PodError(Exception): ...
  POD_NAME = "finally-demo"
  def list_pods() -> list[dict]                     # 계정의 팟 전부 (REST GET /pods)
  def find_pods(name: str = POD_NAME) -> list[dict] # 이름이 같은 것
  def create_pod(name: str = POD_NAME) -> dict      # REST POST /pods — STATE 파일은 안 건드림
  def provision(pod_id: str) -> None                # ssh 로 꾸러미 올리고 provision.sh
  def health_once(pod_id: str, timeout: int = 10) -> dict | None   # 프록시 /health 한 번 · 못 닿으면 None
  def wait_ready(pod_id: str, minutes: int = 15) -> bool
  def terminate(pod_id: str) -> None                # REST DELETE
  def proxy_url(pod_id: str) -> str
  def ssh_target(pod: dict) -> tuple[str, int] | None   # (ip, port) · 아직 안 열렸으면 None
  def ssh_base(ip: str, port: int) -> list[str]     # 있던 것 그대로
  ```
  CLI(`list`·`up`·`status`·`provision`·`health`·`down`)는 그대로 돌아야 한다. `die()` 는 `PodError` 를 던지고 `main()` 이 잡아 종료 코드 1.

- [ ] **Step 1: 지금 CLI 가 어떻게 답하는지 적어 둔다 (회귀 기준)**

Run: `cd /mnt/c/Users/TaeHyounKim/Documents/HACKERTON/finance2026/fsec-wt-autowake && python3 deploy/runpod-pod.py list | head -12 && python3 deploy/runpod-pod.py status | head -12`
Expected: 팟 한 대(`RUNNING`)와 필드 열. 이 출력을 그대로 남겨 둡니다.

- [ ] **Step 2: 함수화한다**

`deploy/runpod-pod.py` 를 이렇게 고칩니다 (핵심만 — 기존 주석은 살립니다):

```python
class PodError(Exception):
    """사람에게 보일 실패. CLI 는 종료 코드 1, 감시자는 잡아서 다음 회차로."""


def die(msg: str) -> None:
    raise PodError(msg)


POD_NAME = POD_SPEC["name"]


def proxy_url(pod_id: str) -> str:
    return f"https://{pod_id}-{PORT}.proxy.runpod.net"


def list_pods() -> list[dict]:
    return api("GET", "/pods") or []


def find_pods(name: str = POD_NAME) -> list[dict]:
    return [p for p in list_pods() if p.get("name") == name]


def create_pod(name: str = POD_NAME) -> dict:
    """팟을 만든다 — **STATE 파일은 안 건드립니다**(감시자는 여러 팟을 다룹니다). CLI 의 `up` 이 그 뒤를 합니다."""
    pub = SSH_KEY.with_suffix(".pub")
    if not pub.exists():
        die(f"{pub} 가 없습니다 — runpod-bench.md 의 ssh 키")
    body = {**POD_SPEC, "name": name, "env": {"PUBLIC_KEY": pub.read_text().strip()}}
    return api("POST", "/pods", body)


def ssh_target(pod: dict) -> tuple[str, int] | None:
    d = describe(pod)
    if d["public_ip"] and d["ssh_port"]:
        return d["public_ip"], int(d["ssh_port"])
    return None


def health_once(pod_id: str, timeout: int = 10) -> dict | None:
    """프록시로 /health 한 번. 못 닿거나 5xx 면 None — 판단은 부르는 쪽이."""
    token = env_local("TRANSCRIBER_TOKEN") or ""
    req = urllib.request.Request(f"{proxy_url(pod_id)}/health", headers={"x-finally-token": token})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return json.loads(res.read())
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, ValueError):
        return None


def wait_ready(pod_id: str, minutes: int = 15) -> bool:
    for _ in range(minutes * 3):
        d = health_once(pod_id, timeout=20)
        print(f"  {proxy_url(pod_id)}/health → {json.dumps(d, ensure_ascii=False) if d else '(못 닿음)'}")
        if d and d.get("ready"):
            return True
        time.sleep(20)
    return False


def provision(pod_id: str) -> None:
    token = env_local("TRANSCRIBER_TOKEN") or die("TRANSCRIBER_TOKEN 이 없습니다 — src/.env.local 또는 환경변수")
    ip, port = wait_ssh(pod_id)
    base = ssh_base(ip, port)
    # (기존 cmd_provision 본문 그대로 — tar · provision.sh · token · bash provision.sh)
    ...


def terminate(pod_id: str) -> None:
    api("DELETE", f"/pods/{pod_id}")
```

그리고 CLI 는 이 함수들을 감쌉니다:

```python
def cmd_up() -> None:
    if STATE.exists():
        die(f"{STATE.name} 이 이미 있습니다 — 팟이 살아 있으면 `down` 먼저, 아니면 파일을 지우세요")
    pod = create_pod()
    STATE.write_text(json.dumps({"id": pod["id"], "created_at": time.strftime("%Y-%m-%dT%H:%M:%S%z")}))
    print(f"✓ 팟을 만들었습니다 — 시간당 ${pod.get('costPerHr')} 가 **지금부터** 갑니다. 끝나면 반드시 `down`")
    show(describe(pod))
    print("\n다음: 2~3분 뒤 `status` 로 CUDA 와 22/tcp 를 확인하고 `provision`")


def cmd_provision() -> None:
    provision(pod_id(sys.argv))
    print(f"\n✓ 끝. 바깥 주소: {proxy_url(pod_id(sys.argv))}  → `health` 로 확인 뒤 vercel-env")


def cmd_health() -> None:
    if wait_ready(pod_id(sys.argv), minutes=10):
        print("✓ ready — 모델이 올라와 있습니다. 이제 vercel-env (runpod-bench.md 「시연 당일 순서」 ④)")
        return
    die("10분을 기다려도 ready 가 아닙니다 — ssh 로 /tmp/uvicorn.log 를 보세요")


def cmd_down() -> None:
    pid = pod_id(sys.argv)
    terminate(pid)
    if STATE.exists():
        STATE.unlink()
    print(f"✓ {pid} 를 지웠습니다(terminate). 과금이 멈춥니다")
    print("남은 것: vercel-env 에서 `clear_ner=true` 와 `transcriber_url=<상시 서버>` — 배포본이 죽은 주소를 부르지 않게 (runpod-bench.md ⑥)")
    print("⚠️ 감시자(finally-runpod-watch)가 돌고 있으면 먼저 멈추세요 — 아니면 30초 안에 새 팟을 만듭니다 (deploy/README.md)")


def main() -> None:
    cmds = {"list": cmd_list, "up": cmd_up, "status": cmd_status, "provision": cmd_provision, "health": cmd_health, "down": cmd_down}
    if len(sys.argv) < 2 or sys.argv[1] not in cmds:
        print(__doc__)
        sys.exit(2)
    try:
        cmds[sys.argv[1]]()
    except PodError as e:
        print(f"✗ {e}", file=sys.stderr)
        sys.exit(1)
```

`api()` 의 HTTPError 갈래는 `die(...)` 그대로라 `PodError` 가 됩니다. `pod_id()` 는 STATE 가 없으면 **이름으로 찾은 RUNNING 팟 하나**를 쓰게 한 갈래를 더합니다(OCI 에는 STATE 파일이 없습니다):

```python
def pod_id(argv: list[str]) -> str:
    if len(argv) > 2:
        return argv[2]
    if STATE.exists():
        return json.loads(STATE.read_text())["id"]
    running = [p for p in find_pods() if p.get("desiredStatus") == "RUNNING"]
    if len(running) == 1:
        return running[0]["id"]
    die("팟 id 가 없습니다 — `up` 을 먼저 하거나 id 를 인자로 주세요")
```

- [ ] **Step 3: CLI 회귀를 확인한다**

Run: `cd /mnt/c/Users/TaeHyounKim/Documents/HACKERTON/finance2026/fsec-wt-autowake && python3 -m py_compile deploy/runpod-pod.py && python3 deploy/runpod-pod.py list | head -12 && python3 deploy/runpod-pod.py status | head -12 && python3 deploy/runpod-pod.py 2>&1 | head -3; echo "exit=$?"`
Expected: Step 1 과 같은 출력. 인자 없이 부르면 사용법과 종료 코드 2.

import 도 확인합니다:

```bash
cd /mnt/c/Users/TaeHyounKim/Documents/HACKERTON/finance2026/fsec-wt-autowake && python3 - <<'PY'
import importlib.util, pathlib
spec = importlib.util.spec_from_file_location("runpod_pod", pathlib.Path("deploy/runpod-pod.py"))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
print([p["id"] for p in m.find_pods()], m.proxy_url("abc"), m.health_once(m.find_pods()[0]["id"]) is not None)
PY
```

Expected: 팟 id 목록 · `https://abc-8917.proxy.runpod.net` · `True`.

- [ ] **Step 4: 커밋**

```bash
cd /mnt/c/Users/TaeHyounKim/Documents/HACKERTON/finance2026/fsec-wt-autowake && git add deploy/runpod-pod.py && git commit -q -F - <<'MSG'
runpod-pod.py 를 함수로 가른다 — 감시자가 부르게 · PodError · 이름으로 팟 찾기. CLI 는 그대로 (ADR-092 C·D)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LaeBtmCj3cYVMYB39Z4gba
MSG
```

---

### Task 14: 감시자의 판단 — 순수 함수 `decide()` 와 시험

**Files:**
- Create: `deploy/runpod-watch.py` (이 태스크에서는 판단 부분만)
- Create: `deploy/test_runpod_watch.py`

**Interfaces:**
- Produces:
  ```python
  GRACE_SEC = 180
  LOOP_SEC = 30
  LOW_BALANCE_HOURS = 12
  NOTIFY_EVERY_SEC = 6 * 3600

  @dataclass
  class State:                      # /var/lib/finally/watch.json 의 내용
      pod_id: str | None = None     # 마지막으로 정상 확인한 팟
      restart_pod: str | None = None
      restart_at: float = 0.0       # 밖에서 restart.sh 를 건 시각(epoch)
      creating: dict | None = None  # {"pod_id":..., "since":...} — 만드는 도중 죽었을 때 정리용
      create_failures: list[float] = field(default_factory=list)
      notified: dict[str, float] = field(default_factory=dict)

  # 조치(action) — 실행은 loop 가, 판단은 여기가
  Ok = ("ok", pod_id)
  Wait = ("wait", reason)
  Restart = ("restart", pod_id)
  Recreate = ("recreate", old_pod_id | None)

  def decide(state: State, now: float, pods: list[dict], healthy: bool | None) -> tuple
  ```

- [ ] **Step 1: 실패하는 시험을 쓴다**

`deploy/test_runpod_watch.py`:

```python
"""감시자의 판단 시험 — ADR-092 C. 세지 않고, 싼 조치부터, 비싼 조치는 확인된 사실 뒤에만."""
import importlib.util
import pathlib
import unittest

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("runpod_watch", HERE / "runpod-watch.py")
w = importlib.util.module_from_spec(spec)
spec.loader.exec_module(w)


def running(pod_id="p1"):
    return {"id": pod_id, "name": "finally-demo", "desiredStatus": "RUNNING"}


class Decide(unittest.TestCase):
    def test_no_pod_means_recreate_now(self):
        self.assertEqual(w.decide(w.State(), 1000.0, [], None), ("recreate", None))

    def test_exited_pod_counts_as_none(self):
        pods = [{"id": "p1", "name": "finally-demo", "desiredStatus": "EXITED"}]
        self.assertEqual(w.decide(w.State(), 1000.0, pods, None), ("recreate", "p1"))

    def test_running_and_healthy_is_ok(self):
        self.assertEqual(w.decide(w.State(), 1000.0, [running()], True), ("ok", "p1"))

    def test_running_unhealthy_without_recent_action_restarts_immediately(self):
        # 한 번의 실패에 바로 — 세지 않는다. 대가는 워밍업 1~2분뿐
        self.assertEqual(w.decide(w.State(), 1000.0, [running()], False), ("restart", "p1"))

    def test_within_grace_after_restart_waits(self):
        st = w.State(restart_pod="p1", restart_at=1000.0)
        self.assertEqual(w.decide(st, 1000.0 + 179, [running()], False), ("wait", "warming"))

    def test_after_grace_still_unhealthy_recreates(self):
        st = w.State(restart_pod="p1", restart_at=1000.0)
        self.assertEqual(w.decide(st, 1000.0 + 180, [running()], False), ("recreate", "p1"))

    def test_restart_record_of_another_pod_does_not_count(self):
        # 옛 팟에 건 재시작은 새 팟의 판단에 안 끼어든다
        st = w.State(restart_pod="old", restart_at=1000.0)
        self.assertEqual(w.decide(st, 1000.0 + 10, [running("p2")], False), ("restart", "p2"))

    def test_healthy_clears_restart_record(self):
        st = w.State(restart_pod="p1", restart_at=1000.0)
        w.apply_ok(st, "p1", 1100.0)
        self.assertIsNone(st.restart_pod)
        self.assertEqual(st.pod_id, "p1")

    def test_two_running_pods_prefer_the_known_one(self):
        st = w.State(pod_id="p2")
        self.assertEqual(w.decide(st, 1000.0, [running("p1"), running("p2")], True), ("ok", "p2"))


class Notify(unittest.TestCase):
    def test_same_kind_at_most_once_per_six_hours(self):
        st = w.State()
        self.assertTrue(w.should_notify(st, "low_balance", 1000.0))
        w.mark_notified(st, "low_balance", 1000.0)
        self.assertFalse(w.should_notify(st, "low_balance", 1000.0 + 6 * 3600 - 1))
        self.assertTrue(w.should_notify(st, "low_balance", 1000.0 + 6 * 3600))


class Balance(unittest.TestCase):
    def test_hours_left(self):
        self.assertAlmostEqual(w.hours_left(29.76, 0.748), 39.786, places=2)
        self.assertEqual(w.hours_left(10.0, 0.0), float("inf"))


class CreateBackoff(unittest.TestCase):
    def test_three_failures_in_an_hour_pause_creation(self):
        st = w.State(create_failures=[100.0, 200.0, 300.0])
        self.assertTrue(w.creation_paused(st, 400.0))
        self.assertFalse(w.creation_paused(st, 300.0 + 3600))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd /mnt/c/Users/TaeHyounKim/Documents/HACKERTON/finance2026/fsec-wt-autowake/deploy && python3 -m unittest test_runpod_watch -v 2>&1 | tail -5`
Expected: FAIL — `runpod-watch.py` 없음.

- [ ] **Step 3: 판단 부분을 쓴다**

`deploy/runpod-watch.py`:

```python
#!/usr/bin/env python3
"""추론 팟 감시자 — 상시 서버(OCI)에서 systemd 로 돈다. 세지 않고, 싼 조치부터.

정본: decisions/092-pod-self-heal-and-watcher.md (C · D · E · F)
설치: deploy/runpod-watch-install.sh · 운영: deploy/README.md 「팟이 죽으면」

## 매 회(30초) 하는 일 — 순서가 곧 정책입니다

1. RunPod API 로 이름이 finally-demo 인 팟을 본다. RUNNING 이 없으면 → 새 팟.
2. 있으면 /health 한 번. ready 면 끝.
3. 아니면: 재시작 건 지 180초 안이면 기다림 · 아니면 ssh 로 restart.sh.
4. 재시작 뒤 180초 지나도 안 되면 → 그 팟 terminate + 새 팟.

「연속 N회 실패」 조건이 없습니다. 재시작 직후 모델을 올리는 20~40초는 「조치 뒤 유예」로,
잠깐의 흔들림에 비싼 조치를 하는 것은 「싼 조치부터」로 막습니다.

## 쓰는 법

    python3 deploy/runpod-watch.py            # 계속 돈다 (systemd 가 이렇게 띄운다)
    python3 deploy/runpod-watch.py --once     # 한 회만 — 손으로 확인할 때
    python3 deploy/runpod-watch.py --once --shadow   # 새 팟 경로를 시험 — 만들고 채우고 health 까지, 주소 교체 없이 terminate

멈추려면(손으로 down 할 때 등): touch /var/lib/finally/watch.paused
환경변수(/etc/finally/watch.env): RUNPOD_API_KEY · TRANSCRIBER_TOKEN · POD_SSH_KEY · GITHUB_TOKEN ·
GITHUB_REPO · APP_ORIGIN · CRON_SECRET · MAILER_API_KEY · MAILER_FROM · NOTIFY_TO · STATE_DIR
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass, field
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("runpod_pod", HERE / "runpod-pod.py")
pod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pod)

GRACE_SEC = 180
LOOP_SEC = 30
LOW_BALANCE_HOURS = 12
NOTIFY_EVERY_SEC = 6 * 3600
BALANCE_EVERY_SEC = 10 * 60
CREATE_FAILURES_MAX = 3
CREATE_PAUSE_SEC = 3600
POD_NAME = pod.POD_NAME


@dataclass
class State:
    pod_id: str | None = None
    restart_pod: str | None = None
    restart_at: float = 0.0
    creating: dict | None = None
    create_failures: list[float] = field(default_factory=list)
    notified: dict[str, float] = field(default_factory=dict)
    balance_checked_at: float = 0.0


def decide(state: State, now: float, pods: list[dict], healthy: bool | None) -> tuple:
    """판단만. 네트워크도 파일도 안 건드린다 — 시험이 표로 검다."""
    running = [p for p in pods if p.get("desiredStatus") == "RUNNING"]
    if not running:
        leftover = pods[0]["id"] if pods else None
        return ("recreate", leftover)
    chosen = next((p for p in running if p["id"] == state.pod_id), running[0])
    pid = chosen["id"]
    if healthy:
        return ("ok", pid)
    if state.restart_pod == pid and state.restart_at:
        if now - state.restart_at < GRACE_SEC:
            return ("wait", "warming")
        return ("recreate", pid)
    return ("restart", pid)


def apply_ok(state: State, pod_id: str, now: float) -> None:
    state.pod_id = pod_id
    state.restart_pod = None
    state.restart_at = 0.0


def should_notify(state: State, kind: str, now: float) -> bool:
    return now - state.notified.get(kind, 0.0) >= NOTIFY_EVERY_SEC


def mark_notified(state: State, kind: str, now: float) -> None:
    state.notified[kind] = now


def hours_left(balance: float, per_hour: float) -> float:
    return float("inf") if per_hour <= 0 else balance / per_hour


def creation_paused(state: State, now: float) -> bool:
    recent = [t for t in state.create_failures if now - t < CREATE_PAUSE_SEC]
    return len(recent) >= CREATE_FAILURES_MAX
```

(조치·루프는 Task 15 에서 이 아래에 이어 씁니다. 이 태스크의 파일은 위 판단 함수까지만 있어도 시험이 돕니다.)

- [ ] **Step 4: 통과를 확인한다**

Run: `cd /mnt/c/Users/TaeHyounKim/Documents/HACKERTON/finance2026/fsec-wt-autowake/deploy && python3 -m unittest test_runpod_watch -v 2>&1 | tail -5`
Expected: 전부 OK.

- [ ] **Step 5: 커밋**

```bash
cd /mnt/c/Users/TaeHyounKim/Documents/HACKERTON/finance2026/fsec-wt-autowake && git add deploy/runpod-watch.py deploy/test_runpod_watch.py && git commit -q -F - <<'MSG'
감시자의 판단을 순수 함수 decide() 로 둔다 — 없으면 새 팟 · 죽었으면 바로 재시작 · 유예 180초 뒤에도 안 되면 새 팟 (ADR-092 C)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LaeBtmCj3cYVMYB39Z4gba
MSG
```

---

### Task 15: 감시자의 조치와 루프 — 재시작 · 새 팟 · 주소 교체 · 다시 맡기기 · 메일 · 잔액

**Files:**
- Modify: `deploy/runpod-watch.py` (Task 14 아래에 이어서)
- Test: `deploy/test_runpod_watch.py` (GitHub 실행 고르기 · 메일 본문 등 순수 부분)

**Interfaces:**
- Consumes: Task 13 의 `pod.*` 함수 · Task 14 의 `decide` 등 · 앱의 `POST /api/cron/evidence-resubmit`(Task 9) · GitHub `vercel-env` 워크플로(있음)
- Produces:
  ```python
  def env(name: str, default: str | None = None) -> str | None
  def load_state(path: Path) -> State · def save_state(path: Path, st: State) -> None
  def do_restart(pod_obj: dict) -> None                       # ssh 'setsid /opt/finally/restart.sh < /dev/null'
  def do_recreate(st: State, old_pod_id: str | None, now: float, shadow: bool) -> str | None   # 새 팟 id
  def switch_backend(url: str) -> bool                        # vercel-env dispatch + 완료 대기
  def pick_run_after(runs: list[dict], since_iso: str) -> dict | None   # 순수 — 시험 대상
  def call_resubmit() -> dict | None
  def send_mail(subject: str, text: str) -> None
  def check_balance(st: State, now: float) -> None
  def tick(st: State, now: float, shadow: bool = False) -> str   # 한 회 · 조치 이름을 돌려줌
  def main() -> None
  ```

- [ ] **Step 1: 순수 부분의 실패하는 시험을 쓴다**

`deploy/test_runpod_watch.py` 에 추가:

```python
class GithubRuns(unittest.TestCase):
    def test_pick_first_run_created_after_dispatch(self):
        runs = [
            {"id": 3, "created_at": "2026-09-07T01:00:30Z", "status": "queued"},
            {"id": 2, "created_at": "2026-09-07T00:59:00Z", "status": "completed"},
        ]
        self.assertEqual(w.pick_run_after(runs, "2026-09-07T01:00:00Z")["id"], 3)
        self.assertIsNone(w.pick_run_after(runs, "2026-09-07T01:01:00Z"))


class Mail(unittest.TestCase):
    def test_body_has_pod_and_url_but_no_secret(self):
        text = w.mail_text("new_pod", pod_id="abc", url="https://abc-8917.proxy.runpod.net", extra="ok")
        self.assertIn("abc", text)
        self.assertIn("https://abc-8917.proxy.runpod.net", text)
        self.assertNotIn("Bearer", text)
```

Run: `cd …/deploy && python3 -m unittest test_runpod_watch -v 2>&1 | tail -4` → Expected: 새 둘 FAIL.

- [ ] **Step 2: 조치와 루프를 쓴다**

`deploy/runpod-watch.py` 의 Task 14 코드 아래에:

```python
# ── 환경 · 상태 ─────────────────────────────────────────────────────────

def env(name: str, default: str | None = None) -> str | None:
    return os.environ.get(name) or default


def state_dir() -> Path:
    return Path(env("STATE_DIR", "/var/lib/finally"))


def load_state(path: Path) -> State:
    if not path.exists():
        return State()
    try:
        return State(**json.loads(path.read_text()))
    except (ValueError, TypeError):
        return State()


def save_state(path: Path, st: State) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(asdict(st)))


def log(msg: str) -> None:
    print(f"{time.strftime('%Y-%m-%dT%H:%M:%S%z')} {msg}", flush=True)


# ── 조치 ────────────────────────────────────────────────────────────────

def do_restart(pod_obj: dict) -> None:
    target = pod.ssh_target(pod_obj)
    if not target:
        raise pod.PodError("ssh 포트가 안 열려 있어 재시작을 못 겁니다")
    ip, port = target
    subprocess.run(pod.ssh_base(ip, port) + ["setsid /opt/finally/restart.sh < /dev/null"], check=True, timeout=60)


def do_recreate(st: State, old_pod_id: str | None, now: float, shadow: bool = False) -> str | None:
    """새 팟 — 손 절차 그대로. 실패하면 create_failures 에 적고 None."""
    if creation_paused(st, now):
        log("새 팟 만들기를 쉽니다 — 한 시간에 세 번 실패했습니다")
        return None
    name = f"{POD_NAME}-shadow" if shadow else POD_NAME
    new_id = None
    try:
        for attempt in range(3):
            created = pod.create_pod(name)
            new_id = created["id"]
            st.creating = {"pod_id": new_id, "since": now}
            log(f"팟 생성 {new_id} (시도 {attempt + 1})")
            try:
                pod.provision(new_id)
                break
            except pod.PodError as e:
                # runpod-bench.md 의 두 함정(CUDA · 22/tcp) — down 뒤 다시 up
                log(f"채우기 실패 {new_id}: {e} → terminate 후 다시")
                pod.terminate(new_id)
                new_id = None
        if not new_id:
            raise pod.PodError("세 번 만들어도 채우지 못했습니다")
        if not pod.wait_ready(new_id, minutes=15):
            raise pod.PodError(f"{new_id} 가 15분이 지나도 ready 가 아닙니다")
        url = pod.proxy_url(new_id)
        if shadow:
            log(f"shadow — {url} ready 확인. 주소 교체 없이 terminate")
            pod.terminate(new_id)
            st.creating = None
            return new_id
        switched = switch_backend(url)
        if old_pod_id and old_pod_id != new_id:
            try:
                pod.terminate(old_pod_id)
            except pod.PodError as e:
                log(f"옛 팟 {old_pod_id} terminate 실패: {e}")
        resub = call_resubmit() if switched else None
        send_mail(
            "[FinAlly] 추론 팟을 새로 세웠습니다" + ("" if switched else " — 주소 교체는 손으로"),
            mail_text("new_pod", pod_id=new_id, url=url, extra=f"switched={switched} resubmit={resub}"),
        )
        st.creating = None
        st.create_failures = []
        return new_id
    except (pod.PodError, subprocess.SubprocessError, OSError) as e:
        st.create_failures.append(now)
        st.creating = None
        if new_id:
            try:
                pod.terminate(new_id)
            except pod.PodError:
                pass
        log(f"새 팟 실패: {e}")
        if should_notify(st, "create_failed", now):
            send_mail("[FinAlly] 추론 팟을 새로 세우지 못했습니다", mail_text("create_failed", extra=str(e)))
            mark_notified(st, "create_failed", now)
        return None


# ── GitHub — vercel-env 워크플로로 주소 교체 (ADR-092 D-④) ─────────────────

def gh(method: str, path: str, body: dict | None = None) -> dict | list | None:
    token = env("GITHUB_TOKEN")
    if not token:
        raise pod.PodError("GITHUB_TOKEN 이 없습니다")
    req = urllib.request.Request(
        f"https://api.github.com{path}",
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as res:
        raw = res.read()
        return json.loads(raw) if raw else None


def pick_run_after(runs: list[dict], since_iso: str) -> dict | None:
    later = [r for r in runs if r.get("created_at", "") >= since_iso]
    return min(later, key=lambda r: r["created_at"]) if later else None


def switch_backend(url: str) -> bool:
    """vercel-env 를 걸고 끝나기를 기다린다. 토큰이 없거나 실패하면 False — 메일로 사람에게."""
    repo = env("GITHUB_REPO", "Dojaegyum/fsec-ai-challenge")
    if not env("GITHUB_TOKEN"):
        log("GITHUB_TOKEN 이 없어 주소 교체를 건너뜁니다 — 손으로 vercel-env")
        return False
    since = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - 5))
    try:
        gh("POST", f"/repos/{repo}/actions/workflows/vercel-env.yml/dispatches", {
            "ref": "main",
            "inputs": {"transcriber_url": url, "ner_url": url, "set_ner_token": "true", "redeploy": "true"},
        })
        run = None
        for _ in range(24):
            time.sleep(5)
            got = gh("GET", f"/repos/{repo}/actions/workflows/vercel-env.yml/runs?event=workflow_dispatch&per_page=5")
            run = pick_run_after((got or {}).get("workflow_runs", []), since)
            if run:
                break
        if not run:
            log("vercel-env 실행을 못 찾았습니다")
            return False
        for _ in range(60):  # 최대 30분 — 워크플로 자체가 deploy 를 기다립니다
            time.sleep(30)
            cur = gh("GET", f"/repos/{repo}/actions/runs/{run['id']}")
            if cur and cur.get("status") == "completed":
                ok = cur.get("conclusion") == "success"
                log(f"vercel-env {run['id']} → {cur.get('conclusion')}")
                return ok
        log("vercel-env 가 30분 안에 안 끝났습니다")
        return False
    except (urllib.error.URLError, urllib.error.HTTPError, pod.PodError, ValueError) as e:
        log(f"주소 교체 실패: {e}")
        return False


# ── 앱 — 다시 맡기기 (ADR-091 §5) ─────────────────────────────────────────

def call_resubmit() -> dict | None:
    origin, secret = env("APP_ORIGIN"), env("CRON_SECRET")
    if not origin or not secret:
        return None
    req = urllib.request.Request(
        f"{origin.rstrip('/')}/api/cron/evidence-resubmit",
        method="POST",
        headers={"Authorization": f"Bearer {secret}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as res:
            return json.loads(res.read())
    except (urllib.error.URLError, urllib.error.HTTPError, ValueError) as e:
        log(f"다시 맡기기 호출 실패: {e}")
        return None


# ── 메일 (Brevo · ADR-092 F) ─────────────────────────────────────────────

def mail_text(kind: str, pod_id: str = "", url: str = "", extra: str = "") -> str:
    lines = {
        "restart": "팟은 RUNNING 인데 /health 가 안 돼 ssh 로 restart.sh 를 걸었습니다.",
        "new_pod": "팟이 없거나 재시작으로 안 살아나 새 팟을 만들고 채웠습니다.",
        "create_failed": "새 팟을 만들거나 채우지 못했습니다. RunPod 콘솔과 잔액을 보세요.",
        "low_balance": "RunPod 잔액이 12시간치 아래입니다. 충전하지 않으면 팟이 삭제됩니다.",
    }
    return "\n".join(filter(None, [
        lines.get(kind, kind),
        f"팟: {pod_id}" if pod_id else "",
        f"주소: {url}" if url else "",
        extra,
        "— finally-runpod-watch (ADR-092)",
    ]))


def send_mail(subject: str, text: str) -> None:
    key, sender, to = env("MAILER_API_KEY"), env("MAILER_FROM"), env("NOTIFY_TO")
    if not (key and sender and to):
        log(f"메일 설정이 없어 로그로만: {subject}")
        return
    body = {"sender": {"email": sender}, "to": [{"email": to}], "subject": subject, "textContent": text}
    req = urllib.request.Request(
        "https://api.brevo.com/v3/smtp/email",
        data=json.dumps(body).encode(),
        method="POST",
        headers={"api-key": key, "Content-Type": "application/json", "Accept": "application/json"},
    )
    try:
        urllib.request.urlopen(req, timeout=30).read()
    except (urllib.error.URLError, urllib.error.HTTPError) as e:
        log(f"메일 실패: {e}")


# ── 잔액 (ADR-092 A) ────────────────────────────────────────────────────

def check_balance(st: State, now: float) -> None:
    if now - st.balance_checked_at < BALANCE_EVERY_SEC:
        return
    st.balance_checked_at = now
    key = env("RUNPOD_API_KEY")
    req = urllib.request.Request(
        "https://api.runpod.io/graphql",
        data=json.dumps({"query": "{ myself { clientBalance currentSpendPerHr } }"}).encode(),
        method="POST",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            me = json.loads(res.read())["data"]["myself"]
    except (urllib.error.URLError, urllib.error.HTTPError, ValueError, KeyError) as e:
        log(f"잔액 조회 실패: {e}")
        return
    hours = hours_left(float(me["clientBalance"]), float(me["currentSpendPerHr"]))
    log(f"잔액 ${me['clientBalance']:.2f} · 시간당 ${me['currentSpendPerHr']:.3f} · {hours:.1f}h")
    if hours < LOW_BALANCE_HOURS and should_notify(st, "low_balance", now):
        send_mail("[FinAlly] RunPod 잔액이 12시간치 아래입니다", mail_text("low_balance", extra=f"{hours:.1f}시간 남음"))
        mark_notified(st, "low_balance", now)


# ── 한 회 ───────────────────────────────────────────────────────────────

def tick(st: State, now: float, shadow: bool = False) -> str:
    if (state_dir() / "watch.paused").exists():
        return "paused"
    if st.creating:
        # 만드는 도중 감시자가 죽었던 흔적 — 그 팟이 ready 면 쓰고, 아니면 지웁니다
        leftover = st.creating["pod_id"]
        st.creating = None
        if not (pod.health_once(leftover) or {}).get("ready"):
            try:
                pod.terminate(leftover)
            except pod.PodError:
                pass
    pods = pod.find_pods()
    running = [p for p in pods if p.get("desiredStatus") == "RUNNING"]
    healthy = None
    if running:
        chosen = next((p for p in running if p["id"] == st.pod_id), running[0])
        healthy = bool((pod.health_once(chosen["id"]) or {}).get("ready"))
    action, arg = decide(st, now, pods, healthy)
    if shadow:
        do_recreate(st, None, now, shadow=True)
        return "shadow"
    if action == "ok":
        apply_ok(st, arg, now)
    elif action == "wait":
        pass
    elif action == "restart":
        target = next(p for p in running if p["id"] == arg)
        log(f"{arg} 가 RUNNING 인데 health 실패 → restart.sh")
        try:
            do_restart(target)
        except (pod.PodError, subprocess.SubprocessError) as e:
            log(f"재시작 못 걸음: {e}")
        st.restart_pod, st.restart_at = arg, now
        if should_notify(st, "restart", now):
            send_mail("[FinAlly] 추론 팟을 재시작했습니다", mail_text("restart", pod_id=arg))
            mark_notified(st, "restart", now)
    elif action == "recreate":
        log(f"새 팟 — 이유: {'팟 없음' if arg is None or not running else '재시작 뒤에도 안 살아남'}")
        new_id = do_recreate(st, arg, now)
        if new_id:
            apply_ok(st, new_id, time.time())
    check_balance(st, now)
    return action


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--shadow", action="store_true", help="새 팟 경로만 시험 — 주소 교체 없이 terminate")
    args = ap.parse_args()
    path = state_dir() / "watch.json"
    while True:
        st = load_state(path)
        try:
            action = tick(st, time.time(), shadow=args.shadow)
            log(f"tick → {action}")
        except Exception as e:  # noqa: BLE001 — 감시자는 어떤 예외에도 죽지 않고 다음 회차로
            log(f"tick 예외: {e!r}")
        save_state(path, st)
        if args.once:
            return
        time.sleep(LOOP_SEC)


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: 시험과 한 회를 확인한다**

Run: `cd /mnt/c/Users/TaeHyounKim/Documents/HACKERTON/finance2026/fsec-wt-autowake/deploy && python3 -m unittest test_runpod_watch -v 2>&1 | tail -4`
Expected: 전부 OK.

로컬에서 **한 회만** 돌려 지금 팟이 `ok` 로 판정되는지 봅니다(조치는 일어나지 않습니다 — 팟이 정상이므로):

```bash
cd /mnt/c/Users/TaeHyounKim/Documents/HACKERTON/finance2026/fsec-wt-autowake && STATE_DIR=/tmp/claude-1000/-mnt-c-Users-TaeHyounKim-Documents-HACKERTON-finance2026-fsec-ai-challenge/92ba212d-91ca-4ec2-8c48-ab148df97683/scratchpad/watch python3 deploy/runpod-watch.py --once
```

Expected: `… 잔액 $… · …h` 와 `tick → ok`. `$STATE_DIR/watch.json` 에 `pod_id` 가 적힙니다.

- [ ] **Step 4: 커밋**

```bash
cd /mnt/c/Users/TaeHyounKim/Documents/HACKERTON/finance2026/fsec-wt-autowake && git add deploy/runpod-watch.py deploy/test_runpod_watch.py && git commit -q -F - <<'MSG'
감시자의 조치와 루프 — ssh 재시작 · 새 팟(손 절차 그대로) · vercel-env 로 주소 교체 · 다시 맡기기 호출 · Brevo 메일 · 잔액 경고 (ADR-092 C·D·F)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LaeBtmCj3cYVMYB39Z4gba
MSG
```

---

### Task 16: OCI 설치 꾸러미와 운영 문서

**Files:**
- Create: `deploy/finally-runpod-watch.service` · `deploy/runpod-watch-install.sh` · `deploy/watch.env.example`
- Modify: `deploy/README.md` (새 절 「팟이 죽으면 — 세 겹」) · `deploy/runpod-bench.md` (「시연 당일 순서」 ⑥ 앞에 감시자 멈추기)

- [ ] **Step 1: 유닛 · 예시 env · 설치 스크립트**

`deploy/finally-runpod-watch.service`:

```ini
# 추론 팟 감시자 — ADR-092 C. 설치: deploy/runpod-watch-install.sh
[Unit]
Description=FinAlly RunPod pod watcher (restart / recreate / switch)
After=network-online.target
Wants=network-online.target

[Service]
User=ubuntu
EnvironmentFile=/etc/finally/watch.env
WorkingDirectory=/home/ubuntu/fsec-ai-challenge
ExecStart=/usr/bin/python3 /home/ubuntu/fsec-ai-challenge/deploy/runpod-watch.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

`deploy/watch.env.example`:

```bash
# /etc/finally/watch.env — 감시자의 비밀값. chmod 600 · 소유자 ubuntu. 저장소에 넣지 않습니다 (RFC-001 「deploy/」)
RUNPOD_API_KEY=
TRANSCRIBER_TOKEN=           # 팟의 FINALLY_TOKEN 과 같은 값 — provision 이 팟에 넣습니다
POD_SSH_KEY=/home/ubuntu/.ssh/id_ed25519_finally
GITHUB_TOKEN=                # fine-grained PAT · 이 저장소 · Actions: Read and write 만. 비우면 주소 교체를 건너뛰고 메일로 알립니다
GITHUB_REPO=Dojaegyum/fsec-ai-challenge
APP_ORIGIN=https://fin-ally-khaki.vercel.app
CRON_SECRET=                 # 배포본과 같은 값 — /api/cron/evidence-resubmit 를 부릅니다
MAILER_API_KEY=              # Brevo
MAILER_FROM=
NOTIFY_TO=                   # 알림 받을 주소
STATE_DIR=/var/lib/finally
```

`deploy/runpod-watch-install.sh` (OCI 에서 `ubuntu` 로 실행 · 여러 번 돌려도 안전):

```bash
#!/usr/bin/env bash
# 상시 서버(OCI)에 감시자를 설치한다 — ADR-092 C·E.  서버에서:  bash runpod-watch-install.sh
set -euo pipefail
REPO_DIR=/home/ubuntu/fsec-ai-challenge
say() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }

say "저장소"
if [ -d "$REPO_DIR/.git" ]; then git -C "$REPO_DIR" pull -q --ff-only; else git clone -q https://github.com/Dojaegyum/fsec-ai-challenge.git "$REPO_DIR"; fi

say "비밀값 자리"
sudo mkdir -p /etc/finally /var/lib/finally
sudo chown ubuntu:ubuntu /var/lib/finally
if [ ! -f /etc/finally/watch.env ]; then
  sudo cp "$REPO_DIR/deploy/watch.env.example" /etc/finally/watch.env
  sudo chown ubuntu:ubuntu /etc/finally/watch.env && sudo chmod 600 /etc/finally/watch.env
  echo "  /etc/finally/watch.env 를 채우고 다시 돌리세요"; exit 0
fi
sudo chmod 600 /etc/finally/watch.env
[ -f /home/ubuntu/.ssh/id_ed25519_finally ] || { echo "✗ /home/ubuntu/.ssh/id_ed25519_finally 가 없습니다 — 팟 ssh 키를 복사하세요"; exit 1; }
chmod 600 /home/ubuntu/.ssh/id_ed25519_finally

say "systemd"
sudo cp "$REPO_DIR/deploy/finally-runpod-watch.service" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now finally-runpod-watch
sleep 3
systemctl --no-pager status finally-runpod-watch | head -8
echo
echo "로그: journalctl -u finally-runpod-watch -f   · 멈춤: touch /var/lib/finally/watch.paused"
```

`runpod-pod.py` 의 `SSH_KEY` 는 `Path.home()/.ssh/id_ed25519_finally` 라 `ubuntu` 로 돌면 그 경로입니다 — `POD_SSH_KEY` 를 읽도록 `SSH_KEY = Path(os.environ.get("POD_SSH_KEY") or Path.home() / ".ssh" / "id_ed25519_finally")` 로 한 줄 고칩니다(Task 13 의 파일).

- [ ] **Step 2: 문서**

`deploy/README.md` 에 「## 아직 여기 없는 것」 앞에 새 절:

```markdown
## 팟이 죽으면 — 세 겹 (2026-09-07 · [ADR-092](../decisions/092-pod-self-heal-and-watcher.md))

| 겹 | 무엇 | 어디서 | 얼마나 |
| --- | --- | --- | --- |
| 돈 | RunPod **auto-pay** 와 잔액 알림 — 콘솔 Billing · Settings → Notification | 사람이 켬 | 잔액 0 이면 볼륨 없는 팟은 삭제됩니다 |
| 프로세스 | `/opt/finally/watchdog.sh` — 20초마다 `/health`, 마지막 재시작 뒤 180초 지났으면 `restart.sh` | 팟 안 (`runpod-provision.sh` 가 설치) | 2~3분 |
| 팟 | `finally-runpod-watch` systemd 서비스 — 30초마다 RunPod API + `/health`. 없으면 새 팟, RUNNING 인데 죽었으면 ssh 재시작 → 180초 뒤에도 안 되면 새 팟. 새 팟이면 `vercel-env` 를 걸어 주소 교체 → `POST /api/cron/evidence-resubmit` → 메일 | 상시 서버(OCI 141.148.13.6) | 15~20분 |

**세지 않습니다** — 연속 실패 조건이 없습니다. 조치 뒤 유예 180초와 「싼 조치부터」가 그 역할을 합니다.

설치는 서버에서 `bash deploy/runpod-watch-install.sh` — 처음 돌리면 `/etc/finally/watch.env` 를 만들어 두고 멈춥니다. 채울 값은
`deploy/watch.env.example`. 팟 ssh 키(`~/.ssh/id_ed25519_finally`)를 `ubuntu` 홈에 복사해야 합니다.

| 하고 싶은 것 | 명령 |
| --- | --- |
| 지금 뭘 하나 | `journalctl -u finally-runpod-watch -f` |
| **손으로 `down` 하기 전에** | `touch /var/lib/finally/watch.paused` — 안 하면 30초 안에 새 팟을 만듭니다 |
| 다시 켜기 | `rm /var/lib/finally/watch.paused` |
| 한 회만 손으로 | `set -a; . /etc/finally/watch.env; set +a; python3 deploy/runpod-watch.py --once` |
| 새 팟 경로 시험(주소 교체 없이 · 약 $0.3) | 같은 명령에 `--shadow` |

`GITHUB_TOKEN` 이 비어 있으면 새 팟까지는 만들고 **주소 교체는 건너뛰고 메일로 알립니다** — 그때는 Actions → `vercel-env` 를 손으로.
자료 쪽은 그동안 「재시도중」으로 기다립니다([ADR-091](../decisions/091-evidence-retrying-not-failed.md)).
```

`deploy/runpod-bench.md` 「시연 당일 순서」 표 ⑥ 줄 앞에 한 줄 추가:

```markdown
| ⑤½ | 감시자가 돌고 있으면 **먼저 멈춥니다** — OCI 에서 `touch /var/lib/finally/watch.paused` | 안 멈추면 ⑥ 의 `down` 30초 뒤 새 팟이 생깁니다 ([ADR-092](../decisions/092-pod-self-heal-and-watcher.md)) |
```

- [ ] **Step 3: 검사기와 커밋**

Run: `cd /mnt/c/Users/TaeHyounKim/Documents/HACKERTON/finance2026/fsec-wt-autowake && bash -n deploy/runpod-watch-install.sh && python3 .github/scripts/doc-integrity.py`
Expected: 「문제 없습니다」.

```bash
cd /mnt/c/Users/TaeHyounKim/Documents/HACKERTON/finance2026/fsec-wt-autowake && git add deploy/finally-runpod-watch.service deploy/runpod-watch-install.sh deploy/watch.env.example deploy/runpod-pod.py deploy/README.md deploy/runpod-bench.md && git commit -q -F - <<'MSG'
감시자를 OCI 에 systemd 로 설치하는 꾸러미와 운영 문서 — 손으로 down 하기 전엔 watch.paused (ADR-092 E)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LaeBtmCj3cYVMYB39Z4gba
MSG
```

---

### Task 17: 전체 검증 · 푸시 · PR

- [ ] **Step 1: 전부 돌린다**

```bash
cd /mnt/c/Users/TaeHyounKim/Documents/HACKERTON/finance2026/fsec-wt-autowake/src && npm run typecheck && npm run lint && npx vitest run 2>&1 | tail -6
cd /mnt/c/Users/TaeHyounKim/Documents/HACKERTON/finance2026/fsec-wt-autowake && python3 .github/scripts/doc-integrity.py && python3 .github/scripts/route-contract.py && python3 .github/scripts/schema-names.py && (cd deploy && python3 -m unittest test_runpod_watch) && python3 -m unittest discover -s services/transcriber -t . 2>&1 | tail -2
```

Expected: 전부 통과. `next build` 는 Vercel 이 하므로 여기서는 안 돌립니다(deploy.yml 머리말).

- [ ] **Step 2: 푸시와 PR**

```bash
gh auth switch --user kth9245 && cd /mnt/c/Users/TaeHyounKim/Documents/HACKERTON/finance2026/fsec-wt-autowake && git push -u origin feat/runpod-auto-wake && gh pr create --title "추론 팟이 죽어도 자료는 「재시도중」으로 기다리고, 팟은 스스로·상시 서버가 되살린다 (ADR-091·092)" --body-file - <<'BODY'
## 무엇

- **ADR-091** 전사·판독·이름 탐지 서버에 **못 닿은 것**은 `failed` 가 아니라 `processing` + `progress.retrying`. 어댑터 `TransientError` → 모듈 `detail.transient` → 흐름의 갈래 셋(맡기기 · 묻기 · 토큰화). 완료 통지는 2초 뒤 한 번 더. 서버 혼자 다시 맡기기 `POST /api/cron/evidence-resubmit`(48h · 20건 · 토큰화 없음). 화면 「전사 서버에 다시 연결하는 중」.
- **ADR-092** 팟 안 `watchdog.sh`(20초 · 조치 뒤 유예 180초) · OCI systemd 감시자 `finally-runpod-watch`(30초 · 세지 않음 · 없으면 새 팟 · 죽었으면 재시작 → 새 팟 · `vercel-env` 로 주소 교체 · Brevo 메일 · 잔액 경고) · 설치 꾸러미 · `runpod-pod.py` 함수화.

## 왜

배포본의 STT·OCR·NER 이 RunPod 팟 한 대를 보고, 팟이 죽으면 자료는 그 자리에서 실패하고 아무도 몰랐다. 심사 기간(9/11 23:59) 내내 자동이어야 한다.

## 확인

- 앱: typecheck · lint · vitest 전부 · route-contract · schema-names
- 감시자: `deploy/test_runpod_watch.py` · `--once` 로 지금 팟 `ok` 판정
- 문서: doc-integrity
- 배포 뒤: 지금 팟에 watchdog 넣음(Task 12) · OCI 설치(Task 18) · shadow 로 새 팟 경로 확인(Task 18)

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01LaeBtmCj3cYVMYB39Z4gba
BODY
```

- [ ] **Step 3: CI 를 기다린다**

Run: `gh pr checks --watch` (이 gh 에는 `--json` 이 없습니다 — 메모리). 전부 초록이면 다음.

---

### Task 18: 운영 — OCI 설치 · 새 팟 경로 shadow 시험

이 태스크는 저장소를 바꾸지 않습니다. **PR 이 머지되기 전에도** 브랜치로 할 수 있습니다(설치 스크립트가 `main` 을 pull 하므로 머지 전이면 `git -C /home/ubuntu/fsec-ai-challenge checkout feat/runpod-auto-wake`).

- [ ] **Step 1: 비밀값을 OCI 로 옮긴다** (값은 화면에 찍지 않습니다)

```bash
cd /mnt/c/Users/TaeHyounKim/Documents/HACKERTON/finance2026/fsec-wt-autowake && OCI="ubuntu@141.148.13.6" && K=~/.ssh/id_ed25519_finally && SSHO="-i $K -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR"
scp $SSHO ~/.ssh/id_ed25519_finally ~/.ssh/id_ed25519_finally.pub $OCI:/home/ubuntu/.ssh/
ssh $SSHO $OCI 'chmod 600 ~/.ssh/id_ed25519_finally; sudo mkdir -p /etc/finally; sudo touch /etc/finally/watch.env; sudo chown ubuntu:ubuntu /etc/finally/watch.env; chmod 600 /etc/finally/watch.env'
python3 - <<'PY' | ssh $SSHO $OCI 'cat > /etc/finally/watch.env'
from pathlib import Path
src = dict(l.split('=',1) for l in Path('src/.env.local').read_text().splitlines() if '=' in l and not l.startswith('#'))
want = ['RUNPOD_API_KEY','TRANSCRIBER_TOKEN','APP_ORIGIN','CRON_SECRET','MAILER_API_KEY','MAILER_FROM']
out = [f"{k}={src.get(k,'').strip().strip(chr(34)).strip(chr(39))}" for k in want]
out += ['POD_SSH_KEY=/home/ubuntu/.ssh/id_ed25519_finally','GITHUB_TOKEN=','GITHUB_REPO=Dojaegyum/fsec-ai-challenge','NOTIFY_TO=','STATE_DIR=/var/lib/finally']
print('\n'.join(out))
PY
```

그다음 **사용자가 준 값 둘**(`GITHUB_TOKEN` · `NOTIFY_TO`)을 `ssh $OCI 'nano /etc/finally/watch.env'` 로 채웁니다. 없으면 비워 둔 채 진행합니다 — 감시자는 주소 교체와 메일만 건너뜁니다.

- [ ] **Step 2: 설치**

```bash
ssh $SSHO $OCI 'bash -s' < deploy/runpod-watch-install.sh
ssh $SSHO $OCI 'sleep 40; journalctl -u finally-runpod-watch --no-pager -n 6'
```

Expected: `tick → ok` 와 잔액 줄. `/var/lib/finally/watch.json` 에 지금 팟 id.

- [ ] **Step 3: 새 팟 경로 shadow 시험 (약 $0.3 · 15분)**

감시자를 잠깐 멈추고 한 회를 shadow 로:

```bash
ssh $SSHO $OCI 'touch /var/lib/finally/watch.paused; set -a; . /etc/finally/watch.env; set +a; cd fsec-ai-challenge && python3 deploy/runpod-watch.py --once --shadow 2>&1 | tail -40; rm /var/lib/finally/watch.paused'
```

Expected: `finally-demo-shadow` 팟 생성 → 채움 → `ready` → terminate 로그. 끝난 뒤 `python3 deploy/runpod-pod.py list` 에 shadow 팟이 **없어야** 합니다(과금 확인). 시험 팟이 ready 였을 때 watchdog 도 함께 떠 있었는지는 provision 로그의 `watchdog pid` 줄로 확인합니다.

- [ ] **Step 4: 주소 교체 경로 확인 (`GITHUB_TOKEN` 이 있을 때만 · 지금 주소 그대로 재배포)**

```bash
ssh $SSHO $OCI 'set -a; . /etc/finally/watch.env; set +a; cd fsec-ai-challenge && python3 - <<PY
import importlib.util, pathlib
s = importlib.util.spec_from_file_location("w", pathlib.Path("deploy/runpod-watch.py")); w = importlib.util.module_from_spec(s); s.loader.exec_module(w)
print(w.switch_backend(w.pod.proxy_url(w.pod.find_pods()[0]["id"])))
print(w.call_resubmit())
PY'
```

Expected: `True`(vercel-env 성공 · 같은 값으로 재배포) 와 다시 맡기기 보고 dict.

---

### Task 19: 머지 · 배포 · 마무리

- [ ] **Step 1: 머지와 배포**

PR 을 머지합니다(`gh pr merge --squash --delete-branch` 는 이 저장소의 관행에 맞게 — 앞선 PR 들처럼 merge commit 이면 `--merge`). `deploy` 워크플로가 `main` 을 올리고 `smoke` 가 돕니다. `gh run list --workflow deploy --limit 1` 로 성공을 확인합니다.

- [ ] **Step 2: OCI 를 `main` 으로**

```bash
ssh $SSHO $OCI 'cd fsec-ai-challenge && git checkout -q main && git pull -q --ff-only && sudo systemctl restart finally-runpod-watch && sleep 35 && journalctl -u finally-runpod-watch --no-pager -n 3'
```

- [ ] **Step 3: 배포본에서 「재시도중」 확인 (파괴 없이)**

배포본에 새 사건을 만들고 합성 녹음(`assets/demo/09-01-mock-evidence/call.wav`)을 올려 평소처럼 「전사 완료」까지 가는지 봅니다(회귀). 「재시도중」 자체는 팟을 죽이지 않고는 배포본에서 재현할 수 없으므로 단위 시험(Task 7·8)과 shadow 시험이 근거입니다 — 이 사실을 최종 보고에 그대로 적습니다.

- [ ] **Step 4: worktree 정리와 메모리**

```bash
cd /mnt/c/Users/TaeHyounKim/Documents/HACKERTON/finance2026/fsec-ai-challenge && git worktree remove ../fsec-wt-autowake && git worktree prune
```

메모리에 남길 것: 감시자 위치와 멈추는 법(`watch.paused`), `GITHUB_TOKEN`·`NOTIFY_TO` 를 사용자가 채웠는지, 지금 팟에 watchdog 이 들어간 시각, ADR 번호 091·092.
