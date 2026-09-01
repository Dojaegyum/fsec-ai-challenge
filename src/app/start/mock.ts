"use client";

/**
 * 시연용 Mock 자료 — **손으로 파일을 고르지 않고 시작하는 자리.**
 *
 * 계약: spec/common/08-14-api.md §3.2 (받는 `kind` 셋) · spec/frontend/08-14-screens.md §S-05
 * 근거: ADR-043 「합성 데이터만 올립니다」
 * 원본: assets/demo/09-01-mock-evidence/ (대본 · 생성기 · 왜 합성인가)
 *
 * ## 여기서 하는 일은 **파일을 만들어 주는 것뿐**입니다
 *
 * 만든 `File` 은 사람이 고른 파일과 **똑같은 문**을 지납니다 —
 * `page.tsx` 의 `pick` 이 종류를 보고(`kindOf`) 이름을 정리하고(`screenName`)
 * 목록에 넣습니다. **그 뒤로는 시연과 실제가 한 경로**입니다: 사건이 만들어지고,
 * 실제로 올라가고, 실제로 전사되고, 실제로 토큰화됩니다.
 *
 * 우회로를 만들지 않는 것이 중요합니다. 시연만 도는 길을 따로 내면
 * **시연에서 되던 것이 실제에서 안 되는** 자리가 생기고, 그건 이 저장소가
 * 이미 겪은 종류의 결함입니다(`?view=` 가 가리고 있던 문진 게이트).
 *
 * ## 전부 합성입니다
 *
 * 실제 통화 음성인 「그놈 목소리」는 [research/07](../../../../docs/research/07-학습데이터-조사.md)
 * 의 D-02(공공누리 유형)·D-03(내려받기 가능 여부)이 미확인이라 쓰지 않습니다.
 * 올린 녹음·이미지는 **가려지기 전 원본 그대로** 전사 서버를 지나므로
 * (`flows/read-evidence.ts` 가 전사 **뒤에** 가립니다), 합성이 아니면 안 됩니다.
 */

import type { LoadFail } from "@/app/c/[token]/load";

/**
 * 어느 슬롯에 무엇이 들어가나 — 순서가 `page.tsx` 의 `자료종류` 와 맞습니다.
 *
 * **종류(`type`)를 우리가 붙입니다.** 서버가 내려준 `content-type` 에 기대면
 * 배포마다 달라지고, `kindOf` 가 `null` 을 내면 그 파일만 조용히 빠집니다.
 */
export const MOCK_EVIDENCE = [
  {
    slot: 0,
    url: "/demo/call.wav",
    name: "통화녹음.wav",
    type: "audio/wav",
  },
  {
    slot: 1,
    url: "/demo/messages.png",
    name: "문자캡처.png",
    type: "image/png",
  },
  {
    slot: 2,
    url: "/demo/transfer.png",
    name: "이체내역.png",
    type: "image/png",
  },
] as const;

export interface MockFile {
  readonly slot: number;
  readonly file: File;
}

export type MockLoad =
  | { readonly ok: true; readonly files: readonly MockFile[] }
  | { readonly ok: false; readonly fail: LoadFail };

const CANNOT: LoadFail = {
  poll: false,
  reason: "error",
  retryable: true,
  message: "예시 자료를 불러오지 못했습니다. 잠시 뒤 다시 눌러 주세요.",
};

/**
 * 셋을 받아 `File` 로 내놓습니다.
 *
 * **하나라도 못 받으면 통째로 실패입니다.** 반쯤 담긴 채로 시연을 시작하면
 * 「자료 셋이 한 사건으로 묶인다」를 보여주려던 자리에서 하나가 빕니다 —
 * 그 사실을 발표 중에 알아채기 어렵습니다.
 *
 * **스스로 다시 부르지 않습니다** — 다시 누르는 것은 사람입니다 (에러 §3.1).
 */
export async function loadMockEvidence(signal?: AbortSignal): Promise<MockLoad> {
  const files: MockFile[] = [];

  for (const one of MOCK_EVIDENCE) {
    let res: Response;
    try {
      res = await fetch(one.url, { signal });
    } catch {
      return { ok: false, fail: CANNOT };
    }
    if (!res.ok) return { ok: false, fail: CANNOT };

    let body: ArrayBuffer;
    try {
      body = await res.arrayBuffer();
    } catch {
      return { ok: false, fail: CANNOT };
    }

    files.push({
      slot: one.slot,
      file: new File([body], one.name, { type: one.type }),
    });
  }

  return { ok: true, files };
}
