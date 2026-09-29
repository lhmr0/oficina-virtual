FROM python:3.12-slim
# Tesseract (OCR en español para PDFs escaneados) y espeak-ng (fonemas para las voces); el resto son wheels de pip, sin compilar
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-spa tesseract-ocr-eng espeak-ng \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir "fastapi==0.115.*" "uvicorn==0.32.*" "pymupdf4llm==0.0.*" "markitdown[docx,xlsx,xls,pptx]==0.1.*" "faster-whisper==1.*" \
    "piper-tts==1.*" "kokoro-onnx==0.6.*"
ENV TESSDATA_PREFIX=/usr/share/tesseract-ocr/5/tessdata HF_HOME=/cache/hf PYTHONUNBUFFERED=1
RUN useradd --uid 10002 --create-home ia && mkdir -p /cache && chown ia /cache
USER ia
WORKDIR /app
COPY app.py .
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8010"]
