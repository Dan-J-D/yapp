# voice-lab: faster-whisper (CTranslate2, CUDA 12 + cuDNN 9) + Praat/parselmouth.
# ctranslate2 4.x wheels are built against CUDA 12.x and cuDNN 9.
FROM nvidia/cuda:12.8.1-cudnn-runtime-ubuntu24.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    VIRTUAL_ENV=/opt/venv \
    PATH=/opt/venv/bin:$PATH \
    WHISPER_MODEL=large-v3-turbo \
    WHISPER_DEVICE=auto \
    WHISPER_CACHE=/data/models \
    HF_HOME=/data/models/hf

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv python3-pip ffmpeg curl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && python3 -m venv /opt/venv

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY prosody.py app.py ./
COPY tests ./tests

# Ubuntu 24.04 images ship a uid-1000 "ubuntu" user; reuse it so files written
# to the shared ./data volume match the host user.
USER ubuntu

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8000/health || exit 1

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
