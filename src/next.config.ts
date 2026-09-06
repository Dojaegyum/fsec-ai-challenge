import type { NextConfig } from "next";

/**
 * 모든 응답에 붙는 보안 헤더.
 *
 * 2026-09-06 배포본 점검에서 Vercel 이 주는 `Strict-Transport-Security` 말고는 아무것도
 * 없었습니다. 아래 넷은 화면·API 어느 쪽도 깨뜨리지 않는 것만 골랐습니다 —
 * 링크가 곧 열쇠인 서비스라(ADR-021·039) **남의 페이지 안에 끼워 넣는 것(클릭재킹)과
 * 주소가 밖으로 새는 것(Referrer)** 을 먼저 막습니다.
 *
 * `Content-Security-Policy` 는 일부러 안 넣었습니다 — Next 가 인라인 스크립트를 쓰고
 * 글꼴·이미지 출처를 다 세어야 해서, 심사 기간에 한 줄 틀리면 화면이 통째로 빕니다.
 * 본선 전에 nonce 기반으로 따로 잡습니다.
 */
const SECURITY_HEADERS = [
  // 응답의 종류를 브라우저가 추측하지 않게
  { key: "X-Content-Type-Options", value: "nosniff" },
  // 다른 사이트의 <iframe> 안에 이 화면을 끼워 넣지 못하게 — 링크가 열쇠라 특히
  { key: "X-Frame-Options", value: "DENY" },
  // 사건 주소(링크 토큰)가 바깥 링크를 눌렀을 때 Referer 로 새지 않게
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // 카메라·마이크·위치는 쓰지 않습니다 — 파일은 <input type=file> 로만 받습니다
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
