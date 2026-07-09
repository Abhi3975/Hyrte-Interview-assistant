"""Vision detectors.

Real inference plugs in behind the ``VisionBackend`` protocol: MediaPipe or a
face-detection model for face count/liveness, YOLO for object detection (phone,
secondary laptop, book, headphones, extra monitor). When no model backend is
installed the service degrades to conservative brightness/variance heuristics so
it always runs in dev — but production ships the real models.

Every detector returns a list of ``Detection`` tuples that the API layer maps to
``ProctorEventType`` values and emits to the backend risk engine.
"""

from __future__ import annotations

import io
import logging
from dataclasses import dataclass
from typing import Protocol

import numpy as np
from PIL import Image

from .config import settings

logger = logging.getLogger("inference.vision")


@dataclass
class Detection:
    type: str
    severity: str
    payload: dict


class VisionBackend(Protocol):
    def face_count(self, image: np.ndarray) -> int: ...
    def objects(self, image: np.ndarray) -> list[tuple[str, float]]: ...


# ── Optional real backend (loaded lazily; falls back if unavailable) ──

class _ModelBackend:
    """Wraps MediaPipe (faces) + YOLO (objects) when the packages are present."""

    def __init__(self) -> None:
        self._face = None
        self._yolo = None
        try:
            import mediapipe as mp  # type: ignore

            self._face = mp.solutions.face_detection.FaceDetection(
                min_detection_confidence=settings.face_confidence
            )
            logger.info("MediaPipe face detection loaded")
        except Exception:  # pragma: no cover - optional dep
            logger.info("MediaPipe not available; using heuristic face check")

        try:
            from ultralytics import YOLO  # type: ignore

            self._yolo = YOLO("yolov8n.pt")
            logger.info("YOLOv8 object detection loaded")
        except Exception:  # pragma: no cover - optional dep
            logger.info("YOLO not available; object detection disabled")

    def face_count(self, image: np.ndarray) -> int:
        if self._face is not None:
            result = self._face.process(image)
            return len(result.detections) if result.detections else 0
        return _heuristic_face_count(image)

    def objects(self, image: np.ndarray) -> list[tuple[str, float]]:
        if self._yolo is None:
            return []
        out: list[tuple[str, float]] = []
        for r in self._yolo(image, verbose=False):
            for box in r.boxes:
                conf = float(box.conf[0])
                if conf < settings.object_confidence:
                    continue
                label = r.names[int(box.cls[0])]
                out.append((label, conf))
        return out


def _heuristic_face_count(image: np.ndarray) -> int:
    """Fallback: a very dark or near-uniform frame implies no visible face.

    This intentionally cannot count multiple faces — it only distinguishes
    "someone is likely present" from "frame is empty/covered", so it never
    fabricates a MULTIPLE_FACES signal it can't justify.
    """
    gray = image.mean(axis=2) if image.ndim == 3 else image
    brightness = float(gray.mean())
    variance = float(gray.var())
    if brightness < 25 or variance < 60:
        return 0
    return 1


# COCO labels of interest → our object event types.
_OBJECT_MAP = {
    "cell phone": ("OBJECT_PHONE", "HIGH"),
    "laptop": ("OBJECT_SECONDARY_LAPTOP", "HIGH"),
    "book": ("OBJECT_BOOK_NOTES", "MEDIUM"),
    "tv": ("OBJECT_ADDITIONAL_MONITOR", "MEDIUM"),
    "remote": ("OBJECT_ADDITIONAL_MONITOR", "LOW"),
}


class VisionService:
    def __init__(self) -> None:
        self._backend: VisionBackend = _ModelBackend()

    def analyze(self, image_bytes: bytes) -> list[Detection]:
        image = self._decode(image_bytes)
        detections: list[Detection] = []

        faces = self._backend.face_count(image)
        if faces == 0:
            detections.append(Detection("FACE_NOT_DETECTED", "LOW", {}))
        elif faces > 1:
            detections.append(Detection("MULTIPLE_FACES", "HIGH", {"count": faces}))

        for label, conf in self._backend.objects(image):
            mapped = _OBJECT_MAP.get(label)
            if mapped:
                etype, severity = mapped
                detections.append(Detection(etype, severity, {"label": label, "confidence": round(conf, 2)}))

        return detections

    @staticmethod
    def _decode(image_bytes: bytes) -> np.ndarray:
        with Image.open(io.BytesIO(image_bytes)) as img:
            return np.asarray(img.convert("RGB"))


vision_service = VisionService()
