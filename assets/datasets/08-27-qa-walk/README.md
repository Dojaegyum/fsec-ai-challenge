# 08-27 · QA 걷기 도구

**「걸어 봤습니다」를 말로 주고받지 않으려고 남긴 것**입니다. 다음 사람이 같은
명령으로 같은 표를 다시 뽑을 수 있어야, **무엇이 안 걸린 채인지** 서로 압니다.

결과와 판단은 [`docs/plans/08-23-qa-readiness.md`](../../../docs/plans/08-23-qa-readiness.md)
의 「2026-08-27」 절에 있습니다. **여기 있는 것은 도구뿐이고, 값은 그때그때 다릅니다.**

## 어떻게 돌리나

```bash
cd src && npm run build && npx next start -p 3311     # ⚠️ dev 가 아니라 build 로
python assets/datasets/08-27-qa-walk/qa_matrix.py
```

| 파일 | 무엇 |
| --- | --- |
| `qa_matrix.py` | **아홉 유형**을 각각 끝까지 — 단계·연락처·기한을 한 표로 |
| `qa_chain.py` | **한 유형**을 처음부터 끝까지 — 어디서 끊기는지 보려는 것 |
| `qa_compare.py` | **로컬과 배포본**에 같은 걸음을 걸어 다른 칸을 찾음 |
| `ner_battery.py` | **이름 찾기를 실제 모델로** — 누출·과차단·프롬프트 주입 15문항 |

셋 다 표준 라이브러리만 씁니다. 주소를 인자로 주면 배포본에도 겁니다.

```bash
python assets/datasets/08-27-qa-walk/qa_chain.py https://fin-ally-khaki.vercel.app
```

## ⚠️ `next dev` 로 재지 마세요

Turbopack 개발 서버가 이 저장소에서 **라우트를 못 찾아 HTML 404 를 내는 일**이
있었습니다(같은 코드가 `next build` 에서는 멀쩡합니다). 그걸 제품 결함으로
읽으면 없는 버그를 쫓게 됩니다. **배포와 같은 빌드로 거세요.**

## ⚠️ 사건이 실제로 생깁니다

배포본에 걸면 **운영 DB 에 사건이 남습니다.** 지금은 실사용자가 없어 괜찮지만,
사람이 쓰기 시작하면 그때는 다른 방법이 필요합니다 —
보관은 마지막 활동일부터 180일입니다([ADR-016](../../../decisions/016-retention-and-datastore.md)).

## `ner_battery.py` 는 다른 것을 봅니다 — 앱이 아니라 **경계**

나머지 셋이 앱을 거는 동안 이것은 **이름 찾기 서비스**를 직접 겁니다. 앱과
같은 길(`POST /ner`)이라 여기서 새면 앱에서도 샙니다.

```bash
NER_URL=https://<팟ID>-8917.proxy.runpod.net NER_TOKEN=<공유 비밀> \
  python assets/datasets/08-27-qa-walk/ner_battery.py
```

⛔ **문장을 고칠 때 실제 값을 넣지 마세요** — 이 파일은 빌린 GPU 로 올라갑니다
([ADR-043](../../../decisions/043-gpu-hosting.md)). 세우는 절차는
[`deploy/runpod-bench.md`](../../../deploy/runpod-bench.md).

## 무엇을 못 보나

**챗·업로드·전사·볼트는 이 도구가 안 겁니다.** 모델과 파일이 필요해서
따로 봐야 합니다. 이 도구가 보는 것은 **사건·슬롯·플랜·부산물·기한·재방문**입니다.
(이름 찾기만 `ner_battery.py` 로 따로 겁니다 — 위.)
