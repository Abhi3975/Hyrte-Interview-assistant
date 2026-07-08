# Architecture

## Overview

InterviewAI is a **modular monolith** today — one NestJS process with strict
module boundaries — deployed as a horizontally-scaled service behind an ALB +
CloudFront. Every module (`auth`, `questions`, `interviews`, `evaluation`,
`proctoring`, `voice`, `billing`) owns its domain and talks to others only
through services, so any module can be extracted into a standalone microservice
with its own database when a specific bottleneck demands it. This is the
pragmatic path: microservice-*ready* without paying microservice tax before
product-market fit.

## System diagram

```
                          ┌──────────────┐
                          │  CloudFront  │  (CDN / edge cache / TLS)
                          └──────┬───────┘
                                 │
                          ┌──────▼───────┐
                          │   ALB / WAF  │  (sticky sessions for WS)
                          └──────┬───────┘
              ┌──────────────────┼───────────────────┐
              │                  │                    │
       ┌──────▼─────┐     ┌──────▼──────┐      ┌──────▼───────┐
       │  web (N)   │     │   api (N)   │      │ voice-ws (N) │
       │ Next.js    │     │  NestJS     │      │ realtime GW  │
       └────────────┘     └──┬───┬───┬──┘      └──────┬───────┘
                             │   │   │                │
        ┌────────────────────┘   │   └────────────┐   │
        │                        │                │   │
 ┌──────▼──────┐        ┌────────▼───────┐  ┌─────▼───▼─────┐
 │ PostgreSQL  │        │  Redis Cluster │  │     Kafka     │
 │ primary +   │        │ cache/pubsub/  │  │ proctoring &  │
 │ read replica│        │ queues/ratelimit│ │ analytics bus │
 └─────────────┘        └────────────────┘  └───────┬───────┘
                                                     │
                             ┌───────────────────────┼───────────────┐
                             │                       │               │
                      ┌──────▼─────┐         ┌────────▼──────┐ ┌──────▼──────┐
                      │ vision svc │         │  audio svc    │ │ analytics   │
                      │ (face/obj/ │         │ (voice/whisper│ │ consumer    │
                      │  deepfake) │         │  detection)   │ │ → warehouse │
                      └────────────┘         └───────────────┘ └─────────────┘

  External integrations: AI providers (OpenAI/Claude/Gemini/DeepSeek/Groq),
  STT/TTS vendors, Stripe (billing), S3 (resumes/recordings/evidence),
  external proctor providers (signed webhook → /api/proctoring/webhook).
```

## Request & auth flow

1. Browser calls `/api/*` (Next rewrite → API).
2. `JwtAuthGuard` (global) verifies the access token unless `@Public()`.
3. `RolesGuard` enforces RBAC per route; `SUPER_ADMIN` bypasses.
4. `ThrottlerGuard` rate-limits per IP (120/min default).
5. Mutations write an `AuditLog` entry (append-only).
6. Access tokens are short-lived (15m); refresh tokens rotate on every use and
   are stored only as SHA-256 hashes.

## Data model

`prisma/schema.prisma` is the single source of truth. Key aggregates:

- **Identity**: `Organization`, `User`, `Membership` (multi-tenant, multi-role), `RefreshToken`.
- **Questions**: `Question` (+ `contentHash` for dedupe, `source`, `moderation`),
  `License` (provenance + attribution), `TestCase`, `QuestionSet`.
- **Interviews**: `Interview`, `InterviewQuestion`, `InterviewSession`
  (exam lifecycle + one-time token + warning count), `Answer`.
- **Evaluation**: `Evaluation` (competency map + recommendation).
- **Proctoring**: `ProctorEvent` (immutable evidence), `Warning` (immutable,
  3-strike), `RiskAssessment` (live weighted score + breakdown).
- **Billing/compliance**: `Subscription`, `AuditLog`.

## Scaling to 100k concurrent users

| Concern | Approach |
|---------|----------|
| Stateless API | No in-process session state → scale `api` pods horizontally (HPA 3→60). |
| DB reads | Read replica via `prisma.reader` for search/analytics/dashboards. |
| DB writes | Connection pooling (PgBouncer); partition high-volume `proctor_events` by month. |
| Hot paths | Redis for cache, rate-limit counters, and pub/sub fan-out across pods. |
| Realtime | Voice/proctoring sockets on a dedicated gateway tier; sticky sessions at ALB. |
| Event floods | High-frequency telemetry (mouse/typing/vision frames) is sampled & aggregated **client-side**, batched to `/proctoring/events/batch`, and streamed through **Kafka** to decouple ingestion from scoring. We do not persist every mouse move — we persist derived signals + evidence. |
| Media | Recordings/screenshots go straight to S3 (presigned uploads); only keys hit the DB. |
| Edge | CloudFront caches static assets; API stays dynamic. |
| Cost | Spot node pool for burst interview windows; scale-to-zero on the burst group. |

## Security (OWASP baseline)

- Helmet headers, strict CORS allowlist, global input validation (`whitelist` +
  `forbidNonWhitelisted`).
- Argon2id password hashing; JWT with rotating refresh tokens.
- RBAC on every mutating route; org-scoping enforced in services (a recruiter
  can only touch their org's interviews/sessions).
- Rate limiting (Redis-backed throttler).
- Signed webhooks (HMAC-SHA256, constant-time compare) for external proctors.
- Append-only `AuditLog`; immutable `ProctorEvent` / `Warning` records.
- Secrets via K8s Secrets sourced from AWS Secrets Manager (never committed).
