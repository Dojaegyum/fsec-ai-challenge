# src — FinAlly 구현

Next.js(App Router) + TypeScript + Tailwind 스캐폴딩만 올라간 상태입니다.
**도메인 코드는 아직 없습니다** — 백엔드 모듈 경계를 정하는 중입니다.

## 시작하기 전에

1. [`../CLAUDE.md`](../CLAUDE.md) — 작업 규약과 **절대 어기면 안 되는 8가지**
2. [`../spec/`](../spec/) — 구현 계약. **개정 대기 중**이니 [`../spec/README.md`](../spec/README.md)의 「개정해야 할 것」을 먼저 보세요
3. [`../spec/08-api.md`](../spec/08-api.md) — 비어 있음. 도메인 구현의 첫 관문

## 개발

```bash
npm run dev     # 개발 서버 (http://localhost:3000)
npm run build   # 프로덕션 빌드
npm run lint    # ESLint
```

## 스택

| 항목 | 선택 | 근거 |
| --- | --- | --- |
| 프레임워크 | Next.js (App Router) | 기획서 §9 |
| 언어 | TypeScript | 기본값. spec의 계약을 타입으로 강제할 수 있음 |
| 스타일 | Tailwind CSS | 기본값. 3-패널 레이아웃 작업에 유리 |
| 번들러 | Turbopack | create-next-app 기본값 |
| 배포 | Vercel (예정) | 기획서 §9 — **배포 URL이 제출 요건** |

TypeScript·Tailwind·Turbopack은 스캐폴딩 시점의 기본 선택입니다. 되돌리기 쉬운 단계이니
다른 조합이 필요하면 지금 바꾸세요.

## AGENTS.md 주의

`AGENTS.md`와 `CLAUDE.md`는 **create-next-app이 생성한 것**이고, `next dev`가 실행될 때
`AGENTS.md`의 블록을 다시 씁니다. 지워도 되살아나므로 커밋된 채로 두는 편이 트리가 깨끗합니다.

내용은 "이 버전의 Next.js는 학습 데이터와 다를 수 있으니 `node_modules/next/dist/docs/`를 읽으라"는
경고입니다. 우리 프로젝트 규약은 그것과 별개로 [`../CLAUDE.md`](../CLAUDE.md)에 있습니다.

## TODO

- TODO(주제 확정 후): 디렉토리 구조 설계 — 정해지면 여기 문서화
- TODO(미정): 환경변수·시크릿 관리 방식
- TODO(미정): Vercel 배포 연결
