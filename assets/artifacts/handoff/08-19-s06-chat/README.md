# S-06 챗 국면 + WS 패널 — 핸드오프

| | |
| --- | --- |
| 대상 화면 | **`S-06` 사건 · 챗 국면 `/c/{token}`** → [화면 설계](../../../../spec/frontend/08-14-screens.md) |
| 넘겨받은 날 | 2026-08-19 |
| 캔버스 | [FSEC 렌더 페이지 설계](https://claude.ai/design/p/4a2237c5-4584-4fac-aeaa-a256b3404f0b) — 화면 전체가 한 캔버스에 있습니다 |
| 아트보드 | 「Chat S-06 Options」 **1c** · 「WS Panels」 1a~1h · 「Chat Components Spec」 1a~1d |
| 상태 | **일부 적용** — 아래 「이번에 안 한 것」 |

## 받은 그대로입니다

`.dc.html` 셋은 **디자인 레퍼런스**입니다(브라우저로 열면 렌더). 프로덕션 코드가 아니라
의도한 모양의 원본이고, 저장소 환경으로 **재구현**했습니다 — HTML 을 옮기지 않았습니다.

| 파일 | 무엇 |
| --- | --- |
| [`PR.md`](PR.md) | 시안이 밝힌 레이아웃·상태·모션·토큰 매핑 (원문 README) |
| `Chat S-06 Options.dc.html` | 화면 시안. **1c 채택** (1a·1b 탈락) |
| `WS Panels.dc.html` | 공통 골격 1a + 유형별 1b~1h |
| `Chat Components Spec.dc.html` | 상태·모션 4벌 |

`support.js`(레퍼런스 렌더용)와 `brand/symbol-mark.png`(이미 `src/public/brand/` 에 있음)는
담지 않았습니다.

## 어디로 갔나

| 무엇 | 어디 |
| --- | --- |
| S-06 화면 | `src/app/c/[token]/page.tsx` (새 라우트) |
| **WS 패널 일곱** | **`src/modules/work-handler/panels.tsx`** |
| `row-flash` keyframe | `src/app/globals.css` `@layer base` |

**패널이 모듈로 간 이유**는 [컴포넌트 규칙](../../../../spec/frontend/design-system/08-16-components.md)이
`WS-*` 7종을 `work-handler` 소관으로 지정해 뒀고, 그 모듈의 `index.ts` 가
**「렌더는 화면이 설 때 같은 폴더에 붙습니다」**라고 자리를 비워 뒀기 때문입니다.
모듈 안에서도 **판정(`panel.ts`·`signal.ts`)과 렌더(`panels.tsx`)를 섞지 않았습니다.**

## 계약과 어긋난 것 — 사람이 정했습니다

핸드오프가 **「WS 패널이 S-06 챗 국면에 붙는 것은 제품 결정 확정」**을 넘겨 왔고,
`spec/frontend/` 안에서 두 문서가 서로 다른 그림을 들고 있던 것이 이번에 정리됐습니다.

**→ [ADR-033](../../../../decisions/033-ws-panel-placement.md).**
`S-09` 단계 상세 화면과 `/c/{token}/step/{id}` 주소를 **폐기**했습니다. 번호는 재사용하지 않습니다.

## 수용 검사 결과

| 볼 것 | 결과 |
| --- | --- |
| 도메인 토큰만 · 빨강 없음 | 통과 — `--panel-top`·`--panel-bottom` 은 이 시안을 위해 먼저 만들어 뒀습니다 |
| 실제 텍스트 **12.5px 미만 없음** | 통과 ([ADR-032](../../../../decisions/032-text-floor.md) 로 하한이 12.5px) |
| 장식에 뜻 없음 · `aria-hidden` | 통과 — 맥동 점·라디오 마커·진행 막대 |
| `prefers-reduced-motion` 이 전부 멈춤 | 통과 — `row-flash` 도 `@layer base` |
| 색만으로 구분하지 않음 | 통과 — 사건 파일의 「지금 여쭤보는 중」·「모름이어도 진행」이 글자로 |
| PII — 복원은 브라우저에서만 | 통과 — 원문은 `WS-download` 패널에서만 |
| 문구 — 「받을 수 있다」 없음 | 통과 |
| 화면별 금지 (S-06) | 통과 — **스트리밍 없음.** 대기 구간을 문장으로 채웠습니다 |
| `typecheck` · `lint` · `build` · `test` | 통과 |

### 시안에서 올린 것

**11.5px 눈썹·12px 칩을 전부 12.5px 로** 올렸습니다. 하한이 12.5px 이라
그 아래는 남길 수 없습니다 — 특히 **PII 토큰 칩**은 「파란 토큰이 신뢰 장치」라
제일 작은 글자로 두면 안 됩니다.

## 이번에 안 한 것

- **WS 패널은 `WS-call` 하나만 화면에 붙였습니다.** 나머지 여섯은 모듈에 서 있지만
  화면이 아직 안 부릅니다 — 어느 단계를 열지는 서버 `body.action` 이 정하는데
  플랜 API 가 아직 없습니다.
- **챗 컴포넌트 상태 3벌 중 `PendingBubble` 만** 구현했습니다.
  보내는 중/실패/인터럽트와 `EvidenceCard` 는 다음 차례입니다 —
  `EvidenceCard` 는 `S-08` 증거함과 같은 어휘를 쓰므로 그 화면과 함께 하는 편이 낫습니다.
- **`/start` → `/c/{token}` 라우팅**은 아직입니다. 링크 발급 화면의 버튼이 TODO 로 남아 있습니다.

## 후속 — 코드 안 `TODO` 주석

- `POST …/messages` §3.9 · `GET …/slots` §3.4 · `GET …/plan` §3.6 연결
- `pendingStatus` 를 `poll-checker` 응답 그대로 — **화면이 추측·계산하지 않습니다**
- `CASE_TOKEN` 을 실제 경로 파라미터로
- `WS-download` 초안 엔드포인트는 **spec 에도 아직 없습니다**(`doc-builder` 가 P1)
