"use client";
import { useState } from "react";

const FIELD =
  "min-h-[var(--size-touch)] rounded-[11px] border border-hairline bg-surface-low px-[14px] text-[14.5px] text-ink-1";

/** 로그인 카드 — S-12 「문」. 401 이면 본문 자리에 뜹니다. 이유는 말하지 않습니다(§7.1) */
export function LoginCard({
  name,
  onSubmit,
  busy,
  message,
}: {
  name: string;
  onSubmit(name: string, password: string): void;
  busy: boolean;
  message: string | null;
}) {
  const [who, setWho] = useState(name);
  const [password, setPassword] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(who.trim(), password);
      }}
      className="mx-auto mt-[10vh] flex w-full max-w-[420px] flex-col gap-3 rounded-[18px] bg-stage p-6 shadow-[0_1px_0_oklch(1_0_0/6%)_inset,0_16px_40px_-18px_oklch(0_0_0/70%)]"
    >
      <span className="text-[12.5px] font-[620] tracking-[0.13em] text-ink-4">KB 검수</span>
      <h1 className="text-[20px] font-[640] leading-[1.6] text-ink-1">팀만 들어오는 문입니다</h1>
      <label className="flex flex-col gap-1 text-[13px] text-ink-3">
        검수자 이름
        <input
          value={who}
          onChange={(e) => setWho(e.target.value)}
          required
          maxLength={64}
          autoComplete="username"
          className={FIELD}
        />
      </label>
      <label className="flex flex-col gap-1 text-[13px] text-ink-3">
        비밀번호
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
          className={FIELD}
        />
      </label>
      {message && (
        <p
          role="alert"
          className="rounded-[13px] border border-[oklch(0.77_0.117_70.9/45%)] bg-[oklch(0.77_0.117_70.9/6%)] px-3 py-2.5 text-[13px] text-ink-1"
        >
          {message}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="inline-flex min-h-[var(--size-touch)] items-center justify-center rounded-full bg-ink-1 px-[18px] text-[13.5px] font-[620] text-ground disabled:opacity-40"
      >
        들어가기
      </button>
    </form>
  );
}
