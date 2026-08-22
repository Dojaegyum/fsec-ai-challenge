import Icon, { ICON_NAMES } from "@/components/ui/Icon";

/**
 * 아이콘 눈으로 보는 자리 — **제품이 아닙니다.**
 *
 * 34종이 실제로 뜨는지, 크기 단계가 맞는지, `currentColor` 가 감싸는 글자의
 * 토큰을 따라오는지 확인합니다. 외부 스프라이트 `<use>` 는 경로가 틀리면
 * **조용히 빈칸**이 되므로 눈으로 봐야 합니다.
 *
 * 시안: assets/artifacts/handoff/08-21-icons/
 */

const COLORS = [
  ["text-ink-3", "기본 — ink-3"],
  ["text-pii", "가려짐·보호 — pii"],
  ["text-deadline-urgent", "기한·재시도 — deadline-urgent"],
  ["text-ink-1", "버튼 위 — ink-1"],
] as const;

export default function IconsDevPage() {
  return (
    <main className="mx-auto w-full max-w-shell px-[clamp(16px,3vw,32px)] py-10">
      <h1 className="text-[20px] font-[660] text-ink-1">아이콘 34종</h1>
      <p className="mt-1 text-[13px] text-ink-3">
        개발용 확인 화면입니다. <b className="font-[620] text-ink-2">제품 경로가 아닙니다.</b>
      </p>

      <section className="mt-8">
        <h2 className="text-[12.5px] tracking-[0.12em] text-ink-4">전체 · 18px · ink-3</h2>
        <ul className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-px">
          {ICON_NAMES.map((n) => (
            <li
              key={n}
              className="flex items-center gap-2.5 border border-hairline bg-surface px-3 py-2.5 text-[13px] text-ink-3"
            >
              <Icon name={n} />
              <span data-numeric>{n}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-[12.5px] tracking-[0.12em] text-ink-4">크기 단계</h2>
        <div className="mt-3 flex flex-wrap items-center gap-5">
          {([16, 18, 20, 24] as const).map((s) => (
            <span key={s} className="flex items-center gap-2 text-[13px] text-ink-2">
              <Icon name="copy" size={s} />
              <span data-numeric>{s}px</span>
            </span>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-[12.5px] tracking-[0.12em] text-ink-4">
          색 — currentColor 가 글자 토큰을 따라옵니다
        </h2>
        <div className="mt-3 flex flex-wrap gap-5">
          {COLORS.map(([cls, label]) => (
            <span key={cls} className={`flex items-center gap-2 text-[13px] ${cls}`}>
              <Icon name="masked" />
              <span>{label}</span>
            </span>
          ))}
        </div>
      </section>

      <section className="mt-8 mb-16">
        <h2 className="text-[12.5px] tracking-[0.12em] text-ink-4">
          모션 — 감속 모드에서 멈춰야 합니다
        </h2>
        <div className="mt-3 flex flex-wrap gap-5">
          <span className="flex items-center gap-2 text-[13px] text-ink-2">
            <Icon name="working" spin />
            <span>진행 중 (spin)</span>
          </span>
          <span className="flex items-center gap-2 text-[13px] text-ink-2">
            <Icon name="dots" pulse />
            <span>보내는 중 (pulse)</span>
          </span>
        </div>
      </section>
    </main>
  );
}
