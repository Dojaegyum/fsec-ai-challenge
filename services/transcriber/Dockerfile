# 모델을 돌리는 자리를 그대로 옮겨 담는다.
#
# 근거: ADR-028(자원은 밖에서 받는다) · RFC-001 「services/」
# 정본: services/transcriber/README.md 「올리기」
#
# ## 왜 하나의 이미지로 x86 과 ARM 을 다 덮나
#
# 값싼 국내 서버는 x86 이고, 무료로 얻은 자리는 ARM 입니다(오라클 애슈번
# A1.Flex). 둘 다 되게 만들어 두면 옮겨 다닐 수 있습니다.
#
# **아키텍처로 갈리는 것은 이제 없습니다.** 예전에는 「x86 만 CPU 판을
# 지정하면 된다」고 적혀 있었는데 틀렸습니다 → 아래 torch 설치 줄.
FROM python:3.12-slim

# libgomp1 — ctranslate2 가 병렬 처리에 씁니다. 없으면 import 에서 터집니다
# libglib2.0-0 — easyocr 가 부르는 opencv 가 찾습니다
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgomp1 libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# **CPU 판 torch 를 먼저 못박습니다 — 아키텍처를 가리지 않습니다.**
#
# 이걸 안 하면 easyocr 가 의존성으로 GPU 용을 끌어옵니다. 예전에는 x86 에서만
# 그런 줄 알고 조건을 걸었는데 **ARM 도 똑같았습니다** — 애슈번 A1.Flex 빌드
# 로그에 `nvidia-cublas`·`nvidia-cudnn-cu13`·`nvidia-nccl` 이 전부 깔렸습니다.
# PyTorch 가 Grace·Jetson 을 위해 aarch64 에도 CUDA 판을 내주기 때문입니다.
#
# 우리 서버에는 GPU 가 없어 **한 줄도 안 쓰입니다.** 그래도 받아서 굽느라
# 이미지가 3.2GB 였고, 그중 2GB 가량이 그것이었습니다.
RUN pip install --no-cache-dir \
      --index-url https://download.pytorch.org/whl/cpu \
      torch torchvision

COPY requirements.txt requirements-models.txt ./
RUN pip install --no-cache-dir -r requirements.txt -r requirements-models.txt

# 모델 파일이 들어갈 자리. **이미지에 안 굽습니다** — 볼륨에 두면 이미지를
# 다시 만들어도 1.5GB 를 다시 안 받습니다
ENV HF_HOME=/models/hf \
    EASYOCR_MODULE_PATH=/models/easyocr \
    PYTHONUNBUFFERED=1

COPY . /app/transcriber/

# 뿌리 권한으로 안 돌립니다 — 이 서비스는 밖에서 받은 주소로 파일을 내려받습니다
RUN useradd --system --create-home runner \
 && mkdir -p /models /work \
 && chown -R runner:runner /models /work /app
USER runner
ENV FINALLY_WORKDIR=/work

EXPOSE 8917

# 「떴나」가 아니라 「받을 준비가 됐나」를 봅니다. 모델 적재에 20초쯤 걸리는데
# 그 사이에 요청을 넘기면 첫 사용자가 그걸 맞습니다
HEALTHCHECK --interval=30s --timeout=10s --start-period=15m --retries=3 \
  CMD python -c "import json,urllib.request;\
d=json.load(urllib.request.urlopen('http://127.0.0.1:8917/health',timeout=5));\
raise SystemExit(0 if d.get('ready') else 1)"

CMD ["uvicorn", "transcriber.app:app", "--host", "0.0.0.0", "--port", "8917"]
