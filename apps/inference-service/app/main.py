"""InterviewAI vision/audio inference service.

Receives webcam frames and audio chunks from the exam client (or a media
relay), runs detection, and emits signed proctor events to the backend risk
engine. Stateless and horizontally scalable — put N replicas behind a load
balancer and scale on GPU/CPU utilization.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Form, UploadFile
from pydantic import BaseModel

from .audio import audio_service
from .config import settings
from .emitter import emitter
from .vision import vision_service

logging.basicConfig(level=settings.log_level.upper())
logger = logging.getLogger("inference")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    logger.info("Inference service starting (vision=%s audio=%s)", settings.enable_vision, settings.enable_audio)
    yield
    await emitter.aclose()


app = FastAPI(title="InterviewAI Inference Service", version="0.1.0", lifespan=lifespan)


class AnalyzeResult(BaseModel):
    detections: list[dict]
    emitted: int


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "vision": settings.enable_vision, "audio": settings.enable_audio}


@app.post("/v1/vision/frame", response_model=AnalyzeResult)
async def analyze_frame(session_id: str = Form(...), frame: UploadFile = File(...)) -> AnalyzeResult:
    """Analyze a single webcam frame (JPEG/PNG) and emit any detections."""
    if not settings.enable_vision:
        return AnalyzeResult(detections=[], emitted=0)

    image_bytes = await frame.read()
    detections = vision_service.analyze(image_bytes)

    emitted = 0
    for d in detections:
        ok = await emitter.emit(session_id, d.type, d.severity, d.payload)
        emitted += 1 if ok else 0

    return AnalyzeResult(
        detections=[{"type": d.type, "severity": d.severity, **d.payload} for d in detections],
        emitted=emitted,
    )


@app.post("/v1/audio/chunk", response_model=AnalyzeResult)
async def analyze_audio(session_id: str = Form(...), chunk: UploadFile = File(...)) -> AnalyzeResult:
    """Analyze a mono 16-bit PCM audio chunk and emit any detections."""
    if not settings.enable_audio:
        return AnalyzeResult(detections=[], emitted=0)

    pcm = await chunk.read()
    detections = audio_service.analyze(pcm)

    emitted = 0
    for d in detections:
        ok = await emitter.emit(session_id, d.type, d.severity, d.payload)
        emitted += 1 if ok else 0

    return AnalyzeResult(
        detections=[{"type": d.type, "severity": d.severity, **d.payload} for d in detections],
        emitted=emitted,
    )
