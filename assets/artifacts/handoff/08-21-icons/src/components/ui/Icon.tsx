import type { SVGProps } from "react";

/**
 * FinAlly 아이콘 — /public/icons.svg 스프라이트 참조
 *
 * 규칙 (디자인 캔버스 「icons-v1」)
 *  · 24×24 그리드 · 스트로크 1.5 · currentColor — 색은 글자 토큰이 정합니다
 *  · 항상 글자와 함께 씁니다. 아이콘 단독 금지 → 기본 aria-hidden
 *  · 상태 마크(✓·◆·○·!)는 기존 규칙 그대로 — 아이콘은 사물·행동만
 *  · 색 용법: 기본 ink-3/icon · 파랑(--pii) 가려짐·보호 · 앰버 기한·재시도 · 흰색 버튼 위
 *  · 크기 단계: 16 칩 · 18 행 · 20 버튼 · 24 패널 머리
 *  · spin/pulse 는 장식 — prefers-reduced-motion 이 globals 블록에서 전부 정지
 */

export const ICON_NAMES = [
  // 사물·행동
  "key", "copy", "chat", "board", "evidence", "doc", "upload", "download",
  "external", "phone", "clock", "calendar", "masked", "shield", "wait",
  "read", "write", "check-c", "help-c", "alert-c", "send", "mail",
  "x", "chevron", "trash", "bank",
  // AI 인터랙션 — 문장 로딩 카피 곁의 보조 (스켈레톤·타자기 대체 아님)
  "spark", "thinking", "working", "verify", "maskwork", "retry", "stop", "dots",
] as const;

export type IconName = (typeof ICON_NAMES)[number];

type Props = Omit<SVGProps<SVGSVGElement>, "width" | "height"> & {
  name: IconName;
  /** px. 16 칩 · 18 행(기본) · 20 버튼 · 24 패널 머리 */
  size?: 16 | 18 | 20 | 24;
  /** working 전용 회전 (1.4s linear) */
  spin?: boolean;
  /** dots 전용 맥동 (1.6s ease-in-out) */
  pulse?: boolean;
};

export default function Icon({ name, size = 18, spin, pulse, style, ...rest }: Props) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      style={{
        flex: "none",
        animation: spin
          ? "icon-spin 1.4s linear infinite"
          : pulse
            ? "pulse-dot 1.6s ease-in-out infinite"
            : undefined,
        ...style,
      }}
      {...rest}
    >
      <use href={`/icons.svg#i-${name}`} />
    </svg>
  );
}
