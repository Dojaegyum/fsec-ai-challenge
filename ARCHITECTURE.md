# 아키텍처 — FinAlly가 어떻게 구성되는가

> **상태: 뼈대만.** 백엔드 정의(@kth) 전에 자리만 잡아둔 템플릿입니다.
> 각 절의 `TODO(kth)`를 채우면 이 문서가 **전체 구조의 최상위 정본**이 됩니다.

## 이 문서의 자리

| 문서 | 답하는 질문 |
| --- | --- |
| **`ARCHITECTURE.md`** (여기) | **무엇이 어디서 어떻게 도는가** — 기술 선택·모듈 배치·저장소·배포 |
| [`spec/`](spec/) | 제품이 **무엇을 만족해야 하는가** (계약) |
| [`rfc/`](rfc/) | 파일을 **어디에 두는가** (작업 규약) |
| [`decisions/`](decisions/) | **왜 그렇게 정했나** (이력) |

**spec에 있는 것을 여기 다시 적지 마세요.** 계약은 spec이 정본이고, 여기는 그 계약을 **무엇으로 구현하는가**입니다.
어긋나면 spec이 이깁니다. 구조를 바꾸는 결정을 내렸다면 `decisions/`에 ADR을 남기고 여기를 고칩니다.

**먼저 읽을 것** — [모듈 경계](spec/common/08-16-module-boundaries.md)(책임·금지) ·
[도메인 모델](spec/common/08-16-domain-model.md)(엔티티·상태·저장 경계) ·
[PII 격리 경계](spec/common/08-14-pii-boundary.md)(협상 대상 아님).

---

## 1. 한눈에

전체 그림. 어떤 실행 단위가 몇 개 있고 무엇이 무엇을 부르는지.

```
TODO(kth): 다이어그램 또는 텍스트 트리
```

## 2. 기술 스택

| 영역 | 선택 | 정본 |
| --- | --- | --- |
| 프론트 | Next.js (App Router) · React · Tailwind v4 · shadcn/ui | `src/package.json` |
| 디자인 토큰 | — | `src/app/globals.css` |
| 백엔드 런타임 | TODO(kth) | |
| DB | TODO(kth) | |
| 파일 저장 | TODO(kth) | |
| 작업 큐·스케줄러 | TODO(kth) — 필요한지부터 | |

기획서 §9가 정한 영역별 의도는 [용어와 전제 §기술 스택](spec/common/08-14-glossary.md)에 있습니다.
**백엔드·DB는 거기에도 비어 있습니다** — 여기서 처음 정합니다.

## 3. 데이터 저장소

무엇을 어디에 담는가. 스키마의 **입력**은 [도메인 모델](spec/common/08-16-domain-model.md)입니다.

- DDL 위치: TODO(kth)
- 마이그레이션 방식: TODO(kth)
- 보존·파기 정책: **선행 결정 대기** → [핸드오프 ①](docs/plans/08-16-backend-handoff.md)
- 원본 파일(녹음·이미지)의 저장 위치와 파기 강제: TODO(kth)

> **DDL을 쓰기 전에** [저장 경계 표](spec/common/08-16-domain-model.md)를 확인하세요.
> 복원 매핑·원문 PII를 담는 컬럼은 어떤 이유로도 만들지 않습니다.

## 4. 모듈

책임과 금지는 [모듈 경계](spec/common/08-16-module-boundaries.md)가 정본입니다.
여기에는 **그 책임을 실제로 어디에 배치하는가**를 적습니다.

- 모듈 목록과 물리 배치(같은 프로세스인가 분리인가): TODO(kth)
- 의존 방향과 금지된 역참조: TODO(kth)
- 코드상 위치(`src/` 하위 구조): TODO(kth)

## 5. 데이터 흐름

- 업로드 → 전사 → 스크러버 → 분석 → 플랜의 실제 호출 경로: TODO(kth)
- 오래 걸리는 작업(STT·OCR·플랜 생성)의 처리 방식 — 동기·큐·스트리밍: TODO(kth)
- 진행 상태를 화면에 전달하는 방식: TODO(kth) → [API 계약](spec/common/08-14-api.md)과 함께

## 6. 외부 의존

| 무엇 | 쓰임 | 선택 |
| --- | --- | --- |
| LLM API | 수법 판별·절차 선택·플랜 문장·챗 | TODO(kth) |
| STT | 녹음 전사(화자 분리) | TODO(kth) |
| OCR | 이미지 → 텍스트 | TODO(kth) |
| NER | 2차 PII 스크러빙 | TODO(kth) |
| 법령·공지 수집 | KB 운영 파이프라인 (P2) | TODO(kth) |

> **외부로 나가는 호출은 전부 PII 경계를 지납니다.** STT·OCR은 스크러버 *이전* 단계라
> 외부 API를 쓰면 원문이 나갑니다 — 선택 전에 [경계 정의](spec/common/08-14-pii-boundary.md)를 확인하세요.

## 7. 환경과 시크릿

- 환경 변수 목록과 `.env.example`: TODO(kth)
- 시크릿 보관 위치: TODO(kth)
- 타임존 — **`Asia/Seoul` 고정** → [기한 계산 규칙](spec/common/08-16-deadline-rules.md)

## 8. 배포

- 배포 대상: 프론트는 Vercel(대회 배포 URL 요건). 백엔드는 TODO(kth)
- 환경 분리(로컬·데모): TODO(kth)
- 심사 데모용 시드 데이터: TODO(kth)

## 9. 관측

- 애플리케이션 로그: TODO(kth)
- **감사 로그** — 모든 LLM 호출을 토큰화 텍스트 기준으로 기록. 저장 위치·보존기간: TODO(kth)

## 10. 아직 안 정해진 것

DDL·모듈 정의보다 **먼저** 답이 필요한 넷은 별도 문서에 있습니다 →
[백엔드 선행 결정 핸드오프](docs/plans/08-16-backend-handoff.md).

여기서 새로 생긴 미결은 위 각 절에 `TODO(kth)`로 남기고, 결정되면 그 자리를 채우면서
근거를 `decisions/`에 ADR로 남깁니다.
