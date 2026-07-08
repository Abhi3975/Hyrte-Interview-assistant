# Zero-Trust Proctoring Engine

## Philosophy: evidence, never accusation

The engine **never automatically accuses** a candidate. It produces a **risk
score**, a **cheating probability**, a **confidence score**, and an immutable
**evidence trail**. Humans decide; admins can reset/override. Auto-termination
exists only as a hard backstop and is fully logged and reversible by an admin.

## Weighted, time-decaying risk (why false positives are rare)

A naive "terminate on any violation" model punishes legitimate candidates for
poor lighting or a one-off glance. Instead every signal has a **weight**, a
**decay half-life**, and a **minimum-occurrence gate** (`risk-weights.ts`):

- A brief `FACE_NOT_DETECTED` is weight 8, decays with a 45s half-life, and must
  occur **3×** in the window before it counts at all → a lighting blip is ignored.
- A `MULTIPLE_FACES`, `OBJECT_PHONE`, or `REMOTE_ACCESS_TOOL` is high weight
  (45–65), decays slowly (10–60 min), and counts on the **first** occurrence.

The `RiskEngine` (`risk-engine.service.ts`) then:

1. Groups events by type and drops any below its occurrence gate (noise filter).
2. Sums time-decayed, severity-scaled weights per signal, with **diminishing
   returns** so dozens of tiny events can't bury a candidate.
3. Combines category contributions with soft saturation → a 0–100 risk score.
4. Derives cheating probability (logistic, centered ~60) and a confidence score
   that grows with corroborating evidence.
5. Returns an explainable `breakdown` + `topSignals`.

This is deterministic and I/O-free — trivially unit-testable.

## Warning system & auto-termination (3 strikes)

Warnings escalate on **weighted risk crossing thresholds** `[40, 70, 90]`, not
on raw event counts — reconciling the fixed 3-strike policy with the
false-positive-resistant model:

| Risk crosses | Warning | Action |
|--------------|---------|--------|
| ≥ 40 | L1 | Candidate popup, event logged, screenshot + webcam snapshot stored |
| ≥ 70 | L2 | Final warning, **recruiter notified**, incident added to risk |
| ≥ 90 | L3 | **Auto-terminate**: lock session, disable submission, upload evidence, generate report, disqualify, instant recruiter alert |

All handled in `proctoring.service.ts`. Warnings and events are **append-only**.

## Signal taxonomy

Identity (face match, liveness, spoof, deepfake), Vision (missing/multiple/
covered face, gaze), Object (phone, secondary laptop, notes, headphones, extra
monitor), Audio (additional voice, whispering, external conversation, AI audio),
Screen (tab/window/focus, fullscreen exit, screen-share/record tools), Desktop
agent (suspicious process/extension, overlay app, remote-access, clipboard,
capture attempts), AI-cheating (rapid answers, AI-like responses, copy-paste,
unnatural typing, external assistance, plagiarism). See `ProctorEventType`.

## Exam security & admin control

- Candidates **cannot self-start**. An admin/recruiter unlocks the assessment,
  which mints a **single-use, time-boxed session token** (only its hash stored).
- The candidate must **pass identity verification** before the session goes
  `ACTIVE`. The token is consumed on start.
- States: `SCHEDULED → WAITING_APPROVAL → ACTIVE → WARNING_ISSUED → SUSPENDED →
  TERMINATED → COMPLETED`.
- Admin override: reset warnings, reopen a terminated session, extend time,
  approve retest — each written to the audit log.

## Integration for external proctor providers

A third-party vision/audio vendor or the Electron agent backend pushes events to
`POST /api/proctoring/webhook`, authenticated by **HMAC-SHA256** over the raw
body (`PROCTOR_WEBHOOK_SECRET`, constant-time compare). Web/Electron clients with
a candidate JWT use `POST /api/proctoring/events` (or `/events/batch` for
high-frequency telemetry). Live scores/warnings fan out over the Redis channel
`proctoring:<sessionId>` to the recruiter dashboard.

## What is external

The actual **ML inference** (face detection, object detection, deepfake/liveness,
voice-anomaly) runs in dedicated `vision-svc` / `audio-svc` services (or a vendor)
that emit `ProctorEvent`s. The Electron agent's native OS monitoring likewise
emits events. This engine is the **scoring, policy, and evidence brain** they
feed — kept model-agnostic so detectors can be swapped or upgraded independently.
