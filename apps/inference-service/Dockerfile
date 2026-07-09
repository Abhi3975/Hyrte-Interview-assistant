# Vision/audio inference service. Uses Vercel-agnostic slim Python.
FROM python:3.13-slim

WORKDIR /app

# System libs some vision backends (Pillow/OpenCV) need at runtime.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 libgl1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

ENV LOG_LEVEL=info
EXPOSE 8000

# Non-root runtime.
RUN useradd -m appuser
USER appuser

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
