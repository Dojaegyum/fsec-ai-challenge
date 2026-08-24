"""`services/` 를 **정규 패키지**로 만든다 — 이름이 가려지는 것을 막습니다.

이 파일이 없으면 `services/` 는 네임스페이스 패키지가 되는데, 파이썬은
**경로 어디에든 같은 이름의 정규 패키지가 있으면 그쪽을 씁니다.**
그래서 `oci-cli` 를 깐 컴퓨터에서는 그것이 함께 넣는 `site-packages/services/`
가 이겨서, 서비스 시험이 다음처럼 깨집니다.

    ModuleNotFoundError: No module named 'services.transcriber'

`deploy/oci-provision.py` 가 OCI SDK 를 쓰므로 이 저장소를 다루는 사람은
`oci-cli` 를 깔게 됩니다 — 그때 검사기가 이유 없이 빨개지지 않게 합니다.
CI 는 그것을 안 깔아 지금까지 초록이었습니다. **로컬과 CI 가 달라지는 자리라
더 위험합니다.**

근거: RFC-001 「CI가 강제합니다」 — 사람이 손으로 돌리는 명령과 CI 가 같아야 합니다.
"""