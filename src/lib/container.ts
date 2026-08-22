/**
 * 모듈에 자원을 끼우는 자리 — **조립은 여기 한 곳에서만** 합니다.
 *
 * 근거: ADR-028 「모듈은 필요한 외부 자원을 직접 만들지 않고 인터페이스로 선언해 받는다」
 *
 * 라우트는 이 파일이 내놓은 것을 쓰기만 합니다. 라우트가 직접 `create…` 를
 * 부르면 자원이 라우트마다 따로 생기고, **무엇이 안 붙었는지 한눈에 볼 자리가
 * 사라집니다.**
 *
 * ## 아직 안 붙은 것을 어떻게 두나
 *
 * **빈 대역을 만들지 않습니다.** 부르면 즉시 터지는 것으로 둡니다
 * → [not-configured.ts](./not-configured.ts). 조용히 빈 배열을 돌려주면
 * 사건이 「플랜 0단계」로 생기고 며칠 뒤에야 누가 알아챕니다.
 *
 * **예외가 둘 있습니다.**
 *
 * | 무엇 | 왜 던지지 않나 |
 * | --- | --- |
 * | 문진 문구 | 던지면 사건 생성이 막혀 불변 규칙 5를 깹니다 → [questions.ts](./questions.ts) |
 * | 속도 제한 | 모든 요청이 지나는 길목이라 던지면 서비스 전체가 500 이 됩니다 → [rate-limit.ts](./rate-limit.ts) |
 *
 * 둘 다 **못 하는 일을 숨기지는 않습니다** — 설정 현황에 한 줄씩 나옵니다
 * → [config-report.ts](./config-report.ts).
 */

import 'server-only'

import { asAuditSink, asKbSource, asRetryJudge } from './adapters'
import { serverClock } from './clock'
import { readEnv, type Env } from './env'
import { linkTokenSource, ulidSource } from './ids'
import { unconfigured } from './not-configured'
import { createInferenceEngines } from './inference'
import { createQuestionSource } from './questions'
import {
  createAuditStore,
  createCaseStore,
  createKbStore,
  createSql,
} from './db'
import { createMediaReader } from './storage'
import {
  createMemoryRateCounter,
  createRateLimiter,
  type RateCounterStore,
  type RateLimiter,
} from './rate-limit'

import { createAuditLogger } from '@/modules/audit-logger'
import type { AuditStore } from '@/modules/audit-logger'
import { createCaseIntake } from '@/modules/case-intake'
import type { CaseStore, UploadSlotSource } from '@/modules/case-intake'
import { createCasePurger } from '@/modules/case-purger'
import type {
  CaseStore as PurgeCaseStore,
  ObjectStore,
  VaultStore,
} from '@/modules/case-purger'
import { createChatPublisher } from '@/modules/chat-publisher'
import { createChatReceiver } from '@/modules/chat-receiver'
import type { LlmClient } from '@/modules/chat-receiver'
import { createCitationChecker } from '@/modules/citation-checker'
import { createPiiTokenizer } from '@/modules/pii-tokenizer'
import type { NerModel } from '@/modules/pii-tokenizer'
import { createCompletionChecker } from '@/modules/completion-checker'
import type { ReceiptNumberFormat } from '@/modules/completion-checker'
import { createDateChecker } from '@/modules/date-checker'
import type { HolidayCalendar } from '@/modules/date-checker'
import { createKbFinder } from '@/modules/kb-finder'
import type { KbStore } from '@/modules/kb-finder'
import { createPlanner } from '@/modules/planner'
import { createPromptBuilder } from '@/modules/prompt-builder'
import { createReminderSender } from '@/modules/reminder-sender'
import type { Mailer, ReminderSource, SentLog } from '@/modules/reminder-sender'
import { createRetryChecker } from '@/modules/retry-checker'
import { createSlotChecker } from '@/modules/slot-checker'
import type { QuestionSource } from '@/modules/slot-checker'
import { createTranscriber } from '@/modules/transcriber'
import type { MediaReader, OcrEngine, SttEngine } from '@/modules/transcriber'

import type { CasePlanStore, KbVersionSource } from '@/flows/regenerate-plan'

/**
 * 밖에서 와야 하는 자원들.
 *
 * **이 목록이 곧 「무엇이 아직 없는가」입니다.** 하나씩 실제 구현으로
 * 바꿔 끼우면 그만큼 살아납니다.
 */
export interface Ports {
  /** 관계형 DB — 사건 상태 */
  readonly caseStore: CaseStore
  /** 관계형 DB — 매뉴얼 조회 */
  readonly kbStore: KbStore
  /** 관계형 DB — 감사 기록 */
  readonly auditStore: AuditStore
  /** 관계형 DB — 파기 대상 조회·삭제 */
  readonly purgeCaseStore: PurgeCaseStore
  /** 관계형 DB — 리마인더 거리 조회 */
  readonly reminderSource: ReminderSource
  /** 관계형 DB — 플랜을 만들 때 읽고 쓰는 자리 → flows/regenerate-plan.ts */
  readonly casePlan: CasePlanStore
  /** 관계형 DB — 지금 어느 KB 릴리스인가. ⬜ 정본에 방법이 없습니다 */
  readonly kbVersion: KbVersionSource
  /** 발송 이력. ⬜ 저장할 칸이 스키마에 없습니다 */
  readonly sentLog: SentLog
  /** 객체 저장소 — 업로드 자리 발급 */
  readonly uploads: UploadSlotSource
  /**
   * 객체 저장소 — **읽기용** 임시 주소 발급.
   *
   * `uploads` 와 같은 저장소인데 자리가 둘인 이유는 방향이 다르기 때문입니다 —
   * 쓰기는 브라우저가, 읽기는 추론 서비스가 씁니다. **둘 다 파일이 서버 함수를
   * 통과하지 않습니다** → 08-14-api.md §3.2 · ARCHITECTURE §2.
   */
  readonly mediaReader: MediaReader
  /** 객체 저장소 — 파기 */
  readonly objects: ObjectStore
  /** 볼트 — 파기. ⬜ 제품 미결 */
  readonly vault: VaultStore
  /** 공휴일 — 한국천문연구원 특일 정보 */
  readonly holidays: HolidayCalendar
  /**
   * 2차 개인정보 탐지 모델. ⬜ 미선정 → ARCHITECTURE §10.
   *
   * **없어도 경계는 섭니다** — 1차 정규식이 계좌·주민번호·카드·전화를 잡습니다.
   * 그래서 부르면 터지는 대역으로 두지 않고 `null` 입니다. 붙기 전에는 이름이
   * 안 걸리고, 그 사실이 설정 현황에 나옵니다.
   *
   * **완성된 토큰화기를 주입받지 않고 여기서 만듭니다** — 모듈이 있으므로
   * 조립부가 자원(이 모델)만 받아 조립하는 편이 ADR-028 의 모양입니다.
   */
  readonly ner: NerModel | null
  /**
   * 녹음을 글로 옮기는 도구. ⬜ 제품 미선정.
   *
   * **없어도 되는 자리로 두지 않았습니다.** 비면 음성 증거가 아무것도 안 됩니다 —
   * 그래서 부르면 즉시 터지는 대역을 끼웁니다.
   *
   * ⚠️ **이 자리는 개인정보 격리 경계 「이전」입니다** → ARCHITECTURE §6.
   * 무엇을 끼우느냐가 **원문이 조직 밖으로 나가는지를 가릅니다** → ADR-043.
   */
  readonly stt: SttEngine
  /** 이미지에서 글자를 읽는 도구. ⬜ 제품 미선정. `stt` 와 같은 경계에 있습니다 */
  readonly ocr: OcrEngine
  /**
   * 언어모델 — **챗이 쓰는 모양**입니다.
   *
   * ⬜ **층 1 두 모듈은 이 자리를 그대로 못 씁니다.** 모양이 다릅니다.
   *
   * | 쓰는 곳 | 받는 것 |
   * | --- | --- |
   * | `chat-receiver` | 파싱이 끝난 `ModelReply` — 모듈 밖이 형식을 풉니다 |
   * | `case-reader` · `slot-extractor` | **글자 그대로** (`{ text }`) — 모듈이 스스로 풉니다 |
   *
   * 자원은 하나(Grok)인데 요구하는 모양이 둘입니다. 셋 중 하나로 정해야 합니다 —
   * ① 이 포트를 글자 그대로로 바꾸고 챗 쪽에 어댑터를 두거나,
   * ② 포트를 둘로 나누거나, ③ 층 1 모듈이 `ModelReply` 를 받게 바꾸거나.
   *
   * **여기서 즉흥으로 정하지 않았습니다.** ①은 챗 응답 형식을 푸는 코드를
   * 어디에 둘지가 정해져야 하고(그 자리가 아직 없습니다), ③은 층 1 이
   * 챗 전용 형식에 묶입니다.
   */
  readonly llm: LlmClient
  /** 메일 발송 */
  readonly mailer: Mailer
  /** 접수번호 형식 */
  readonly receiptFormat: ReceiptNumberFormat
}

/**
 * 아직 아무것도 안 붙은 상태.
 *
 * 각 줄이 「무엇이 · 어느 환경변수 때문에」 안 붙었는지를 담고 있어,
 * 부르는 순간 그대로 말하며 멈춥니다.
 */
/**
 * 읽는 도구 둘을 만든다 — **주소가 있을 때만.**
 *
 * 앱은 그 서비스가 무엇인지 모릅니다. 이 컴퓨터에서 띄운 것이든 국내 GPU 서버든
 * **주소만 바뀝니다** → [inference.ts](./inference.ts) · `services/transcriber/`.
 *
 * 주소가 없으면 부르는 순간 터지는 대역을 끼웁니다. 조용히 빈 결과를 내면
 * 사건이 「전사 0줄」로 지나가고 며칠 뒤에야 누가 알아챕니다.
 */
function readingEngines(env: Env): Pick<Ports, 'stt' | 'ocr'> {
  const baseUrl = env.values.TRANSCRIBER_URL
  if (!baseUrl) {
    return {
      stt: unconfigured('SttEngine', ['TRANSCRIBER_URL']),
      ocr: unconfigured('OcrEngine', ['TRANSCRIBER_URL']),
    }
  }
  return createInferenceEngines({ baseUrl, token: env.values.TRANSCRIBER_TOKEN })
}

/**
 * 지금 쓰는 KB 릴리스 → ADR-045 · 09-data-model.md §11.2.
 *
 * **「가장 최근 적재분」을 쓰지 않습니다.** 적재기는 검수 중인 다음 버전을 미리
 * 올릴 수 있고, 최신 것을 무조건 고르면 **아직 사람이 안 본 절차가 피해자에게
 * 나갑니다** — 07-kb-operations.md 원칙 4 가 막으려던 일입니다.
 *
 * 비어 있으면 부를 때 던집니다. 근거 없는 안내보다 멈추는 편이 낫습니다.
 */
function pinnedKbVersion(env: Env): KbVersionSource {
  const pinned = env.values.KB_VERSION
  if (!pinned) return unconfigured('KbVersionSource', ['KB_VERSION'])
  return { current: async () => pinned }
}

export function unconfiguredPorts(env: Env): Ports {
  const db = ['DATABASE_URL'] as const
  const storage = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const

  // 접속 정보가 있으면 실제 저장소에 붙습니다 → db.ts.
  // **연결을 여기서 한 번만 만듭니다** — 포트마다 만들면 요청 하나가
  // 연결을 여럿 쥐고, 연결 모으는 곳이 먼저 막힙니다
  const sql = createSql(env)

  return {
    caseStore: sql ? createCaseStore(sql) : unconfigured('CaseStore', db),
    kbStore: sql ? createKbStore(sql) : unconfigured('KbStore', db),
    auditStore: sql ? createAuditStore(sql) : unconfigured('AuditStore', db),
    purgeCaseStore: unconfigured('PurgeCaseStore', db),
    reminderSource: unconfigured('ReminderSource', db),
    casePlan: unconfigured('CasePlanStore', db),
    // 배포 설정이 정합니다 → ADR-045. 비어 있으면 부를 때 그대로 말하며 멈춥니다
    kbVersion: pinnedKbVersion(env),
    // ⬜ 발송 이력을 남길 칸이 스키마에 없습니다 → reminder-sender/README.md
    sentLog: unconfigured('SentLog', ['(스키마에 칸 없음)']),
    uploads: unconfigured('UploadSlotSource', storage),
    // 접속 정보가 있으면 실제로 주소를 냅니다 → storage.ts.
    // 없으면 부르는 순간 터집니다 — 조용히 빈 주소를 내면 추론 서비스가
    // 엉뚱한 것을 내려받으려다 실패하고, 원인이 두 단계 뒤에서 드러납니다
    mediaReader: createMediaReader(env) ?? unconfigured('MediaReader', storage),
    objects: unconfigured('ObjectStore', storage),
    // ⬜ 볼트 제품 미결 → ADR-016 「남은 것」
    vault: unconfigured('VaultStore', ['KV_URL', 'VAULT_MASTER_KEY']),
    // ⬜ 정본의 환경변수 표에 공휴일 API 키가 없습니다
    holidays: unconfigured('HolidayCalendar', ['(정본에 키 이름 없음)']),
    // ⬜ 판별 모델 미선정 → ARCHITECTURE.md §10.
    // **부르면 터지는 대역으로 두지 않습니다** — 1차 정규식만으로 경계가 서고,
    // 여기서 던지면 붙어 있는 1차까지 못 씁니다
    ner: null,
    // 주소가 있으면 그 서비스를 부르고, 없으면 부르는 순간 터집니다.
    // **경계 이전이라 「어디를 부르나」가 곧 정책입니다** → ARCHITECTURE §6.
    // 우리가 돌리는 모델이면 원문이 안 나가고, 원격 API 면 나갑니다
    ...readingEngines(env),
    llm: unconfigured('LlmClient', ['XAI_API_KEY']),
    // ⬜ 발송 수단 미정 → ADR-021 「남은 것」
    mailer: unconfigured('Mailer', ['(발송 수단 미정)']),
    // ⬜ 접수번호 형식의 근거가 없습니다
    receiptFormat: unconfigured('ReceiptNumberFormat', ['(형식 근거 없음)']),
    ...{ env },
  } as Ports
}

/** 조립된 모듈들 */
export interface Container {
  readonly env: Env
  readonly ports: Ports
  /** 문진 문구를 내주는 자리. 설정 현황이 이것을 봅니다 */
  readonly questions: QuestionSource
  /** 속도 제한 → 08-14-api.md §1.3. 세는 곳이 어디인지도 함께 들고 있습니다 */
  readonly rateLimiter: RateLimiter
  /** 격리 경계. 이것을 거치지 않은 텍스트는 외부로 나갈 수 없습니다 */
  readonly piiTokenizer: ReturnType<typeof createPiiTokenizer>
  readonly caseIntake: ReturnType<typeof createCaseIntake>
  /** 전사·판독. **격리 경계 이전이라 결과가 원문입니다** — 저장·송출 전에 토큰화 필수 */
  readonly transcriber: ReturnType<typeof createTranscriber>
  readonly kbFinder: ReturnType<typeof createKbFinder>
  readonly planner: ReturnType<typeof createPlanner>
  readonly dateChecker: ReturnType<typeof createDateChecker>
  readonly slotChecker: ReturnType<typeof createSlotChecker>
  readonly completionChecker: ReturnType<typeof createCompletionChecker>
  readonly chatReceiver: ReturnType<typeof createChatReceiver>
  readonly chatPublisher: ReturnType<typeof createChatPublisher>
  readonly auditLogger: ReturnType<typeof createAuditLogger>
  readonly casePurger: ReturnType<typeof createCasePurger>
  readonly reminderSender: ReturnType<typeof createReminderSender>
}

/**
 * 조립한다.
 *
 * **여기서는 던지지 않습니다.** 자원이 하나도 안 붙어 있어도 조립은 성공해야
 * 합니다 — 하나 때문에 서버가 안 뜨면 붙어 있는 것도 못 씁니다.
 */
export function createContainer(
  env: Env = readEnv(),
  ports: Ports = unconfiguredPorts(env),
  /**
   * 속도 제한을 어디에 세나. ⬜ 저장 위치가 정본에 미정이라 기본은
   * 프로세스 메모리입니다 → [rate-limit.ts](./rate-limit.ts).
   * 공유 저장소가 정해지면 여기 하나만 갈아 끼웁니다.
   */
  rateCounter: RateCounterStore = createMemoryRateCounter(),
): Container {
  const clock = serverClock

  const dateChecker = createDateChecker({ holidays: ports.holidays, clock })
  const auditLogger = createAuditLogger({
    store: ports.auditStore,
    now: () => clock.now(),
    newId: () => ulidSource.next(),
  })
  const kbFinder = createKbFinder({ store: ports.kbStore })
  // 격리 경계. 2차 모델이 없어도 1차 정규식으로 섭니다
  const piiTokenizer = createPiiTokenizer(ports.ner ? { ner: ports.ner } : {})
  const retryChecker = createRetryChecker()
  const questions = createQuestionSource()

  return {
    env,
    ports,
    questions,
    rateLimiter: createRateLimiter({ counter: rateCounter, clock }),
    piiTokenizer,

    caseIntake: createCaseIntake({
      ids: ulidSource,
      // **`ids` 와 따로입니다.** ULID 는 앞 10자가 생성 시각이라 주소에 쓰면
      // 이웃 사건을 좁혀 찔러볼 수 있습니다 → ADR-039
      linkTokens: linkTokenSource,
      clock,
      // date-checker 의 addDays — 보관 기한은 법정 기한이 아닙니다
      dates: dateChecker,
      store: ports.caseStore,
      uploads: ports.uploads,
      purgeDays: env.casePurgeDays,
    }),

    // 읽는 도구는 밖에서 받습니다 — 제품이 미정이어도 모듈은 섭니다 (ADR-028).
    // ⬜ 말풍선 좌·우를 가르는 임계값은 정본에 없어 모듈 기본값을 씁니다
    transcriber: createTranscriber({
      media: ports.mediaReader,
      stt: ports.stt,
      ocr: ports.ocr,
    }),

    kbFinder,
    dateChecker,
    planner: createPlanner({ clock }),
    // 문구가 없어도 던지지 않습니다 → questions.ts
    slotChecker: createSlotChecker({ questions }),
    completionChecker: createCompletionChecker({
      receiptFormat: ports.receiptFormat,
    }),

    chatReceiver: createChatReceiver({
      tokenizer: piiTokenizer,
      // 표의 행을 프롬프트 항목으로 옮깁니다 → adapters.ts
      kb: asKbSource(kbFinder),
      prompts: createPromptBuilder(),
      llm: ports.llm,
      citations: createCitationChecker(),
      // 인자 넓이가 서로 반대라 좁혀 넘깁니다 → adapters.ts
      retry: asRetryJudge(retryChecker),
      clock,
    }),
    // 토큰화할 때 한 번, 나갈 때 한 번 — **같은 규칙으로** 봅니다.
    // 다르면 한쪽이 조용히 새는 쪽이 됩니다
    chatPublisher: createChatPublisher({ residualPii: piiTokenizer }),

    auditLogger,

    casePurger: createCasePurger({
      cases: ports.purgeCaseStore,
      objects: ports.objects,
      vault: ports.vault,
      // 돌려주는 것이 달라 감싸 넘깁니다 → adapters.ts
      audit: asAuditSink(auditLogger),
      clock,
    }),

    reminderSender: createReminderSender({
      source: ports.reminderSource,
      sentLog: ports.sentLog,
      mailer: ports.mailer,
      clock,
      dates: dateChecker,
    }),
  }
}
