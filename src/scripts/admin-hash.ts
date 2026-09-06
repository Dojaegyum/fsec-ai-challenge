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
console.log(hashPassword(plain))
