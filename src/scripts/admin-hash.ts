/**
 * 관리자 비밀번호 해시를 만든다 — `npm run admin:hash -- <비밀번호>`.
 *
 * 출력을 배포 환경변수 `ADMIN_PASSWORD_HASH` 에 넣습니다 (API §1.2 · §7.1 · ADR-081).
 * 비밀번호는 **인자로만** 받고 어디에도 기록하지 않습니다. 셸 히스토리에 남는 것이 싫으면
 * 앞에 공백을 두고 치세요(bash 의 HISTCONTROL=ignorespace).
 */
import { hashPassword } from '@/lib/admin-password'

const plain = process.argv.slice(2).find((one) => !one.startsWith('--'))
if (!plain || plain.length < 12) {
  console.error('사용법: npm run admin:hash -- <비밀번호>   (12자 이상 · 무작위 문자열을 권합니다)')
  process.exit(1)
}
const hash = hashPassword(plain)
console.log(hash)
// 값의 `$` 를 Next 의 env 로더(dotenv-expand)가 변수로 확장합니다 — 따옴표로 감싸도 같습니다.
// `.env.local` 에서는 `\$` 로 이스케이프해야 하고, 그대로 넣으면 해시가 깨져 로그인이 전부 401 입니다
// (2026-09-06 실제로 겪음). Vercel 환경변수는 파일이 아니라 확장하지 않으니 위 원본 그대로 넣습니다
console.error(`※ 로컬 .env.local 에는 이 줄을 (Vercel 에는 위 원본 그대로):\nADMIN_PASSWORD_HASH=${hash.replace(/\$/g, '\\$')}`)
