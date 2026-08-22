# 모델을 돌리는 자리를 그대로 옮겨 담는다.
#
# 근거: ADR-028(자원은 밖에서 받는다) · RFC-001 「services/」
# 정본: services/transcriber/README.md 「올리기」
#
# ## 왜 하나의 이미지로 x86 과 ARM 을 다 덮나
#
# 값싼 국내 서버는 x86 이고, 무료로 얻을 수 있는 자리는 ARM 입니다. 어느 쪽에
# 올릴지가 아직 안 정해져서 **둘 다 되게** 만듭니다. 아키텍처마다 다른 것은
# 딱 하나 — x86 은 torch 를 그냥 받으면 GPU 용(2GB 넘음)이 와서 CPU 판을
# 따로 지정해야 합니다. ARM 은 애초에 CPU 판밖에 없습니다.
FROM python:3.12-slim

ARG TARGETARCH

# libgomp1 — ctranslate2 가 병렬 처리에 씁니다. 없으면 import 에서 터집니다
# libglib2.0-0 — easyocr 가 부르는 opencv 가 찾습니다
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgomp1 libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# x86 에서만 CPU 판을 먼저 못박습니다. 이걸 안 하면 easyocr 가 의존성으로
# GPU 용 torch 를 끌어와 이미지가 2GB 넘게 붑니다
RUN if [ "$TARGETARCH" = "amd64" ]; then \
      pip install --no-cache-dir \
        --index-url https://download.pytorch.org/whl/cpu \
        torch torchvision ; \
    fi

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
