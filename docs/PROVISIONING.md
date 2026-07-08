# Provisioning Guide — what you need to run InterviewAI for real

The platform **degrades gracefully**: with nothing configured it still boots
(auth, questions, interviews, evaluation stubs). Each capability lights up as
you add its credential. This guide lists every external account/service, the
env var it maps to, whether it's required, and rough cost at two scales.

Legend: **[REQ]** required to run · **[REC]** recommended · **[OPT]** optional / feature-gated.

---

## 1. AI model providers (the brain)

You need **at least one**. The AI router auto-fails-over across whatever is set.

| Provider | Env var | Use | Notes |
|----------|---------|-----|-------|
| OpenAI **[REC]** | `OPENAI_API_KEY` | Evaluation, question gen, follow-ups | Best all-round default |
| Anthropic (Claude) **[REC]** | `ANTHROPIC_API_KEY` | Voice follow-up engine, nuanced eval | Router pins Claude for conversation |
| Google Gemini **[OPT]** | `GEMINI_API_KEY` | Fallback / cost | |
| DeepSeek **[OPT]** | `DEEPSEEK_API_KEY` | Cheap coding eval | |
| Groq **[OPT]** | `GROQ_API_KEY` | Ultra-low-latency fallback | |

Set `AI_DEFAULT_PROVIDER` / `AI_DEFAULT_MODEL`.
**Cost:** usage-based. ~$0.01–0.05 per evaluation. Budget **$50–300/mo** at low
volume; scales linearly. Consider **Vercel AI Gateway** for one key + spend caps.

---

## 2. Speech — for the AI **voice** interview

| Service | Env var | Use | Free-key fallback |
|---------|---------|-----|-------------------|
| **Deepgram** [REC for voice] | `DEEPGRAM_API_KEY` | Streaming speech-to-text | Browser Web Speech API works with no key |
| **ElevenLabs** [REC for voice] | `ELEVENLABS_API_KEY` | Natural text-to-speech | Browser SpeechSynthesis works with no key |
| (alt) AssemblyAI / Cartesia / OpenAI Realtime | — | STT/TTS alternatives | swap the adapter |

**Cost:** Deepgram ~$0.0043/min; ElevenLabs from **$5–99/mo** + usage. For 1,000
30-min interviews/mo budget **~$200–500/mo**. Voice works without these keys via
the browser (lower quality) — good enough for a demo/MVP.

---

## 3. Database — PostgreSQL **[REQ]**

| Option | Env var | Notes |
|--------|---------|-------|
| AWS **RDS Postgres** (Multi-AZ) | `DATABASE_URL`, `DATABASE_REPLICA_URL` | Production default; Terraform provisions it |
| **Neon** (serverless, Vercel Marketplace) | same | Easiest to start; scales to zero |
| Supabase | same | Alt managed Postgres |

Add a **read replica** (`DATABASE_REPLICA_URL`) — analytics/search/dashboards
already route to it. Use **PgBouncer** for pooling at scale.
**Cost:** dev ~$0 (Neon free) · prod RDS Multi-AZ `db.r6g.large` **~$400–600/mo**.

---

## 4. Redis — cache / queues / pub-sub **[REQ]**

| Option | Env var |
|--------|---------|
| AWS **ElastiCache** (cluster mode) | `REDIS_URL` |
| **Upstash** (serverless, Vercel Marketplace) | `REDIS_URL` |

Powers rate-limiting, notifications, and live proctoring fan-out.
**Cost:** dev ~$0 (Upstash free) · prod cluster **~$150–400/mo**.

---

## 5. Kafka — event backbone **[REC at scale]**

For high-volume proctoring/analytics ingestion decoupling. Not required for MVP
(events write straight to Postgres/Redis under moderate load).

| Option | Notes |
|--------|-------|
| AWS **MSK** | Managed Kafka |
| **Redpanda Cloud** / Confluent | Kafka-compatible, simpler |

**Cost:** from **~$100–500/mo**. Skip for MVP.

---

## 6. Object storage — resumes, recordings, evidence **[REQ for media]**

| Option | Env vars |
|--------|----------|
| AWS **S3** | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| **Cloudflare R2** | same (S3-compatible, **no egress fees**) |
| MinIO (local/dev) | provided in docker-compose |

**Cost:** S3 ~$0.023/GB; R2 cheaper for serving. Budget **$10–100/mo**.

---

## 7. CDN + DNS + WAF

| Option | Use |
|--------|-----|
| **Cloudflare** [REC] | DNS, CDN, WAF/DDoS, R2. Cheapest edge + best DDoS. Pro **$20/mo** |
| **AWS CloudFront** | CDN (referenced in the K8s ingress) + ACM TLS |
| **Vercel** | If you host the Next.js `web` app there, CDN/edge is built in |

You need **one domain** (e.g. Namecheap/Cloudflare Registrar, ~$12/yr) and TLS
(free via Cloudflare or AWS ACM).

---

## 8. Code execution — DSA sandbox **[REQ for coding rounds]**

Self-host **Judge0** (in docker-compose already) on an isolated node/cluster —
it runs untrusted candidate code, so keep it network-isolated.

| Env var | Value |
|---------|-------|
| `CODE_EXEC_URL` | your Judge0 URL |
| `CODE_EXEC_TOKEN` | optional auth token |

**Cost:** one small VM **~$20–40/mo**, or use a hosted Judge0 (RapidAPI) for MVP.

---

## 9. Billing — **Stripe** **[OPT until you charge]**

| Env var | Where |
|---------|-------|
| `STRIPE_SECRET_KEY` | Stripe Dashboard → API keys |
| `STRIPE_WEBHOOK_SECRET` | Stripe → Webhooks → signing secret |

Create Products/Prices and map their IDs in `billing.service.ts`
(`price_startup` / `price_growth` / `price_enterprise`). **Cost:** 2.9% + 30¢/txn.

---

## 10. Compute / orchestration **[REQ]**

| Option | Fits |
|--------|------|
| AWS **EKS** (Terraform provided) | Full control, 100k target, HPA/spot pools |
| AWS **ECS Fargate** | Simpler than EKS, no node mgmt |
| **Vercel** (web) + a container host (api/inference) | Fastest to ship the frontend |

The **Python inference service** wants **GPU nodes** once you enable real
MediaPipe/YOLO models at scale (e.g. `g4dn` instances); CPU is fine for the
heuristic fallback / low volume.
**Cost:** EKS control plane $73/mo + nodes. Realistic prod floor **~$500–1,500/mo**;
scales with concurrency.

---

## 11. Supporting services

| Need | Service | Env / notes |
|------|---------|-------------|
| Container registry **[REQ]** | GitHub **GHCR** (free) or AWS ECR | CI pushes here |
| Secrets **[REQ]** | AWS **Secrets Manager** + External Secrets Operator | never commit keys |
| Proctoring webhook secret **[REQ]** | `PROCTOR_WEBHOOK_SECRET` | shared by agent + inference service |
| JWT secrets **[REQ]** | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | 32+ random bytes each |
| Email (invites, alerts) **[REC]** | Resend / SES / Postmark | wire into NotificationService |
| Monitoring **[REC]** | Grafana Cloud or self-host (Prometheus stack provided) | `OTEL_EXPORTER_OTLP_ENDPOINT` |
| Error tracking **[OPT]** | Sentry | |
| Desktop agent signing **[OPT]** | Apple Developer ($99/yr) + Windows code-signing cert | to ship the Electron agent unflagged |

---

## Minimum viable setup (demo / pilot) — ~**$0–100/mo**

- 1 AI key (OpenAI) · Neon Postgres (free) · Upstash Redis (free) ·
  MinIO or R2 · browser speech (no Deepgram/ElevenLabs) · Judge0 on one small VM ·
  host `web` on Vercel, `api`+`inference` on Fly.io/Render. No Kafka, no Stripe.

## Full production (enterprise, 100k target) — ~**$2k–8k/mo + AI/speech usage**

- OpenAI + Anthropic + Deepgram + ElevenLabs · RDS Multi-AZ + replica + PgBouncer ·
  ElastiCache cluster · MSK/Redpanda · S3/R2 + CloudFront/Cloudflare · EKS
  (CPU + GPU spot pools) · Stripe · Secrets Manager · Grafana Cloud · Sentry ·
  code-signing certs.

---

## Fastest path to "it's live"

1. Domain + Cloudflare (DNS/CDN/TLS).
2. Neon Postgres + Upstash Redis (both free tiers, 5 min).
3. One `OPENAI_API_KEY`.
4. Deploy `web` to Vercel, `api` + `inference` to a container host.
5. Add `DEEPGRAM_API_KEY` + `ELEVENLABS_API_KEY` when you want premium voice.
6. Add Stripe when you start charging.
7. Move to AWS EKS + RDS/ElastiCache/MSK when concurrency demands it.
