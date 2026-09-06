"use client";

/**
 * 이 탭의 세션 식별자 — **속도 제한이 세는 단위**입니다.
 *
 * 계약: spec/common/08-14-api.md §1(`X-Session-Id`) · §1.3(그 외 조회 = 세션당 분당 300회)
 * 근거: ADR-085(세는 곳이 공유 저장소가 됐습니다)
 *
 * ## 왜 필요한가 — 안 보내면 한 IP 뒤의 모두가 한 통에 들어갑니다
 *
 * 서버는 이 헤더가 없으면 IP 로 셉니다(`lib/request.ts` 의 `subjectFor`). 카운터가
 * 인스턴스별 메모리이던 동안에는 그 합산이 실제로 안 걸렸는데, ADR-085 로 공유
 * 저장소에 세기 시작하면서 **진짜로 걸립니다.**
 *
 * 자료 판독 중 셸은 한 바퀴에 넷씩 1.5초 간격으로 묻습니다 — 분당 160회쯤입니다
 * (`load.ts` 의 `READS_PER_ROUND`). 같은 사무실·통신사 NAT 뒤에 사용자가 둘이면
 * 300회를 넘겨 **사건 화면이 「불러오지 못했습니다」로 떨어집니다.** §1.3 의
 * *"제한이 정상 사용을 막으면 안 됩니다"* 를 정면으로 어기는 자리입니다.
 *
 * ## 탭마다 하나, 이 탭이 사는 동안만
 *
 * `sessionStorage` 라 **탭을 닫으면 사라지고 다른 탭과 안 섞입니다.** 세는 단위가
 * 「지금 화면을 보고 있는 사람 하나」에 가장 가깝습니다. `localStorage` 로 두면
 * 여러 탭이 한 통을 나눠 써 폴링이 서로를 밀어냅니다.
 *
 * ⚠️ **신분이 아닙니다.** 이 값으로 사건을 열 수 없고(그건 링크 토큰입니다 — ADR-039),
 * 서버도 「우리 클라이언트가 보낸 것 같은가」까지만 봅니다. 그래서 열거 방어(404)와
 * 사건 생성은 이 값이 있어도 **IP 로 셉니다** — 클라이언트가 고를 수 있는 값으로
 * 그 둘의 한도를 비켜 갈 수 있으면 안 됩니다(§1.3).
 *
 * ⚠️ **개인정보가 아닙니다.** 난수 하나이고 사람이나 사건에 이어지지 않습니다.
 */

/** `sessionStorage` 의 키. 슬러그는 `fin-ally` 입니다(CLAUDE.md 「이름 표기」) */
const STORAGE_KEY = "fin-ally:session-id";

/**
 * 이 탭에서 이미 만든 값.
 *
 * 보관소를 못 쓰는 브라우저(사이트 데이터 차단)에서도 **이 화면이 사는 동안은**
 * 같은 값을 씁니다 — 요청마다 새 값을 내면 세는 단위가 요청이 되어 제한이 통째로
 * 뜻을 잃습니다.
 */
let cached: string | null = null;

/** 보관소는 **던질 수 있습니다** — 사이트 데이터를 막아 둔 브라우저 (`history.ts` 의 IndexedDB 와 같은 자리) */
function readStored(): string | null {
  try {
    return globalThis.sessionStorage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeStored(value: string): void {
  try {
    globalThis.sessionStorage?.setItem(STORAGE_KEY, value);
  } catch {
    /* 못 적어도 위 `cached` 로 이 화면이 사는 동안은 같은 값입니다 */
  }
}

/**
 * 새 값 하나.
 *
 * **못 만들면 `null` 입니다** — 서버 렌더(`sessionStorage` 도 `crypto` 도 없는 자리)와
 * `randomUUID` 가 없는 오래된 브라우저입니다. 그때는 헤더를 안 붙이고 서버가 IP 로
 * 셉니다 — 지금까지의 동작 그대로라 새로 깨지는 것이 없습니다.
 */
function create(): string | null {
  return typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : null;
}

/** 이 탭의 값. 없으면 만들어 둡니다. 만들 수 없는 자리에서는 `null` */
export function sessionId(): string | null {
  if (cached !== null) return cached;

  const kept = readStored();
  if (kept !== null) {
    cached = kept;
    return cached;
  }

  const made = create();
  if (made === null) return null;
  cached = made;
  writeStored(made);
  return cached;
}

/**
 * `/api/cases/*` 를 부르는 자리가 쓰는 헤더 한 벌.
 *
 * **주는 헤더를 지우지 않고 얹기만 합니다.** 부르는 쪽이 `accept`·`content-type` 을
 * 그대로 적을 수 있어야, 이 함수를 끼우는 것이 한 줄로 끝납니다.
 *
 * ⚠️ **우리 API 에만 붙입니다.** 객체 저장소로 곧장 올리는 `PUT`(§3.2)에는 안 붙습니다 —
 * 서명된 주소라 계약에 없는 헤더를 얹을 이유가 없습니다.
 */
export function apiHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const id = sessionId();
  return id === null ? { ...extra } : { ...extra, "X-Session-Id": id };
}
