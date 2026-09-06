import type { MetadataRoute } from "next";

/**
 * 검색 로봇 규칙 — 서비스 개념이 「진입은 검색·직접 접속」(ADR-021)이라 랜딩과
 * `/start` 는 색인을 막지 않습니다. **사건 화면(`/c/…`)은 막습니다** — 링크 토큰이
 * 곧 열쇠라(ADR-039) 누군가 링크를 공개된 곳에 붙여 넣으면 색인이 그 사건을
 * 검색 결과로 띄울 수 있습니다. API·관리자 화면도 색인할 것이 없습니다.
 *
 * 2026-09-06 심사에서 `GET /robots.txt` 가 404 였습니다.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/start"],
        disallow: ["/c/", "/api/", "/admin"],
      },
    ],
  };
}
