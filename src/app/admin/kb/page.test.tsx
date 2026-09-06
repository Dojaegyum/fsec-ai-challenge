import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ChangeBody, EntriesBody, QueueBody } from "@/flows/kb-review";
import { ChangeDetail, LoginCard, QueueList } from "./page";
import { initialState } from "./state";

const textOf = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

const view = (id: string, article: string, affected: string[] = []) => ({
  change_id: id,
  source_key: `law:011359:${article.replace(/[제조]/g, "").replace("의", ":")}`,
  source: { prefix: "law:011359", label: "법 011359 · 통신사기피해환급법" },
  article,
  title: null,
  first_seen: true,
  detected_at: "2026-09-06T04:00:12+09:00",
  meta: { 시행일자: "20260804" },
  affected,
  review_status: "pending" as const,
});
const QUEUE: QueueBody = {
  kb_version: "2026.09.2",
  counts: { pending: 2, deferred: 0 },
  groups: [{ dedupe_key: null, changes: [view("A", "제3조", ["common-freeze-request"]), view("B", "제13조의4")] }],
};
const ENTRIES: EntriesBody = {
  kb_version: "2026.09.2",
  entries: [
    {
      kb_entry_id: "common-freeze-request",
      title: "돈이 빠져나간 금융회사에 지급정지를 요청합니다",
      file: "common.json",
      track: "victim",
      channel_id: null,
      org_id: null,
      legal_basis: "법 제3조",
      effective_from: "2024-08-28",
      verified_at: "2026-08-25",
      pending_changes: ["A"],
    },
  ],
};
const CHANGE: ChangeBody = {
  change: QUEUE.groups[0]!.changes[0]!,
  before: null,
  after: { snapshot_id: "S", content: "① 피해자는 피해금을 …", meta: {} },
  affected: [{ ...ENTRIES.entries[0]! }],
  review: { status: "pending", by: null, at: null, note: null, released_version: null },
};

describe("로그인 카드 — 401 이면 본문 자리에", () => {
  it("이름과 비밀번호 칸이 있고 이유를 말하지 않는다", () => {
    const html = renderToStaticMarkup(<LoginCard name="" onSubmit={() => {}} busy={false} message={null} />);
    expect(html).toContain('type="password"');
    expect(textOf(html)).toContain("검수자 이름");
  });
});

describe("목록 — 두 렌즈", () => {
  it("조문 기준은 조문을, 매뉴얼 기준은 항목을 줄 세운다", () => {
    const article = textOf(
      renderToStaticMarkup(<QueueList state={initialState} queue={QUEUE} entries={ENTRIES} dispatch={() => {}} />),
    );
    expect(article).toContain("제3조");
    expect(article).toContain("새 조문");
    const entry = textOf(
      renderToStaticMarkup(
        <QueueList state={{ ...initialState, lens: "entry" }} queue={QUEUE} entries={ENTRIES} dispatch={() => {}} />,
      ),
    );
    expect(entry).toContain("지급정지를 요청합니다");
  });
});

describe("상세 — 판단 단추", () => {
  it("승인 단추는 「승인」이고 어느 단추에도 「반영」이 없다 — RFC-002", () => {
    const html = renderToStaticMarkup(
      <ChangeDetail change={CHANGE} loading={false} onPickEntry={() => {}} onDecide={() => {}} busy={false} message={null} nextTitle="제4조" />,
    );
    const buttons = [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => textOf(m[1]!));
    expect(buttons).toContain("승인");
    expect(buttons.some((label) => label.includes("반영"))).toBe(false);
    expect(textOf(html)).toContain("자동 반영되지 않습니다");
  });
  it("최초 수집은 직전이 없다고 말하고 닿는 매뉴얼에 (추정) 을 붙인다", () => {
    const text = textOf(
      renderToStaticMarkup(
        <ChangeDetail change={CHANGE} loading={false} onPickEntry={() => {}} onDecide={() => {}} busy={false} message={null} nextTitle={null} />,
      ),
    );
    expect(text).toContain("직전 원문이 없습니다");
    expect(text).toContain("닿는 매뉴얼(추정)");
    expect(text).toContain("common-freeze-request");
  });
});
