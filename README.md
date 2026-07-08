# InterviewAI

AI-powered interview & assessment platform with a **Zero-Trust proctoring engine**.
Runs autonomous voice/video/coding interviews, evaluates candidates with an AI
engine, and protects candidates from false positives with an explainable,
weighted risk model. Designed as a **modular monolith that splits cleanly into
microservices**, and to scale toward 100k+ concurrent users.

> **Status — read this first.** This repository is a **production-grade
> foundation**, not a finished commercial product. The architecture, data model,
> core services, security model, and infrastructure are real and coherent. The
> heavy ML components (vision/audio inference models, the Electron native agent)
> and some portal pages are defined as **clear service contracts + docs** rather
> than trained models — those are multi-team efforts. The
> ["What's built vs. scaffolded"](#whats-built-vs-scaffolded) table below is an
> honest map so nothing is oversold.

## Tech stack

| Layer     | Choices |
|-----------|---------|
| Frontend  | Next.js 15 (App Router), TypeScript, Tailwind, Zustand, React Query |
| Backend   | NestJS 11, Prisma 6, PostgreSQL 16 (+ read replica), Redis, Kafka |
| AI        | OpenAI, Claude, Gemini, DeepSeek, Groq — behind one router with fallback |
| Speech    | Deepgram / AssemblyAI / OpenAI Realtime (STT); ElevenLabs / Cartesia / OpenAI (TTS) — via interfaces |
| Infra     | Docker, Kubernetes (EKS), Terraform, CloudFront, S3, Prometheus/Grafana, OTel |

## Monorepo layout

```
interviewai/
├── apps/
│   ├── api/                      # NestJS API (modular monolith)
│   │   └── src/
│   │       ├── admin/            # Super-admin: users, companies, audit, security
│   │       ├── ai/               # Multi-provider AI router (+ fallback, JSON mode)
│   │       ├── analytics/        # Org funnel/score analytics, candidate progress
│   │       ├── auth/             # JWT + refresh rotation, RBAC, registration
│   │       ├── billing/          # Stripe checkout + webhook + plan lifecycle
│   │       ├── coding/           # DSA execution engine (Judge0) + plagiarism
│   │       ├── common/           # Guards, decorators, filters, audit
│   │       ├── evaluation/       # AI evaluation engine → scores + recommendation
│   │       ├── interviews/       # Interview authoring + exam lifecycle & security
│   │       ├── notifications/    # Redis pub/sub recruiter alerts
│   │       ├── proctoring/       # Zero-Trust engine: risk engine + warnings
│   │       ├── questions/        # Question CRUD, generation, moderation
│   │       │   └── aggregator/   # License-compliant ingestion pipeline
│   │       ├── users/            # Profile / resume
│   │       └── voice/            # AI voice interviewer: follow-up engine, WS gateway, speech IF
│   ├── web/                      # Next.js frontend (candidate/recruiter/admin)
│   │   └── src/lib/              # proctoring.ts (browser SDK), voice.ts (WS voice client)
│   ├── desktop-agent/            # Electron Zero-Trust native monitoring agent
│   └── inference-service/        # Python/FastAPI vision & audio ML → signed events
├── prisma/schema.prisma          # Full data model (single source of truth)
├── infra/
│   ├── k8s/                      # Deployments, HPA, PDB, Ingress, Config/Secrets
│   ├── terraform/                # EKS, RDS (Multi-AZ + replica), Redis, S3
│   └── monitoring/               # Prometheus/Grafana values + SLO alerts
├── .github/workflows/ci.yml      # Lint → Test → Security → Build → Deploy
├── docker-compose.yml            # Full local stack
└── docs/                         # Architecture, deployment, proctoring, voice
```

## Quickstart (local)

```bash
cp .env.example .env            # fill in at least one AI provider key (optional)
docker compose up -d postgres redis minio   # infra only
npm install
npm run db:generate
npm run db:migrate              # creates the schema
npm run db:seed                 # demo org + users + sample questions
npm run dev                     # api on :4000, web on :3000
```

Or boot everything in containers: `docker compose up -d --build`.

- Web: http://localhost:3000
- API docs (Swagger): http://localhost:4000/api/docs
- Demo logins (from seed): `recruiter@demo.co` / `candidate@demo.co` — password `Password123!`

## What's built vs. scaffolded

| Area | Status |
|------|--------|
| Data model (24+ tables: users, orgs, questions, licenses, interviews, sessions, evaluations, proctoring, warnings, risk, billing, audit) | ✅ Complete, validated |
| Auth: JWT access + rotating refresh, Argon2, RBAC guard, global auth | ✅ Complete |
| AI router (5 providers, ordered fallback, strict-JSON helper) | ✅ Complete |
| Evaluation engine (competency scores + hire recommendation) | ✅ Complete |
| Question service (CRUD, AI generation, user submission + moderation) | ✅ Complete |
| **License-compliant aggregator** (fetch→validate→normalize→dedupe→categorize→variations→store) | ✅ Complete |
| Interview authoring + **exam security** (admin-gated start, one-time tokens, identity gate, admin override) | ✅ Complete |
| **Zero-Trust proctoring**: weighted, time-decaying risk engine + 3-strike warnings + auto-termination | ✅ Complete |
| Voice interviewer: follow-up engine + adaptive difficulty (turn orchestration) | ✅ Complete |
| Voice realtime **WebSocket gateway** (start/turn/proctoring-notice protocol, JWT-auth) | ✅ Complete |
| **DSA execution engine** (Judge0 client, test-case grading, structural plagiarism detection → risk signal) | ✅ Complete |
| Speech STT/TTS adapters (**Deepgram** streaming STT, **ElevenLabs** streaming TTS) | ✅ Complete |
| Billing (**Stripe** checkout + signature-verified webhook + plan lifecycle) | ✅ Complete |
| Analytics (org funnel/score mix, candidate progress) + **Super-admin** service (users, companies, audit, security) | ✅ Complete |
| Frontend: landing, auth, candidate/recruiter/**admin** portals, live proctoring, coding IDE, resume, question bank, billing, dark mode | ✅ Complete |
| Browser proctoring SDK (tab/focus/fullscreen/copy-paste/face-presence) + **interview room** (webcam, identity gate, one-time token start, live risk) | ✅ Complete |
| **Electron desktop agent** (process scan → remote-access/overlay/screen-record denylists, clipboard, HMAC-signed webhook, transparent status window) | ✅ Complete |
| **Vision/audio inference service** (FastAPI: face-count/object/voice detection behind MediaPipe/YOLO/VAD interfaces + heuristic fallback → signed events) | ✅ Complete (real trained models are opt-in deps) |
| **Browser voice interview** (Web Speech STT + WS voice gateway + TTS playback, live transcript) | ✅ Complete |
| Trained ML model weights (deepfake/liveness classifiers, YOLO fine-tune) | 🟡 Pluggable — `pip install` the backends; no code changes |
| Docker, K8s (HPA/PDB/Ingress), Terraform, CI/CD, monitoring | ✅ Complete |

## Question sources — compliance by construction

The aggregator enforces the **Question Sources Policy**: only MIT / Apache-2.0 /
BSD / CC-BY / CC0 / owned / user-granted / AI-generated content can enter the
corpus. A denylist hard-blocks known proprietary hosts (LeetCode, InterviewBit,
GeeksforGeeks, HackerRank, Coursera, Udemy). Nothing is stored until it clears
the license gate — see `apps/api/src/questions/aggregator/license-validator.ts`.

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system design, diagram, scaling to 100k
- [`docs/PROCTORING.md`](docs/PROCTORING.md) — Zero-Trust engine, weighted risk, exam security
- [`docs/VOICE_INTERVIEW.md`](docs/VOICE_INTERVIEW.md) — realtime voice architecture
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — AWS/EKS deployment guide
- [`docs/PROVISIONING.md`](docs/PROVISIONING.md) — **every account/service/key you need to go live**, with costs
