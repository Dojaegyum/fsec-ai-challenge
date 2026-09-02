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

import { useCallback, useEffect, useState } from "react";

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
  /**
   * 파일 한 장을 올립니다.
   *
   * **올라간 뒤의 `evidence_id` 를 돌려줍니다** — 그것을 부산물로 낼 수 있어야
   * 하기 때문입니다(§3.8 `receipt_doc`). 못 올렸으면 `null` 이고, 그때도
   * 목록에는 남습니다(ADR-026).
   */
  readonly add: (file: File) => Promise<string | null>;
  readonly select: (id: string) => void;
  readonly selectedId: string | undefined;
  /** 서버가 말한 처리 상태로 레일 줄을 맞춥니다 → `markRail` */
  readonly mark: (evidenceId: string, status: RailFile["status"]) => void;
}

/* ── 서버에 이미 올라와 있는 자료를 되받는 자리 ─────────────────────
 *
 * ⚠️ **이것이 없어서 올린 자료가 화면에서 사라졌습니다.** 자료 레일이 이
 * 브라우저의 메모리만 보고 있었고, 자료를 읽는 길이 `…/evidence/{번호}` 하나라
 * **번호를 아는 것은 방금 올린 브라우저뿐**이었습니다. 그래서 새로고침하거나
 * 시작 화면에서 올리고 사건 화면으로 넘어오면 서버에 멀쩡히 있는 자료를
 * 영영 못 찾았습니다 → `app/api/cases/[case_token]/evidence/route.ts` 의 `GET`.
 */

/** §3.2 `GET` 응답 한 줄 */
interface EvidenceRow {
  readonly evidence_id: string;
  readonly kind: string;
  readonly ingest_status: string;
  readonly created_at: string;
}

/** 자료 레일에 그릴 이름 — **파일 이름이 서버에 없습니다**(일부러) */
const KIND_LABEL: Record<string, string> = {
  audio: "통화 녹음",
  image: "화면 캡처",
  text: "문서",
};

/**
 * 종류와 올린 시각으로 이름을 만듭니다.
 *
 * **원래 파일 이름은 서버에 없습니다.** 파일 이름에도 개인정보가 들어와서
 * (「입금내역_110-2345-678901.png」) `evidence` 표에 그 칸을 두지 않았습니다 —
 * 가리는 것은 브라우저의 `screenName` 이고, 가린 결과도 저장하지 않습니다.
 * 그래서 되받은 자료는 **이름 대신 종류와 시각**으로 그립니다.
 */
function labelOf(row: EvidenceRow): string {
  const kind = KIND_LABEL[row.kind] ?? "자료";
  const at = new Date(row.created_at);
  if (Number.isNaN(at.getTime())) return kind;
  const two = (n: number) => String(n).padStart(2, "0");
  return `${kind} · ${at.getMonth() + 1}/${at.getDate()} ${two(at.getHours())}:${two(at.getMinutes())}`;
}

const STATUSES: readonly string[] = ["pending", "processing", "done", "failed"];

/**
 * 서버가 준 목록과 이 브라우저가 들고 있던 목록을 합칩니다.
 *
 * **서버를 앞에, 로컬을 뒤에.** 서버 목록이 사건의 사실이고, 로컬에만 있는 줄은
 * 아직 서버에 없는 것들입니다 —
 *
 * | 로컬에만 있는 줄 | 왜 남겨야 하나 |
 * | --- | --- |
 * | 못 가려서 **안 올린** 파일 | `evidence_id` 가 없습니다. 사용자가 봐야 합니다 → ADR-026 |
 * | **올리는 중**인 파일 | 아직 서버 목록에 안 잡힙니다 |
 * | 올리다 **실패**한 파일 | 지우면 왜 안 올라갔는지 알 수 없습니다 |
 *
 * ⚠️ **`evidence_id` 로 겹침을 봅니다.** `id` 로 보면 안 됩니다 — 방금 올린 줄은
 * `local-3` 이고 서버에서 온 같은 파일은 증거 번호라, 키가 달라 **같은 파일이
 * 두 줄로** 그려집니다.
 */
/**
 * 서버가 말한 처리 상태로 레일 한 줄을 맞춥니다.
 *
 * ⚠️ **이게 없어서 전사가 끝나도 레일이 「개인정보 보호 처리중」에 남았습니다.**
 * 레일 줄의 상태는 올리던 순간의 값이고, **처리 상태의 주인은 서버입니다**
 * (§3.3). 판독이 실패한 파일도 레일에서는 처리중이라 실패 갈림길이 영영 안 떴습니다.
 *
 * **이미 그 상태면 같은 목록을 그대로 돌려줍니다** — 폴링이 몇 초마다 오는데
 * 매번 새 배열을 내면 화면이 쓸데없이 다시 그려집니다.
 */
export function markRail(
  files: readonly RailFile[],
  evidenceId: string,
  status: RailFile["status"],
): readonly RailFile[] {
  const at = files.findIndex((one) => one.evidence_id === evidenceId);
  if (at < 0 || files[at].status === status) return files;
  return files.map((one, i) => (i === at ? { ...one, status } : one));
}

export function mergeRail(
  server: readonly RailFile[],
  local: readonly RailFile[],
): readonly RailFile[] {
  if (server.length === 0) return local;
  const known = new Set(server.map((one) => one.evidence_id));
  return [...server, ...local.filter((one) => !one.evidence_id || !known.has(one.evidence_id))];
}

/**
 * 이 사건에 올라와 있는 자료를 받아 옵니다.
 *
 * **못 받아도 던지지 않습니다.** 목록을 못 불러온 것과 자료가 없는 것은 다르지만,
 * 여기서 터뜨리면 이번에 올리는 것까지 막힙니다 — 사건은 그대로 진행됩니다
 * (불변 규칙 5). 못 받으면 빈 목록이고, 이번 세션에 올린 것은 그대로 보입니다.
 */
async function fetchEvidenceList(
  caseToken: string,
  signal?: AbortSignal,
): Promise<readonly RailFile[]> {
  let res: Response;
  try {
    res = await fetch(`/api/cases/${encodeURIComponent(caseToken)}/evidence`, {
      signal,
      headers: { accept: "application/json" },
    });
  } catch {
    return [];
  }
  if (!res.ok) return [];

  let rows: readonly EvidenceRow[];
  try {
    const body = (await res.json()) as { evidence?: readonly EvidenceRow[] };
    rows = body.evidence ?? [];
  } catch {
    return [];
  }

  return rows
    .filter((one) => typeof one.evidence_id === "string" && one.evidence_id.length > 0)
    .map((one) => ({
      // 서버에서 온 줄은 **증거 번호를 키로** 씁니다 — 로컬 id 와 섞이지 않습니다
      id: one.evidence_id,
      evidence_id: one.evidence_id,
      name: labelOf(one),
      // 모르는 상태를 화면 어휘로 지어내지 않습니다 — 아직 안 끝난 것으로 둡니다
      status: (STATUSES.includes(one.ingest_status)
        ? one.ingest_status
        : "pending") as RailFile["status"],
    }));
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

  /**
   * 사건에 이미 올라와 있는 자료를 한 번 받아 옵니다 — 위 「되받는 자리」.
   *
   * **이번 세션에 올린 것을 덮지 않습니다.** 서버 목록을 앞에 두고, 그 뒤에
   * 아직 서버에 없는 로컬 줄(못 올린 파일·올리는 중)만 이어 붙입니다.
   * 못 올린 파일은 `evidence_id` 가 없어 서버 목록에 없고, 그래서 남습니다
   * (ADR-026 — 못 가려서 안 올린 파일도 목록에 보여야 합니다).
   */
  useEffect(() => {
    if (!caseToken) return;
    const ac = new AbortController();
    let alive = true;

    void (async () => {
      const found = await fetchEvidenceList(caseToken, ac.signal);
      if (!alive || found.length === 0) return;

      setFiles((prev) => mergeRail(found, prev));
      // 아무것도 안 고른 상태면 첫 줄을 골라 둡니다 — 자료함이 빈 본문으로 열리지 않게
      setSelectedId((cur) => cur ?? found[0]?.id);
    })();

    return () => {
      alive = false;
      ac.abort();
    };
  }, [caseToken]);

  const add = useCallback(
    async (file: File): Promise<string | null> => {
      if (!caseToken || busy) return null;

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
        return null;
      }

      setFiles((prev) =>
        prev.map((one) =>
          one.id === id
            ? { ...one, evidence_id: sent.evidenceId, status: "processing" }
            : one,
        ),
      );

      // **부산물로 낼 수 있게 돌려줍니다.** 전사가 끝나기를 기다리지 않습니다 —
      // §3.8 은 `evidence_id` 만 요구하고, 올린 것 자체가 L2 증빙입니다
      return sent.evidenceId;
    },
    [busy, caseToken],
  );

  const select = useCallback((id: string) => setSelectedId(id), []);

  const mark = useCallback((evidenceId: string, status: RailFile["status"]) => {
    setFiles((prev) => markRail(prev, evidenceId, status));
  }, []);

  return { files, busy, fail, add, select, selectedId, mark };
}
