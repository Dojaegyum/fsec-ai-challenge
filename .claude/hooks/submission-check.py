"""접수 핸드오프 되짚기 — `git commit` 이 있는 셸 호출 뒤에만 말합니다.

PostToolUse 훅(.claude/settings.json)이 부릅니다. 커밋이 아니면 조용히 끝나고,
커밋이면 docs/plans/09-04-submission-handoff.md 의 미완 항목(`- [ ]`)과
접수 마감(2026-09-07 10:00 KST)까지 남은 시간을 stdout 으로 돌려줍니다 —
PostToolUse 의 stdout 은 에이전트 컨텍스트로 들어가 다음 판단에 실립니다.

미완이 없으면 아무 말도 안 합니다. 문서를 못 찾으면 한 줄만 남깁니다
(옛 브랜치의 워킹트리일 수 있습니다 — main 을 받으면 생깁니다).

접수가 끝나면 이 훅과 settings.json 의 등록을 함께 지우면 됩니다.
"""

import json
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

DOC = "docs/plans/09-04-submission-handoff.md"
KST = timezone(timedelta(hours=9))
DEADLINE = datetime(2026, 9, 7, 10, 0, tzinfo=KST)  # 공고문: 9/7(월) 10:00 접수 마감


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return
    command = str(payload.get("tool_input", {}).get("command", ""))
    if "git commit" not in command:
        return

    # 훅의 cwd 는 세션이 뜬 곳입니다 — 워크트리에서 돌면 그 워크트리의 사본을 봅니다
    root = Path.cwd()
    try:
        top = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, timeout=5,
        ).stdout.strip()
        if top:
            root = Path(top)
    except Exception:
        pass

    doc = root / DOC
    if not doc.exists():
        print(f"[접수 훅] {DOC} 이 이 트리에 없습니다 — main 을 받으면 생깁니다.")
        return

    text = doc.read_text(encoding="utf-8")
    # 체크박스 줄만 봅니다. 들여쓰기 이어짐 줄은 항목 제목이 아니라 안 셉니다
    undone = [
        re.sub(r"\*\*(.+?)\*\*", r"\1", m.group(1)).strip()
        for m in re.finditer(r"^- \[ \] (.+)$", text, re.MULTILINE)
    ]
    if not undone:
        return

    left = DEADLINE - datetime.now(KST)
    hours = int(left.total_seconds() // 3600)
    when = f"{hours // 24}일 {hours % 24}시간" if hours >= 0 else "지남"
    print(f"[접수 훅] 마감(9/7 10:00)까지 {when} · 미완 {len(undone)}건 — {DOC}")
    for one in undone:
        print(f"  · {one.split('—')[0].strip()}")
    print("  끝낸 항목이 있으면 문서의 체크를 [x] 로 바꾸세요 — 그래야 이 목록이 줄어듭니다.")


if __name__ == "__main__":
    main()
