@AGENTS.md

## 이 저장소의 규약

위 `AGENTS.md`는 create-next-app이 생성한 Next.js 안내입니다(`next dev`가 다시 씀).
프로젝트 규약은 별도이며, **상위 [`../CLAUDE.md`](../CLAUDE.md)가 정본**입니다.

코드를 쓰기 전에 반드시:

- [`../CLAUDE.md`](../CLAUDE.md) — 불변 규칙 6가지 (PII 경계, KB 인용 강제 등)
- [`../spec/`](../spec/) — 구현 계약

프로젝트는 **FinAlly**입니다 — 슬러그·패키지는 `fin-ally`, 코드 식별자는 `finAlly`/`FinAlly`.
**`finally`는 JS·TS 예약어이므로 식별자나 패키지명으로 쓰지 마세요.**

`spec/`은 아직 개정 대기 중입니다 — 포지셔닝이 30분 긴급 대응에서 **사건 관리**로 옮겨졌고
제도 변경("서면 신청"은 낡은 표현 등)이 일부만 반영돼 있습니다. [`../spec/README.md`](../spec/README.md)의
「개정해야 할 것」을 먼저 확인하세요.
