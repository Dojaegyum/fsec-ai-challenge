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
 * **예외가 하나 있습니다 — 문진 문구.** 그 자리는 던지면 사건 생성이 막혀
 * 불변 규칙 5를 깹니다. 모듈이 정의한 「물을 수 없음」 경로를 씁니다
 * → [questions.ts](./questions.ts).
 */

import 'server-only'

import { asAuditSink, asKbSource, asRetryJudge } from './adapters'
import { serverClock } from './clock'
import { readEnv, type Env } from './env'
import { ulidSource } from './ids'
import { unconfigured } from './not-configured'
import { createQuestionSource } from './questions'

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
import type { ResidualPiiScanner } from '@/modules/chat-publisher'
import { createChatReceiver } from '@/modules/chat-receiver'
import type { LlmClient, PiiTokenizer } from '@/modules/chat-receiver'
import { createCitationChecker } from '@/modules/citation-checker'
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
  /** 개인정보 토큰화 — **격리 경계** */
  readonly tokenizer: PiiTokenizer
  /** 송출 직전 잔여 개인정보 검사 */
  readonly residualPii: ResidualPiiScanner
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
  /** 언어모델 */
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
export function unconfiguredPorts(env: Env): Ports {
  const db = ['DATABASE_URL'] as const
  const storage = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const

  return {
    caseStore: unconfigured('CaseStore', db),
    kbStore: unconfigured('KbStore', db),
    auditStore: unconfigured('AuditStore', db),
    purgeCaseStore: unconfigured('PurgeCaseStore', db),
    reminderSource: unconfigured('ReminderSource', db),
    // ⬜ 발송 이력을 남길 칸이 스키마에 없습니다 → reminder-sender/README.md
    sentLog: unconfigured('SentLog', ['(스키마에 칸 없음)']),
    uploads: unconfigured('UploadSlotSource', storage),
    mediaReader: unconfigured('MediaReader', storage),
    objects: unconfigured('ObjectStore', storage),
    // ⬜ 볼트 제품 미결 → ADR-016 「남은 것」
    vault: unconfigured('VaultStore', ['KV_URL', 'VAULT_MASTER_KEY']),
    // ⬜ 정본의 환경변수 표에 공휴일 API 키가 없습니다
    holidays: unconfigured('HolidayCalendar', ['(정본에 키 이름 없음)']),
    // ⬜ 판별 모델 미선정 → ARCHITECTURE.md §10
    tokenizer: unconfigured('PiiTokenizer', ['(모델 미선정)']),
    residualPii: unconfigured('ResidualPiiScanner', ['(모델 미선정)']),
    // ⬜ 제품 미선정 → ARCHITECTURE.md §6. **경계 이전이라 선택이 곧 정책입니다** —
    // 우리가 돌리는 모델이면 원문이 안 나가고, 원격 API 면 나갑니다 → ADR-043
    stt: unconfigured('SttEngine', ['(제품 미선정 — ARCHITECTURE §6)']),
    ocr: unconfigured('OcrEngine', ['(제품 미선정 — ARCHITECTURE §6)']),
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
): Container {
  const clock = serverClock

  const dateChecker = createDateChecker({ holidays: ports.holidays, clock })
  const auditLogger = createAuditLogger({
    store: ports.auditStore,
    now: () => clock.now(),
    newId: () => ulidSource.next(),
  })
  const kbFinder = createKbFinder({ store: ports.kbStore })
  const retryChecker = createRetryChecker()
  const questions = createQuestionSource()

  return {
    env,
    ports,
    questions,

    caseIntake: createCaseIntake({
      ids: ulidSource,
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
      tokenizer: ports.tokenizer,
      // 표의 행을 프롬프트 항목으로 옮깁니다 → adapters.ts
      kb: asKbSource(kbFinder),
      prompts: createPromptBuilder(),
      llm: ports.llm,
      citations: createCitationChecker(),
      // 인자 넓이가 서로 반대라 좁혀 넘깁니다 → adapters.ts
      retry: asRetryJudge(retryChecker),
      clock,
    }),
    chatPublisher: createChatPublisher({ residualPii: ports.residualPii }),

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
