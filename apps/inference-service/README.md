# InterviewAI Inference Service

Python/FastAPI service that runs the **heavy vision & audio ML** the browser and
Node backend deliberately don't: face count / liveness, object detection (phone,
laptop, book, extra monitor), and voice analysis (additional voice, whispering,
external conversation). It emits **signed** proctor events to the backend risk
engine over the same zero-trust webhook contract as the Electron agent.

## Design

```
 exam client / media relay
        │ frames (JPEG)          │ audio chunks (PCM16)
        ▼                        ▼
 POST /v1/vision/frame     POST /v1/audio/chunk
        │                        │
   vision.py                 audio.py     (real models plug in behind interfaces)
        └──────────┬─────────────┘
                   ▼
             emitter.py  ── HMAC-signed ──► POST /api/proctoring/webhook
```

- **Model-agnostic**: real inference plugs in behind `VisionBackend` /
  `AudioService` — MediaPipe/YOLO for vision, WebRTC-VAD + diarization for audio.
  Uncomment the optional deps in `requirements.txt` to enable them.
- **Runs without models**: conservative heuristics keep the service functional in
  dev; the fallback never fabricates signals it can't justify (e.g. it won't
  report MULTIPLE_FACES without a real detector).
- **Stateless & scalable**: N replicas behind a load balancer, scale on GPU/CPU.

## Run

```bash
cd apps/inference-service
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
INTERVIEWAI_API=http://localhost:4000 \
PROCTOR_WEBHOOK_SECRET=<same-as-backend> \
uvicorn app.main:app --reload --port 8000
```

Docs at http://localhost:8000/docs.

## Enabling real models

```bash
pip install mediapipe ultralytics onnxruntime webrtcvad
```

MediaPipe → accurate multi-face counting; YOLOv8 → object detection; ONNX →
liveness/deepfake classifiers; WebRTC-VAD → precise voice activity. No code
changes needed — the backends load automatically when importable.
