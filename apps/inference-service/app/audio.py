"""Audio detectors.

Real inference plugs in behind ``AudioBackend``: WebRTC VAD + speaker
diarization (e.g. pyannote) to distinguish the candidate from an additional
voice, whispering, or synthetic/AI audio. The heuristic fallback uses framed
RMS energy to flag conversational turn-taking patterns and anomalies so the
service runs without heavy models in dev.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np

logger = logging.getLogger("inference.audio")


@dataclass
class AudioDetection:
    type: str
    severity: str
    payload: dict


class AudioService:
    def __init__(self, sample_rate: int = 16_000) -> None:
        self.sample_rate = sample_rate
        self._vad = None
        try:
            import webrtcvad  # type: ignore

            self._vad = webrtcvad.Vad(2)
            logger.info("WebRTC VAD loaded")
        except Exception:  # pragma: no cover - optional dep
            logger.info("WebRTC VAD not available; using energy heuristic")

    def analyze(self, pcm_bytes: bytes) -> list[AudioDetection]:
        """pcm_bytes: mono 16-bit little-endian PCM at ``sample_rate``."""
        if len(pcm_bytes) < 2:
            return []
        samples = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32)
        if samples.size == 0:
            return []

        # Frame into 30ms windows and compute normalized RMS energy.
        frame_len = int(self.sample_rate * 0.03)
        if frame_len == 0:
            return []
        n_frames = samples.size // frame_len
        if n_frames == 0:
            return []
        frames = samples[: n_frames * frame_len].reshape(n_frames, frame_len)
        rms = np.sqrt((frames**2).mean(axis=1)) / 32768.0

        speech = rms > 0.04  # frame is "speech" above this energy
        transitions = int(np.sum(speech[1:] != speech[:-1]))
        speech_ratio = float(speech.mean())

        detections: list[AudioDetection] = []

        # Many silence↔speech transitions with substantial speech suggests
        # back-and-forth conversation (a second person interacting).
        if transitions >= 6 and speech_ratio > 0.35:
            detections.append(
                AudioDetection(
                    "AUDIO_EXTERNAL_CONVERSATION",
                    "MEDIUM",
                    {"transitions": transitions, "speechRatio": round(speech_ratio, 2)},
                )
            )

        # Low but non-trivial sustained energy → possible whispering.
        whisper = np.logical_and(rms > 0.01, rms < 0.03)
        if float(whisper.mean()) > 0.5:
            detections.append(AudioDetection("AUDIO_WHISPERING", "LOW", {}))

        return detections


audio_service = AudioService()
