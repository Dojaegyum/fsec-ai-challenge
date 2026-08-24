"use client";

/**
 * 파일 한 장을 올리는 자리 — §3.2 세 걸음.
 *
 * 계약: spec/common/08-14-api.md §3.2 §3.3 · spec/frontend/08-14-screens.md §S-08
 * 근거: ADR-026(가리지 못한 파일은 올리지 않는다) · ADR-034(화면은 원문)
 *
 * ## 무엇을 할지는 `file-sender` 가 정합니다
 *
 * ```
 * nextStep(state) → request-slot → put-file → notify-complete → poll
 * ```
 *
 * **여기서 순서를 다시 적지 않습니다.** 부르는 것만 합니다 — 그게 층 C 의
 * 「판단만 돌려주고 부르지 않는다」와 짝입니다. 마지막 `poll` 은 `load.ts` 의
 * `useEvidence` 가 이어받습니다(서버가 준 `poll_after_ms` 만 씁니다).
 *
 * ## 파일은 우리 서버를 안 거칩니다
 *
 * `upload_url` 로 **곧장** 갑니다 (§3.2). 서버리스 함수의 본문 크기·실행 시간
 * 제한 때문입니다 — 그래서 이 `PUT` 만은 `postJson` 을 안 씁니다.
 */

import { useCallback, useState } from "react";

import { nextStep, screenName } from "@/modules/file-sender";
import type { RailFile, SendState } from "@/modules/file-sender";

import { postJson } from "./load";
import type { LoadFail } from "./load";

/**
 * §3.2 의 `kind` — 계약이 **셋으로 못박았습니다**.
 *
 * ⬜ **PDF 를 어디에 넣을지는 정본에 없습니다.** `text/*` 가 아니고, 판독은
 * OCR 이라 `image` 에 가깝지만 데이터 모델이 말하지 않습니다. **지어내지 않고
 * 안 받습니다** — 잘못된 `kind` 로 올리면 전사기가 다른 일을 합니다.
 * 화면의 자료 슬롯 넷(통화 녹음·캡처·이체 내역·통지)은 전부 소리 아니면
 * 사진이라, 지금 막히는 사람은 없습니다 → QA 계획 Task 9.
 */
export function kindOf(mime: string): "audio" | "image" | "text" | null {
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("text/")) return "text";
  return null;
}

export type UploadResult =
  | { readonly ok: true; readonly evidenceId: string }
  | { readonly ok: false; readonly fail: LoadFail };

interface Slot {
  readonly evidence_id: string;
  readonly upload_url: string;
  readonly upload_method: string;
  readonly expires_at: string;
}

function fail(message: string, retryable: boolean): { ok: false; fail: LoadFail } {
  return { ok: false, fail: { poll: false, reason: "error", retryable, message } };
}

/**
 * 세 걸음을 걷습니다. **폴링은 여기서 안 합니다** — 자리를 받고 올리고 알린
 * 뒤 `evidence_id` 를 돌려주면, 전사 상태는 `useEvidence` 가 봅니다.
 */
export async function uploadFile(input: {
  caseToken: string;
  file: File;
  signal?: AbortSignal;
}): Promise<UploadResult> {
  const { caseToken, file, signal } = input;

  const kind = kindOf(file.type);
  if (kind === null) {
    return fail(
      "이 종류의 파일은 아직 받지 못합니다. 사진이나 녹음 파일로 올려 주세요.",
      false,
    );
  }

  const base = `/api/cases/${encodeURIComponent(caseToken)}/evidence`;
  let state: SendState = { phase: "idle", target: { kind: "evidence" } };
  let slot: Slot | null = null;

  // `nextStep` 이 시키는 대로만 걷습니다. **여기서 순서를 판단하지 않습니다**
  for (;;) {
    const step = nextStep(state);

    if (step.do === "request-slot") {
      const made = await postJson(
        base,
        { kind, mime_type: file.type, byte_size: file.size },
        signal,
        "올릴 자리를 받지 못했습니다. 연결을 확인해 주세요.",
      );
      if (!made.ok) return { ok: false, fail: made.fail };

      slot = made.json as Slot;
      if (typeof slot?.upload_url !== "string" || typeof slot.evidence_id !== "string") {
        return fail("올릴 자리를 받았는데 주소가 없습니다.", true);
      }
      state = { phase: "slot-requested", target: state.target, slot };
      continue;
    }

    if (step.do === "put-file") {
      // **우리 서버를 안 거칩니다** — 객체 저장소로 곧장 갑니다 (§3.2)
      let put: Response;
      try {
        put = await fetch(step.url, {
          method: step.method,
          signal,
          headers: { "content-type": file.type },
          body: file,
        });
      } catch {
        if (signal?.aborted) return fail("올리기를 멈췄습니다.", false);
        return fail("파일을 올리지 못했습니다. 연결을 확인해 주세요.", true);
      }
      if (!put.ok) {
        // 자리에는 만료가 있습니다(§3.2 `expires_at`) — 다시 받으면 될 수 있습니다
        return fail("파일을 올리지 못했습니다. 다시 시도해 주세요.", true);
      }
      state = { phase: "uploaded", target: state.target, slot: slot as Slot };
      continue;
    }

    if (step.do === "notify-complete") {
      const told = await postJson(
        `${base}/${encodeURIComponent(step.evidenceId)}/complete`,
        {},
        signal,
        "올린 것을 알리지 못했습니다.",
      );
      // ⚠️ **여기서 실패하면 파일은 이미 저장소에 있습니다.** 다시 눌러도
      // 같은 자리에 다시 올라갈 뿐이라 안전합니다 — 그래서 retryable 입니다
      if (!told.ok) return { ok: false, fail: told.fail };
      state = { phase: "notified", target: state.target, evidenceId: step.evidenceId };
      continue;
    }

    // `poll` 부터는 `useEvidence` 가 이어받습니다
    if (step.do === "poll") return { ok: true, evidenceId: step.evidenceId };

    // 증거만 다룹니다 — 단계 부산물(§3.8)은 아직 배선하지 않았습니다
    return fail("올리기를 끝내지 못했습니다.", false);
  }
}

/** 화면이 받는 것 — 레일 목록과 「올리기」 하나 */
export interface Uploads {
  readonly files: readonly RailFile[];
  readonly busy: boolean;
  readonly fail: LoadFail | null;
  readonly add: (file: File) => Promise<void>;
  readonly select: (id: string) => void;
  readonly selectedId: string | undefined;
}

let localSeq = 0;

/**
 * 자료 레일을 들고 있습니다.
 *
 * **서버 응답만으로는 못 만듭니다** — 못 가려서 **안 올린 파일도 목록에
 * 남아야** 하고(ADR-026), 그런 파일에는 `evidence_id` 가 없습니다.
 *
 * ⚠️ **화면마다 부르지 마세요.** 전환 중에는 나가는 본문의 사본(유령)이 함께
 * 그려지는데, 훅이 둘이면 사본이 빈 목록을 보여줍니다 — `chat` 과 같습니다.
 */
export function useUploads(caseToken: string | null, seed: readonly RailFile[] = []): Uploads {
  const [files, setFiles] = useState<readonly RailFile[]>(seed);
  const [selectedId, setSelectedId] = useState<string | undefined>(seed[0]?.id);
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<LoadFail | null>(null);

  const add = useCallback(
    async (file: File) => {
      if (!caseToken || busy) return;

      // **이름도 경계를 지납니다** — 「입금내역_110-2345-678901.png」가 실제로 흔합니다.
      // 레일에 그리는 이름은 `screenName` 을 지난 것입니다 (`RailFile.name` 의 뜻)
      const screened = screenName(file.name);
      localSeq += 1;
      const id = `local-${localSeq}`;

      setBusy(true);
      setFail(null);
      setFiles((prev) => [...prev, { id, name: screened.safe, status: "pending" }]);
      setSelectedId(id);

      const sent = await uploadFile({ caseToken, file });
      setBusy(false);

      if (!sent.ok) {
        setFail(sent.fail);
        // **목록에서 지우지 않습니다** — 못 올린 것도 사용자가 봐야 합니다.
        // 「가릴 수 없어 안 올림」과 낱말이 같지만 다른 상태입니다 (`forkFor` 경고)
        setFiles((prev) =>
          prev.map((one) => (one.id === id ? { ...one, status: "failed" } : one)),
        );
        return;
      }

      setFiles((prev) =>
        prev.map((one) =>
          one.id === id
            ? { ...one, evidence_id: sent.evidenceId, status: "processing" }
            : one,
        ),
      );
    },
    [busy, caseToken],
  );

  const select = useCallback((id: string) => setSelectedId(id), []);

  return { files, busy, fail, add, select, selectedId };
}
