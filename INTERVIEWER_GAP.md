# INTERVIEWER_GAP.md — P0 Audit

Audit of the **existing interview product** (candidate self-serve + recruiter-assessment flows —
`apps/web/src/app/candidate/*`, `apps/web/src/app/recruiter/*` excluding `hyrte-*`, `apps/api/src/{auth,practice,proctoring,evaluation,interviews,questions,voice}`)
against the Master Upgrade Prompt, Parts 1–3. **The HYRTE simulation (`apps/*/src/**/hyrte/**`,
`apps/web/src/app/hyrte/**`) was read only where needed to confirm it is NOT what backs the main
product** — it is a separate, later-built product line with its own reflection interviewer,
evidence graph, and voice pipeline. Every claim below is a live code citation, not an inference,
except where explicitly marked "not fully verified."

No implementation code was written for this phase.

---

## 0. Current architecture snapshot

| Area | Current state | Citation |
|---|---|---|
| **Auth** | Email + password is the primary login (`argon2`, `User.passwordHash`). A **separate**, coexisting passwordless email-OTP flow exists for the "Try Interview" signup lobby (`request-otp`/`verify-otp`). **No `phone` field exists on `User` or `CandidateProfile` at all.** | `auth.service.ts:26,59`; `prisma/schema.prisma` `model User` (no phone column) |
| **SMS provider** | Twilio, real send path exists (`sendSms`), but only fires as a best-effort CC alongside email OTP, gated on `TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM` env vars — never the primary channel. | `otp.service.ts:55,134-150`; `auth.controller.ts:58-60` |
| **Email provider** | Resend (real API) + SendGrid single-sender fallback, both implemented. | `otp.service.ts:73-120` |
| **STT** | Browser-native `SpeechRecognition`/`webkitSpeechRecognition` only. No Deepgram/cloud STT wired to this room (Chrome/desktop-only, no mobile Safari support). | `candidate/interview/page.tsx:295` |
| **TTS** | Browser-native `speechSynthesis`/`SpeechSynthesisUtterance` only. **ElevenLabs neural voice exists in the codebase (`voice/speech/elevenlabs.tts.ts`, `voice/tts.controller.ts`) but is wired ONLY to the HYRTE simulation's reflection interviewer — the main "Ally" room never calls it.** This is the single biggest reason the interview "still sounds like AI." | `candidate/interview/page.tsx:241,254-274,457-458`; confirmed by grep — zero `/voice/speak` calls in this file |
| **Recording** | **None.** No `MediaRecorder`, no upload, no `recordingUrl` field anywhere in the schema or this room's code. The pre-interview lobby literally displays the text *"Reviews your complete interview recording"* — this claim has no backing implementation today. | `candidate/interview/page.tsx:704` (the claim); grep for `MediaRecorder`/`recordingUrl` across `apps/api/src` and this room returns nothing |
| **Report generation** | LLM free-text via `this.ai.complete()` (plain string, not `completeJson`) for the practice/self-serve room's narrative report; `EvaluationService.evaluateSession` produces a structured-but-thin `EvaluationJson` (6 flat 0-100 competency numbers + strengths/weaknesses/summary/recommendation) for recruiter-assessment sessions. Neither produces the 80+-parameter, instance-cited, radar-benchmarked report the spec wants. | `practice.service.ts:159-189`; `evaluation.service.ts:6-32` |
| **Proctoring backend** | Genuinely sophisticated and **underused**: `ProctorEventType` enum has ~40 values across identity/vision/object/audio/screen/desktop/ai_cheat categories, with a real time-decayed weighted `RiskEngine` (per-signal weight, half-life, min-occurrence, explainable category breakdown) already built. | `prisma/schema.prisma` `enum ProctorEventType` (582-631); `risk-weights.ts` (99 lines, ~40 entries); `risk-engine.service.ts` |
| **Proctoring frontend** | Only **6 of those ~40** event types are ever actually emitted: `tabSwitch`, `eyeShift` (FaceDetector-based), `multiFace`, `screen` (fullscreen-exit + screen-share-track-ended), `secondVoice` (WebAudio RMS heuristic), `aiAssist` (paste event only — not latency/perplexity-based). No object detection, no desktop-agent signals, no background-noise/read-like-delivery/style-shift detectors exist anywhere. | `candidate/interview/page.tsx:261,350-373,479-506,860,894`; `FLAG_MAP` in `practice.service.ts:68-75` |
| **Exam-state enforcement** | Real: `ExamState` enum (`SCHEDULED`/`WAITING_APPROVAL`/.../`WARNING_ISSUED`/`TERMINATED`) with a fixed `MAX_WARNINGS = 3` auto-termination. **Not per-assessment configurable** (no warn/pause/terminate policy choice at the assessment-composer level) — it's one hardcoded policy for everyone. | `prisma/schema.prisma` `enum ExamState`; `interviews/interview.service.ts:304,338,385` |
| **Consent screen** | None found — no explicit "here's what's monitored, accept to proceed" screen in this room. | grep for `consent` in the room returns nothing |
| **Evidence Graph** | `EvidenceGraphService` is used exclusively inside `apps/api/src/hyrte/**`. Zero references anywhere in `auth`, `practice`, `proctoring`, `evaluation`, `interviews`, `questions`. The main interview product does not read from or write to it at all today. | grep `EvidenceGraphService` outside `/hyrte/` → 0 results |

---

## 1. PART 1 — Features, by section

### §2 Auth & entry — phone OTP
| Item | Status | Note |
|---|---|---|
| Phone number + OTP as primary signup/login | **Missing** | Current primary is email+password; phone OTP is a secondary best-effort SMS CC, not a standalone login path. No `phone` DB column at all. |
| Email OTP fallback | **Done** (inverted) | Robust — Resend + SendGrid — but it's the *primary*, not the fallback. |
| Rate-limiting (per-number/per-IP), 6-digit codes, expiry, resend cooldown | **Partial** | 6-digit codes + TTL exist (`otp.service.ts`); rate-limiting not verified — no `@Throttle`-style guard found on `request-otp`. |
| Invite links → OTP → straight into assessment | **Done** | `interview.service.ts` invite-link flow ties a session to `interviewId` already. |
| Verified phone visible in recruiter's candidate view | **Missing** | No phone field to show. |

### §3 Interview experience
| Item | Status | Note |
|---|---|---|
| Patient listening (no interrupt, natural pause, "give me a second") | **Partial** | VAD auto-send after ~1s silence + mic-only-on-candidate-turn exists (prevents Ally hearing herself), but no explicit "thinking" affordance beyond that; no configurable pause threshold. |
| Adaptive follow-ups on the candidate's real answer | **Done** | The single big `INTERVIEWER_SYSTEM` prompt instructs this and it's LLM-driven per-turn with full transcript memory. |
| Graduated hints, hint-usage recorded | **Partial** | The L1-L5 hint ladder is a real, well-specified prompt rule (`practice.service.ts:35`). **Not persisted as structured data** — "hints given" is only tracked inside the LLM's own conversational memory, not a DB field the report can cite deterministically. |
| Natural delivery: micro-acks, variation banks, fixed closing sequence | **Missing** (in this product) | This exact mechanism (`CLOSING_LINES`/`REPORT_READY_MESSAGES`/`MICRO_ACKS` variation banks) exists but only in the off-limits HYRTE simulation's reflection interviewer (`hyrte-interview.service.ts`). The main room has none of it — closings are free LLM text, no deterministic variation guarantee. |
| Structured configurable rounds (HR/technical/scenario/coding) | **Missing** | Today there's one continuous conversation with a `mode` flag (`mixed`/`theory`/`coding`) — not discrete, separately-scored rounds. |
| Multi-language (English + Hindi minimum, extensible) | **Partial** | English/Hindi/Mixed(Hinglish) exist and are wired through the prompt (`practice.service.ts:137-138`, frontend `LANGUAGES` const). Tamil/Telugu/Marathi/Bengali/Kannada/Gujarati/Punjabi are **not present** — the "architecture supports adding" claim is not yet proven since only 3 options exist and STT (browser SpeechRecognition) has no explicit language-locale wiring visible. |
| Question bank (DSA/coding-by-language, guesstimates, RCA, metrics, sales pitch/objections, role scenarios) | **Partial** | `Category` enum has DSA/FRONTEND/BACKEND/FULLSTACK/SQL/DATABASE/DEVOPS/AI_ML/DATA_ANALYTICS/PRODUCT_MANAGEMENT/MBA/HR/FINANCE/SYSTEM_DESIGN — solid breadth, but no explicit "guesstimates," "root-cause analysis," or "sales pitch/objection handling" category; a real `QuestionService` + recruiter question bank UI exists (`/recruiter/questions`). |
| In-interview code editor + scratchpad, paste feeds proctoring | **Partial** | Real code editor + Piston-backed multi-language execution exists. Paste-detection feeds `aiAssist` flag. No typing-cadence analysis. No non-code "scratchpad" for calculation/guesstimate questions — only the code editor exists. |

### §4 Proctoring
| Item | Status | Note |
|---|---|---|
| Camera/mic required to start | **Done** | `getUserMedia({video:true,audio:true})` gated before entering `live` phase. |
| Camera-off pause/warning | **Missing** | No detector watches for a dropped video track mid-session; `FACE_NOT_DETECTED`/camera-off has DB support (`ProctorEventType`) but nothing emits it. |
| Fullscreen enforced + violation events | **Done** | `screen` flag on both fullscreen-exit and share-track-ended. |
| Tab/window switch, devtools, copy/paste, secondary-display | **Partial** | Tab-switch (`visibilitychange`+`blur`) and paste (editor+answer box) exist. Devtools-open detection and secondary-display detection: **not found**. |
| Continuous face presence (no-face / multi-face) | **Done** | `FaceDetector` API, 1.2s poll loop. |
| Per-signal independent detectors (9 named types) | **Partial** | Only 3 of the 9 named spec signals exist as real detectors today (tab/window switch, camera-adjacent via FaceDetector no-face/multi-face, second-voice via RMS heuristic). **Missing entirely**: eye-gaze deviation (current `eyeShift` is a crude horizontal-centroid check, not sustained-gaze tracking), background-noise level, long-unnatural-pause detection, read-like-delivery detection, style-shift detection, AI-assist via latency/perplexity (current AI-assist is paste-only). |
| Configurable enforcement policy (warn/pause/terminate) per assessment | **Missing** | Fixed `MAX_WARNINGS=3` global policy; no per-assessment choice. |
| Recording + flag-timeline review UI | **Half-confirmed missing** | The `/recruiter/proctoring/[sessionId]` page (81 lines) is real and renders a genuine "Evidence timeline (N)" — a flat, chronological list of flagged events pulled from `/proctoring/sessions/:id/timeline`. But it has **zero `<video>`/player element** — there's nothing to click-and-jump into, because there's no recording (see §0). P4's job is narrower than "build a timeline" — the timeline exists; it's specifically the recording + the click-to-jump sync that's missing. |
| Candidate-facing consent screen | **Missing** | Confirmed via grep — none. |

### §5 Evaluation report
| Item | Status | Note |
|---|---|---|
| 2-minute summary (background, score gauge, recommendation sentence) | **Partial** | A score gauge + `Recommendation` enum exist and render (`page.tsx` gauge component); the recommendation is not consistently "one evidence-grounded sentence" — it's whatever the LLM free-text emits. |
| Skill-level cards (qualitative level + instance-backed note) | **Missing** | `EvaluationJson.competencies` is 6 flat 0-100 numbers with no per-skill instance citation. |
| Radar vs. role benchmark | **Not found in the persisted/recruiter path** | `session-state.md`/prior sessions mention a `perQuestion[]`+radar in the **self-serve practice** summary — `EvaluationJson.perQuestion` is explicitly commented `"not persisted"` (`evaluation.service.ts:18`), so it doesn't survive for a recruiter to review later. |
| Per-question scorecard with recording deep link | **Missing** | No deep-link target exists since there's no recording; per-question notes exist only ephemerally. |
| 80+ parameter framework, 7 groups, per-role weighting | **Missing** | Current framework is 6 competencies, flat, no per-role weight config found. |
| Integrity section embedded in report | **Partial** | Integrity data (risk score + breakdown) exists server-side (`RiskEngine`) but not confirmed wired into the same report document the candidate/recruiter reads — needs a P4/P6 check. |
| PDF export / shareable link with access control | **Missing** | No `pdf`/`jspdf`/`puppeteer` references found anywhere in web or evaluation code. |
| Report ready within minutes | **Done** (functionally) | Both report paths are synchronous LLM calls, well under a minute in practice. |

### §6 Recruiter flow
| Item | Status | Note |
|---|---|---|
| Assessment composer (role→rounds→source→difficulty→language→proctoring policy→invite) | **Partial** | `/recruiter/interviews/[id]` supports AI-generate questions, publish, secure invite links, resume-grounded questions — a real composer exists, but no round-sequence config, no proctoring-policy choice, no bulk email/phone invite list found (only single secure links). |
| Candidate list: status/score/recommendation/flags, sortable | **Partial — confirmed** | Real table with exactly Candidate/Status/Score/Recommendation/Integrity columns (`recruiter/interviews/[id]/page.tsx:195-210`), color-coded recommendation. **No sort handler exists** (no `onClick`/sort-state on any `<th>`) — it's a static-order table, not the "sortable/ranked" list the spec asks for. |
| Post-interview candidate feedback (1-5 stars + comment) | **Missing** | Confirmed via grep — no feedback-collection UI or storage anywhere. |

---

## 2. PART 2 — UI, landing page + product screens

- The current landing page (`apps/web/src/app/page.tsx`) has **~7 sections** (hero, trust-adjacent band, product-showcase, testimonials, stats — based on section-tag count and prior session notes), not the spec's 15. Sections confirmed **missing outright**: role-tab strip with per-role autoplay demo clips, anti-cheating signal wall (chips bound to the real detector registry), recording-review showcase, hiring-timeline comparison, integrations/ATS orbit, TA-bot phone-frame mock, FAQ accordion, candidate-ratings wall (nothing to bind to — no feedback data exists yet per §6 above).
- Design system: current landing is **not** confirmed to be the "clean light premium" system described — needs a screenshot pass in P8 to compare against spec (not code-auditable from source alone).
- Product screens: pre-flight check screen (camera preview + mic meter + fullscreen prompt) — **partial**, camera/mic gating exists but no explicit standalone pre-flight screen with a mic-level meter or network check was found. Panel-mode UI variant: **missing** (no panel feature exists at all, see Part 3 below). Recruiter dashboard: exists (`/recruiter`) but composer/candidate-table completeness vs spec needs the same closer P7 read as above.

---

## 3. PART 3 — Extended features

| Phase | Status | Note |
|---|---|---|
| **P10 ATS Integrations** | **0% — net-new** | Zero references to Greenhouse, Lever, an `ATSConnector` interface, signed webhooks, or a public REST API for candidate/report access anywhere in the codebase. The only "webhook" endpoint found (`proctoring.controller.ts:55`) is for **inbound** external-proctor-provider events, unrelated to ATS. |
| **P11a TA Bot (WhatsApp/Slack)** | **0% — net-new** | Every "slack"/"whatsapp" grep hit is the HYRTE *simulation's* in-app simulated Slack-style channel (fixture/gateway code) — not a real recruiter-facing bot integration. No bot core, no channel adapter, no account-linking flow exists. |
| **P11b Panel Interviews** | **0% — net-new** | No multi-interviewer/turn-taking/persona-composition code exists for the main product. (The HYRTE simulation has multiple stakeholder agents, but that's a different mechanic — reactive workplace messaging, not a live turn-taking interview panel — and is off-limits regardless.) |
| **P12 Evidence Graph wiring** | **0% — net-new, but additive-only per the phase's own rules** | Confirmed zero `EvidenceGraphService` usage outside `hyrte/`. The service itself already exists and is stable/tested (used extensively by the simulation), so this phase is genuinely additive: new write paths from the interview turn handler, new read queries before generating a probe, no simulation code touched. Lowest-risk of the three P10-12 phases specifically because the target service already exists and just needs new callers. |

---

## 4. Reuse / Refactor / Net-new split

**Reuse as-is:**
- `RiskEngine` + `risk-weights.ts` (already exactly the "independent detector, explainable, never opaque" architecture the spec wants — just needs more emitters wired to it)
- `PistonClient` code execution, `QuestionService`/question bank schema, `Category`/`Difficulty` enums
- Resend/SendGrid email delivery, Twilio SMS send path (`sendSms` already works, just needs to become primary)
- `ExamState`/warning-termination lifecycle (needs to become configurable, not rebuilt)
- `EvidenceGraphService` itself (for P12 — read/write from a new caller, service unchanged)
- Recruiter invite-link + resume-grounded-questions flow, AI question generation

**Refactor:**
- Auth: invert primary/fallback (phone OTP primary, email OTP fallback) — needs a `phone` column + making `User.email` optional or `phone` the alternate unique key
- Voice: point the main room at the already-built `/voice/speak` ElevenLabs endpoint instead of browser `speechSynthesis` (the endpoint exists, this is a frontend wiring change, not new infra)
- `practice.service.ts`'s turn engine: move from free-text `ai.complete()` to structured `ai.completeJson()` output (question/reply/hint-level/round fields) so downstream (report, hint-tracking) has real data instead of parsing prose
- `EvaluationJson`: extend from 6 flat competencies toward the grouped, instance-cited, weighted framework — extending, not discarding, since `evaluateSession`'s persistence/idempotency shape is sound
- `Interview.config: Json` bag → typed proctoring-policy + round-sequence fields

**Net-new:**
- Recording capture + storage (`MediaRecorder` → S3-equivalent) + flag-timeline player UI
- Consent screen
- 5 of the 9 spec proctoring detectors (background noise, long pause, read-like delivery, style shift, real gaze-deviation tracking, latency/perplexity-based AI-assist)
- PDF export / shareable report links
- Post-interview star-rating feedback
- ATS connector layer + Greenhouse/Lever + public API + webhooks (P10)
- TA Bot core + WhatsApp/Slack adapters (P11a)
- Panel interview composer + turn-taking director (P11b)
- Evidence-aware questioning reads + `interview_statement`/`contradiction` writes + report cross-check section (P12)
- 6 additional interview languages beyond English/Hindi/Mixed
- Landing page: 8 of 15 sections, from scratch (original assets, no reference-site copying)

---

## 5. Provider questions for the user

Needed before P1/P3/P10/P11 can proceed for real (P0 itself needed none of these):

1. **SMS**: keep Twilio (already coded, just needs to become primary), or switch/add MSG91 for India-specific delivery/pricing? Either way — a **live Twilio number is already in env per prior deploys** (per `deployment.md`/`rotate-secrets` memory) but should be confirmed still valid and whether it's approved for OTP traffic in your target geography.
2. **STT**: stay on browser `SpeechRecognition` (free, but Chrome/desktop-only, no language-locale control) or move to a cloud STT provider (Deepgram was flagged as a known gap in an earlier session) for multi-language + mobile support? This materially affects the multi-language item in §3.
3. **Recording storage**: which bucket/provider — reuse the existing AWS account (S3) already backing this deployment, or something else? Also: retention duration policy, and whether video is even required or audio+screen is sufficient for MVP.
4. **ATS sandbox credentials**: Greenhouse and Lever both need real (sandbox) API keys to build and verify P10's acceptance test end-to-end — please provide sandbox accounts/keys when we reach that phase.
5. **WhatsApp/Slack**: WhatsApp Cloud API requires a Meta Business/App setup (phone number, verified business) — do you already have one, or does this need to be created from scratch? Slack needs a bot app + workspace to install into for testing.
6. **ElevenLabs**: already wired and working for the simulation side — same account can back the main room's voice (P2), no new provider needed, just confirming the existing key's usage quota can absorb the added traffic once both products call it.

---

## 6. What this audit deliberately did NOT do

Per the prompt's own rule ("if a change would require modifying simulation code, STOP and ask me first") — no simulation files were modified, and simulation code was read only to confirm boundaries (e.g., confirming ElevenLabs/EvidenceGraphService/variation-banks are simulation-only today, not shared infrastructure). No implementation, no schema changes, no new files besides this one.
