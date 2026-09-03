/**
 * 값을 읽기 좋게 다듬는 성형기 둘 — 기재 안내와 사건 파일 카드가 **같은 것**을 씁니다.
 *
 * ⚠️ 2026-09-03 까지 이게 `doc.tsx` 안에만 있어서, 같은 서버 값이 기재
 * 안내에서는 「3,000,000원」, 사건 파일 카드에서는 「3000000」으로 다르게
 * 보였습니다 (감사 D1). **시각만 다듬고 값은 서버 것 그대로**입니다 —
 * 여기서 해석·계산을 얹지 마세요.
 */

/**
 * 금액을 옮겨 적기 좋게 — `3000000` → `3,000,000원`.
 *
 * **숫자만인 값에만 손댑니다.** 「300만원쯤」처럼 사용자가 말한 그대로가 들어오면
 * 그대로 둡니다 — 우리가 해석해 바꾸면 **본인이 한 말과 다른 값**이 서류에 갑니다.
 *
 * 복사되는 값(`raw`)은 숫자뿐입니다. 은행 앱 금액 칸이 쉼표를 안 받습니다.
 */
export function amountShape(value: string): { display: string; raw: string } {
  const digits = value.replace(/[\s,]/g, "");
  if (!/^\d+$/.test(digits)) return { display: value, raw: value };
  return { display: `${Number(digits).toLocaleString("ko-KR")}원`, raw: digits };
}

/**
 * 시각을 읽기 좋게 — `2026-08-14T14:02:00Z` → `2026. 8. 14. 14:02`.
 *
 * ⚠️ **날짜를 세지 않습니다.** 법정 기한은 코드의 규칙이 계산하고(불변 규칙 7)
 * 이 함수는 **있는 값을 다르게 적을 뿐**입니다. 여기서 하루를 더하거나 빼지 마세요.
 *
 * 못 읽는 모양이면 **받은 그대로** 냅니다 — 우리가 만든 값을 서류에 적게 하는 것보다
 * 사용자가 자기가 말한 문자열을 보는 편이 낫습니다.
 */
export function whenShape(value: string): { display: string; raw: string } {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return { display: value, raw: value };
  const two = (n: number) => String(n).padStart(2, "0");
  const display =
    `${at.getFullYear()}. ${at.getMonth() + 1}. ${at.getDate()}. ` +
    `${two(at.getHours())}:${two(at.getMinutes())}`;
  return { display, raw: display };
}

/**
 * 사건 파일 카드가 슬롯 한 줄을 그릴 때 쓰는 얼굴 — 슬롯 종류로 성형기를 고릅니다.
 * 토큰(`[계좌-1]`)이 섞인 값은 숫자·날짜로 안 읽혀 **그대로 통과**합니다.
 */
export function slotFace(slotKey: string, value: string): string {
  if (slotKey === "amount") return amountShape(value).display;
  if (slotKey === "occurred_at") return whenShape(value).display;
  return value;
}
