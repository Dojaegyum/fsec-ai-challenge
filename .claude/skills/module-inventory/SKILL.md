---
name: module-inventory
description: "FinAlly의 모듈 이름·역할과 DB 테이블·컬럼을 정본에서 읽어 표로 보여준다. 모듈이 무엇무엇 있는지, 어떤 이름이 무슨 일을 하는지, 어느 층에서 도는지, 특정 테이블에 어떤 컬럼과 허용값이 있는지 확인할 때 쓴다. 트리거: '모듈 뭐 있지', '모듈 목록', '인벤토리', '이 모듈 뭐 하는 거야', '층 2에 뭐 있어', '테이블 목록', '스키마 보여줘', 'case 테이블 컬럼', '이 컬럼 뭐야', '옛 이름 남았나', '모듈 이름 점검'."
---

# 모듈·스키마 인벤토리

**목록을 이 파일에 적지 않습니다.** 정본을 읽어 그때그때 렌더링합니다 —
복제하면 정본이 둘이 되고, 둘은 반드시 어긋납니다.

| 무엇 | 정본 |
| --- | --- |
| 모듈 이름·역할·층 | `spec/common/08-16-module-names.md` (근거 [ADR-014](../../../decisions/014-module-names.md)) |
| 테이블·컬럼·타입·허용값 | `spec/backend/08-16-data-model.md` |
| 모듈이 **어떻게 이어지는가** | `ARCHITECTURE.md` §4 (층별 흐름도) |

## 쓰는 법

저장소 루트에서 실행합니다. 표준 라이브러리만 쓰므로 설치가 필요 없습니다.

```bash
python .claude/skills/module-inventory/scripts/inventory.py            # 모듈 + 테이블 목록
python .claude/skills/module-inventory/scripts/inventory.py --modules  # 모듈만
python .claude/skills/module-inventory/scripts/inventory.py --layer 2  # 층 2만
python .claude/skills/module-inventory/scripts/inventory.py --db       # 테이블 목록
python .claude/skills/module-inventory/scripts/inventory.py --table case      # 컬럼 상세
python .claude/skills/module-inventory/scripts/inventory.py --find slot       # 모듈·컬럼 검색
python .claude/skills/module-inventory/scripts/inventory.py --names           # 이름만
python .claude/skills/module-inventory/scripts/inventory.py --check           # 정합성 점검
```

`--table`은 컬럼·타입·제약·정의에 더해 **`CHECK ... IN (...)`의 허용값**까지 폅니다.
`track`이 `victim | frozen_account` 둘뿐이라는 것이 표에서 바로 보입니다.

## 답할 때

1. **스크립트를 돌려 그 출력으로 답합니다.** 기억으로 목록을 재구성하지 마세요 — 정본이 자주 바뀝니다.
2. 사용자가 이름 하나를 물으면 `--find`로 좁혀 **층과 함께** 답합니다.
   층이 곧 "언제 도는가"라, 같은 `slot-` 접두라도 `slot-extractor`(층 1·LLM)와
   `slot-checker`(층 3·규칙)는 완전히 다른 것입니다.
3. **정본에 없는 이름을 지어내지 마세요.** 없으면 없다고 하고,
   새 이름이 필요하면 `spec/common/08-16-module-names.md`에 먼저 추가하는 것이 규약입니다
   (ADR-014도 함께 갱신).

## `--check`가 보는 것

CI가 아니라 **손으로 돌려보는 점검**입니다. 차단하지 않습니다.

- 쓰지 않기로 한 옛 표기가 문서에 남아 있는지 — `Ingest 서비스` · `2차 PII 스크러버` ·
  `분석 오케스트레이터` · `pii-scrubber` · `kb-retriever`
- 정본의 모듈이 `ARCHITECTURE.md` 연결구조에 **다 그려져 있는지** (이름만 있고 이어지는 곳이 없는 상태를 잡습니다)
- DDL을 파싱할 수 있는지 (형식이 바뀌면 여기서 먼저 드러납니다)

> 문서 링크·ID·목차 등록·ADR 불변성은 이 스킬이 아니라 **CI가** 봅니다 →
> `.github/scripts/doc-integrity.py` ([ADR-017](../../../decisions/017-doc-integrity-ci.md)).
> 역할이 다릅니다 — 저쪽은 머지를 막고, 이쪽은 물어보면 답합니다.

## 정본 형식이 바뀌면

스크립트는 두 가지 형태에 기대고 있습니다. 정본을 고칠 때 이 형태를 깨면 파싱이 조용히 비어 나오므로,
`--check`로 확인하세요.

- 모듈: `## 층 N · 제목` 아래의 표. 첫 칸이 백틱으로 감싼 이름
- 스키마: ` ```sql ` 블록 안의 `CREATE TABLE 이름 (` … `);`, 컬럼 설명은 `--` 주석
