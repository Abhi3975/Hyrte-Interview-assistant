# HYRTE — Architecture (Phase 0 discovery)

Status: draft for review. Nothing in Sections 1-9 of the build prompt has been coded from this
document yet — this maps the existing repo (including the uncommitted HYRTE work already sitting
in the working tree) against the spec so Phase 1 can start from an accurate baseline.

## 1. Existing stack

- **Monorepo**: npm workspaces + Turborepo. `apps/api` (NestJS + Prisma + Postgres), `apps/web`
  (Next.js 15 App Router). Deployed on AWS ECS Fargate + RDS, CloudFront in front for HTTPS
  (camera/mic need a secure context).
- **LLM**: `apps/api/src/ai/ai.service.ts` — multi-provider (`OpenAICompatibleProvider` wrapping
  OpenAI, Anthropic, Gemini, Groq, DeepSeek), `AI_DEFAULT_PROVIDER` env-selectable, OpenAI is the
  default. `ai.complete()` / `ai.completeJson()` are the two call shapes already used everywhere,
  including in the new HYRTE code — no new LLM client needed for Phases 1-7.
- **Voice**: `apps/api/src/voice/` — ElevenLabs TTS (`speech/elevenlabs.tts.ts`), a `voice.gateway.ts`
  WebSocket layer, and an `STTProvider` interface (`speech/speech.interface.ts`) that is currently
  **not implemented against a real streaming STT backend** — the candidate-facing interview room
  (`apps/web/.../candidate/interview/page.tsx`) uses the browser's native `SpeechRecognition` API
  (Chrome/desktop only), not the backend STT interface. This is the single biggest technical gap
  standing between the current voice stack and Section 5.8's "Living Interviewer" (backchannels,
  interruption timing, silence-type detection all need low-latency streaming STT, which browser
  SpeechRecognition can't give reliable control over).
- **Existing AI Interviewer** (Section 0/5's "already partially built" model): `apps/api/src/practice/practice.service.ts`.
  `INTERVIEWER_SYSTEM` is a single large system prompt (not a multi-engine architecture) driving
  `interviewTurn()`, which takes the full transcript each call — memory is "replay the whole
  transcript," not a persistent graph. Six interviewer personalities exist today (`friendly`,
  `professional`, `strict`, `faang`, `startup`, `pressure`) as string fragments appended to the
  system prompt — this is Section 5.6's personality system already in a reusable shape, one level
  short of an explicit persona-config object. Progressive-hint discipline, post-answer code review,
  and a final structured report (with a 7/30/90-day roadmap) are already implemented and match the
  spirit of Section 5.1/5.4 closely; there is no evidence-graph query step (5.2), no adversarial
  mode (5.9), no multi-agent panel (5.10), and no Living Interviewer voice layer (5.8).
- **Existing eval/report engine**: `apps/api/src/evaluation/evaluation.service.ts`. Fixed
  6-competency taxonomy (`communication`, `technicalAccuracy`, `confidence`, `problemSolving`,
  `leadership`, `behavioral`), one `overallScore`, `Recommendation` enum, `strengths`/`weaknesses`
  string arrays. This is a single LLM-scored report, not the multi-agent Decision Council (Section 6)
  and not the shared dynamic-weighted metrics framework (Section 7) — it's the thing Section 7
  should eventually subsume, not extend in place, since its taxonomy is fixed rather than
  role/culture-weighted.
- **Data/tenancy**: `prisma/schema.prisma`. `Role` enum is `CANDIDATE | RECRUITER | ORG_ADMIN |
  SUPER_ADMIN` — no `INSTITUTION` concept. `Organization` has a `plan` enum + freeform `settings
  Json` but no `type` distinguishing a hiring company from a university/career-center tenant.
  `InterviewSession` (existing product) stores `transcript` as a JSON blob plus `riskScore`,
  `examState` — informal, not evidence-object-shaped.
- **Code execution**: `apps/api/src/practice/piston.client.ts` talks to the public paiza.io runner
  (guest key). Relevant to Section 4.16 Task Execution for engineering-role simulations later.
- **Auth**: JWT access/refresh, `JwtAuthGuard`. The new HYRTE WebSocket gateway
  (`hyrte.gateway.ts`) already reuses this exact token-verification pattern from `voice.gateway.ts`.

## 2. What's already built: HYRTE is mid-Phase-2, not Phase 0

The working tree (uncommitted, verified running end-to-end this session — company-state generation,
stakeholder replies, live WebSocket push, decision logging, reflection interview, report generation
all work) already implements a first pass of this exact spec. Its own code comments cite section
numbers from an earlier (pre-merge) version of this doc (`doc §4`, `doc §5`, `doc §6`, `doc §8`,
`doc §9`), confirming it was built against a prior draft of the same plan. Concretely, against the
**v2 merged spec's** section numbers:

**Reuse as-is:**
- `apps/api/src/hyrte/hyrte.gateway.ts` — realtime push pattern, JWT-authenticated, per-session
  subscriber sets. Good enough for Phase 2-3 as-is.
- `apps/api/src/hyrte/generator/simulation-generator.service.ts` — **this already matches Section
  4.14's canonical 6-input spec exactly** (`role, experienceLevel, industry, companyType,
  difficulty, culture`), generates a fresh fictional company/stakeholder roster/inbox/Slack/tasks
  per session via LLM, and has a defensive `sanitizeFixture()` pass that clamps/repairs untrusted
  LLM JSON before it touches Prisma. Reuse the shape; extend the generated schema as later phases
  need more fields (e.g. hidden per-stakeholder info for 4.13).
- `apps/api/src/hyrte/agents/stakeholder-agent.service.ts` — implements Section 4.12 Layers 1
  (persona), 3 (four-dimensional relationship state: trust/respect/cooperation/influence — the doc's
  fuller nine-dimension version can extend this), 4 (persistent per-stakeholder memory table), 6
  (reads company state before replying), 7 (emotional state scaled 0-100). Solid foundation for
  Phase 2's stakeholder loop.
- `apps/api/src/hyrte/consequences/consequence.service.ts` — implements the core of Section 4.11's
  processing loop for two concrete cases: task completion → LLM-reasoned company-state delta, and an
  ignored urgent message → a different stakeholder escalates with its own state/relationship delta.
  This is a real, working slice of "ripple effects" and "decision cost" (4.17), not a stub.
- `apps/api/src/hyrte/interview/hyrte-interview.service.ts` — a working slice of Section 5.2's core
  idea (question generation grounded in observed behavior, not generic questions) and Section 8 step
  9 (references specific in-sim moments). It builds an ad hoc "evidence brief" text blob from
  `HyrteDecisionLogEntry` + stakeholder relationship deltas — functionally evidence-aware, but not
  backed by the formal Evidence Graph schema (3.1) yet, so 3.1 should be built to absorb this brief's
  inputs as its first real write source, not built in parallel with it.
- Web: session shell + nav (`dashboard-shell.tsx` `'hyrte'` area, `hyrte-nav.ts`), the ten section
  pages already exist as routes even where the backend behind them is thin (analytics,
  knowledge-base). This gives Phase 2's UX scaffold (Section 9, Phase 2) a head start.

**Refactor to plug into the Evidence Graph / DIG:**
- `HyrteDecisionLogEntry` (currently: `actor, actionType, payload Json, createdAt`) is the natural
  precursor to Decision Graph nodes (3.5) but is missing reasoning-at-the-time, alternatives
  considered, and outcome/recovery linkage — extend its schema rather than replace the table.
- The reflection interview's "evidence brief" (free text assembled per-call in
  `buildEvidenceBrief()`) should become a query against the Evidence Graph once 3.1 exists, so the
  same underlying evidence objects back both the interviewer's questions and the final report,
  instead of two independent text summarizations of the same Prisma rows.
- `hyrte-interview.service.ts`'s `generateReport()` (one LLM call producing strengths/gaps/
  contradictions/recommendation) is the seed of the Decision Council's combined report (6.3.4) —
  once the 9-agent council exists, this single-call report should be replaced by the council's
  aggregation, not run alongside it as a second, competing report.
- Stakeholder relationship state (trust/respect/cooperation/influence) should extend toward 4.12
  Layer 3's fuller set (+ confidence, frustration, responsiveness, influence-as-distinct-from-trust,
  risk perception, escalation tendency) as Behavioral Graph consumers (4.9/4.18) need finer signal
  than four numbers.
- `evaluation.service.ts`'s fixed 6-competency taxonomy should be superseded by Section 7's
  dynamically-weighted shared framework — plan a migration path for the *existing* (non-HYRTE)
  product's reports too, since both should end up on one scoring vocabulary per Section 7's intent.

**Net-new (nothing in the repo today):**
- Evidence Graph (3.1), Candidate Intelligence Card (3.2), Job Success Model (3.3), Investigation
  Plan (3.4) — none exist. This is Phase 1's actual scope.
- Decision Intelligence Graph (3.5) in full: Decision DNA, Counterfactual Analysis, Recovery Score,
  Prediction Engine, Learning Engine — none exist. `HyrteDecisionLogEntry` is the only structural
  precursor (see Refactor above).
- Living Organizational World Model's full ripple/cascade chains (4.11) — today's consequence
  engine handles two trigger types (task completion, ignored message) with single-hop LLM-reasoned
  deltas; the doc's cross-functional cascade chains (Sales → Engineering → Support → Revenue →
  Budget) and delayed/dormant consequences (documentation skipped now, release fails weeks later)
  are not implemented.
- Stakeholder Agent Layers 2 (independent worldview / incomplete knowledge), 5 (stakeholders acting
  entirely independently of the candidate, beyond the current delayed-message seed), 9-11 (distinct
  persona reactions to identical triggers, hidden intentions, stakeholders disagreeing with *each
  other*) — today every stakeholder only ever replies directly to the candidate, one at a time.
- Hidden Information System (4.13) as a distinct mechanic — today's fixture hands all knowledge-base
  content to the candidate up front rather than distributing pieces across stakeholders.
- Multi-Day Memory split (4.15) — `HyrteSessionType` (`PRACTICE`/`ASSESSMENT`) exists in the schema
  but nothing yet reads it to actually branch persistence behavior.
- Task Execution as primary interaction mode (4.16) — only `task.status_change` is tracked today;
  no PRD/backlog/code-review/CRM-style embedded work products.
- Decision Cost as an explicit paired benefit/cost delta (4.17), Contextual (per-context) Behavioral
  Graph (4.18), Company-Culture scoring weights (4.19 — culture is captured at generation time but
  the code comment explicitly notes it does not yet affect scoring), Ethical Gray Zones (4.20) —
  none implemented.
- AI Interviewer Section 5 upgrades: evidence-graph-aware questioning against the *formal* graph
  (5.2 proper), roboticness variation banks (5.4), difficulty tiers (5.5) for the interview itself,
  adversarial "Boss Level" mode (5.9, existing product has none), the full Living Interviewer voice
  layer (5.8 — needs the STT gap above closed first), Living-Interviewer-style
  culture-in-persona (5.6's startup/enterprise/sales/bank voice), multi-agent live panel (5.10).
  Also: HYRTE's reflection interview today is **text-only**, no TTS/STT at all — the existing
  product's voice stack is not yet wired to it.
- Decision Council (Section 6) in full — no multi-agent committee exists anywhere in the repo.
  Today there is one LLM call producing one report; the 9 mandated agent roles, the discussion/
  debate transcript (6.3.2), and the live recruiter Q&A engine (6.3.3, Decision Cortex) are all
  net-new.
- UX flow Section 8 steps 1-2 (**Mission Brief**, **Baseline Skill Challenge**) — the
  `HyrteSessionPhase` enum already has `MISSION_BRIEF` and `BASELINE_SKILL_CHECK` values defined,
  but `HyrteSessionsService.create()` sets a new session straight to `WORKSPACE_ACTIVE`, skipping
  both. The enum values are a placeholder for work not yet done, not evidence the screens exist.
- Institution/Career-Center tenant type (Section 0.1) — confirmed via a live look at hyrte.com (see
  message below): real top-level nav item and marketing page exist in production, but read as a
  lead-gen page with no visible product surface behind it yet. Nothing in this repo's data model
  (`Role`, `Organization`) represents an institution today. Section 0.1 also implies an
  **institution-admin role** distinct from `RECRUITER`/`ORG_ADMIN`, and institution-scoped views for
  the Job Success Model (3.3), Candidate Intelligence Card (3.2), and combined report template
  (6.3.4) — none of that exists; fold into the `Role`/tenant-type schema decision in Phase 1, don't
  build it as a bolt-on later.
- Section 0.1's employer-marketed promises that nothing in the repo currently satisfies: cross-
  candidate percentile/benchmarking (needs a real computation in the DIG/Decision Council comparing
  a candidate against a role/industry cohort, not just against one Job Success Model — nothing
  today produces a percentile), ATS/API integration layer, and a white-label report templating layer
  parameterized per tenant (company vs. institution branding/certificates). All three are Phase 8
  hardening scope per the build phases, not Phase 1-7 blockers — flagged here so they aren't
  forgotten, not because they're urgent now.
- **Existing "Practice Center" clarification**: `/candidate/practice` is not a separate surface —
  it's a redirect straight into `/candidate/interview` (the same conversational AI Interview Room
  covered above), added in a recent commit ("Mock Interview now runs the conversational Ally
  room"). So Section 0.1's "upgrade Practice Center into the full Living Workplace Simulation" and
  "extend the existing AI Interviewer" are, concretely, **the same upgrade target** — there is one
  self-serve candidate-practice surface today, not two. This simplifies the Multi-Day Memory (4.15)
  design: there's a single existing entry point to gate practice-mode persistence behind, not a
  Practice Center plus a separate interview room to keep in sync.
- **Career Readiness Score retrofit** (Section 0.1): the hyrte.com landing page confirms a
  "branded scorecard" exists candidate-facing, and the doc's own text describes it as a bare
  78/100-style number with a one-line strengths/weakness fragment — a direct conflict with the
  Section 10 guardrail ("every score must ship with a plain-language, evidence-linked explanation").
  Neither this repo's `evaluation.service.ts` output nor HYRTE's `HyrteInterviewReport` currently
  produce that specific score+delta UI pattern, so there's nothing to refactor yet — this is pure
  net-new work for whichever phase builds the DIG-backed candidate report (Phase 7), keeping the
  single top-line number but making it click through into Section 7/8's evidence-linked reasoning.

## 3. Where the DIG sits

The Decision Intelligence Graph is not a new database — it's a **read/write contract layered over
existing and new Prisma tables**, the same way `HyrteDecisionLogEntry` already sits under the
reflection interview today:

```
Evidence sources (write side)          DIG (read side — computed, not stored redundantly)
─────────────────────────────          ──────────────────────────────────────────────────
HyrteDecisionLogEntry (extended)  ──┐
Stakeholder relationship deltas   ──┤
Company-state deltas              ──┼──►  Decision Graph (per-candidate node chain)
Task/knowledge-base interactions  ──┤          │
Reflection-interview transcript   ──┤          ├──► Decision DNA (pattern classifier over the graph)
(future) Evidence Graph (3.1)     ──┘          ├──► Counterfactual Analysis (re-sim off graph nodes)
                                                ├──► Recovery Score (graph-node subsequence scorer)
                                                ├──► Prediction Engine (graph + Job Success Model match)
                                                └──► Learning Engine (graph + ingested hiring outcomes)
```

Practically: Phase 1 should add the DIG's *write-path contract* (an interface every future
subsystem writes decision nodes through) without yet building the five read-side capabilities —
exactly as the build-phases section specifies. The existing `HyrteDecisionLogEntry` table is the
closest thing to a Decision Graph node today; Phase 1's job is deciding whether to extend that table
in place or introduce a new `DecisionGraphNode` table that supersedes it (open question below).

**Resolved (2026-08-01): DIG write timing is continuous, not Council-gated.** The user's own
architecture diagram draws a sequential Council → DIG arrow, but confirmed the intent matches
Section 3.5's prose, not the diagram's simplified box order: Decision Graph nodes get written live
as the candidate acts during the simulation and interview (every decision, stakeholder delta,
company-state change, task completion is a node the moment it happens) — the DIG is not something
that only springs into existence after the Decision Council finishes. The Council reads from the
already-populated DIG to deliberate (6.1's "dynamic investigation loop" needs this — Decision Cortex
tells the Interview Lead where to probe next, which requires the DIG to already have signal mid-
session), and the Council's own discussion transcript (6.3.2) is then written back in as one more
evidence node, not the DIG's primary input. Practical consequence for Phase 1: the write-path
contract must be callable from the simulation and interview services directly (not only from a
post-Council aggregation step), so `HyrteDecisionLogEntry`-equivalent writes and DIG-node writes are
the same call, not two passes.

## 4. Open questions before Phase 1 — resolved 2026-08-01 (user said "go ahead", defaults below)

1. **Decision Graph node storage — extended `HyrteDecisionLogEntry` in place.** Added
   `reasoning`, `alternativesConsidered`, `riskAssessment`, `outcome`, and a self-relation
   `recoveryOfId`/`recoveries` for Recovery Score chains (3.5), rather than a new table. Low risk
   as predicted — the table had one consumer (`buildEvidenceBrief`).
2. **STT provider — deferred, default is OpenAI Realtime when Phase 5 needs it.** No new vendor
   key to provision (reuses the OpenAI key already in the deployed env); revisit if OpenAI
   Realtime's latency/feature set doesn't hold up once the Living Interviewer voice layer is
   actually built. Not acted on in Phase 1 — there's no STT work in the data-backbone phase.
3. **Institution tenant — added now.** `Organization.type: OrganizationType (COMPANY | INSTITUTION)`,
   default `COMPANY`, added in the same Phase 1 migration. No institution-facing feature or admin
   role built yet — just the tenant-type field, to avoid a second migration later.
4. **`evaluation.service.ts` migration scope — deferred, HYRTE-only for now.** Section 7's shared
   metrics framework will apply to HYRTE's reports when Phase 7 builds them; the existing
   (non-HYRTE) product's `evaluation.service.ts` is left untouched. Revisit the full-product
   migration implied by Section 0.1 as an explicit, separately-scoped decision before Phase 7,
   since it's materially bigger than scoring HYRTE alone.
5. **Product Manager confirmed as the Phase 2 anchor role** — matches the existing fixture/generator.

## 5. Phase 1 status: complete (2026-08-01)

Built and verified end-to-end (curl, against the local dev DB — see below):

- **Evidence Graph (3.1)**: `EvidenceObject` + `EvidenceLink` (SUPPORTS/CONTRADICTS/ELABORATES),
  `EvidenceGraphService` (`apps/api/src/hyrte/dig/evidence-graph.service.ts`). Confidence scoring
  is a deterministic placeholder (50 baseline, ±10/-20 per support/contradict link) — matches the
  doc's "computed field, never hand-set" requirement; swapping in an LLM-scored version later
  doesn't change the service's public method signatures. Verified: created two evidence objects,
  linked them CONTRADICTS, watched both flip 50→30 confidence and PENDING→CONTRADICTED status,
  confirmed `getOpenAreas()` surfaces the contradicted one.
- **Candidate Intelligence Card (3.2)**: `CandidateIntelligenceCard` model + service. Only computes
  what's derivable without a resume/LinkedIn pipeline (evidence density, exposure areas from HYRTE
  session history, leadership/technical-depth as low/medium/high buckets — never raw scores, per
  the doc). `experiencePattern`/`careerPattern` stay null until that pipeline exists.
  Verified via refresh + get.
- **Job Success Model (3.3)**: `JobSuccessModel` model + LLM-backed service, decomposing a HYRTE
  session's 6 generator inputs (standing in for a JD — HYRTE has no JD text yet) into core
  outcomes/capability requirements/industry+company context. Verified via generate + get.
- **Investigation Plan (3.4)**: `InvestigationPlan` model + LLM-backed service, consuming the Job
  Success Model plus current evidence coverage. Verified: correctly reported "no evidence
  collected" for every area before any evidence existed.
- **DIG write-path contract (3.5)**: `DecisionGraphService`
  (`apps/api/src/hyrte/dig/decision-graph.service.ts`) is now the *only* writer to
  `HyrteDecisionLogEntry` — refactored `HyrteWorkplaceService.logDecision()` (previously a raw
  Prisma call) to go through it. Verified the existing inbox-reply flow still works unchanged
  end-to-end through the new path, with the DIG's new node fields present (null, since that caller
  doesn't populate them yet — expected). The five DIG read-side capabilities (Decision DNA,
  Counterfactual Analysis, Recovery Score, Prediction Engine, Learning Engine) are **not** built —
  per the build phases, those are Phase 7 read-models over the table this phase populates.
- New module: `apps/api/src/hyrte/dig/` (`dig.module.ts`, exported into `HyrteModule`). New
  endpoints under `hyrte/sessions/:id/{evidence,job-success-model,investigation-plan,
  intelligence-card}` — testing-only per the phase spec ("no UI needed yet"), no frontend consumes
  them.
- `nest build` and `tsc --noEmit` (web) both clean; dev servers boot with no errors; `prisma db
  push` applied cleanly to the local DB with zero data loss (additive schema only).

## 6. Phase 2 status: complete, scoped down and documented (2026-08-01)

Built and verified end-to-end (curl + browser click-through against the local dev DB):

- **Evidence Graph wiring** ("writing every action into the Evidence Graph" per Phase 2's own
  wording): `HyrteWorkplaceService` and `HyrteStakeholderAgentService` now write an `EvidenceObject`
  alongside every `DecisionGraphService.recordDecision()` call — inbox replies, Slack messages, task
  status changes, KB views, stakeholder interactions, and the new baseline-challenge submission all
  auto-populate the graph as they happen. Verified: replying to an inbox message produced both a
  `SIMULATION_ACTION` and (once the stakeholder responded) a `STAKEHOLDER_INTERACTION` evidence
  object with the trust delta embedded in the text.
- **Living Organizational World Model (4.11) — completed the canonical variable list.** Added the 5
  missing KPIs (`productQuality`, `burnout`, `hiringCapacity`, `operationalRisk`, `growth`) to
  `HyrteCompanyState`, generator prompt, and fallback fixture. Also fixed a pre-existing bug: the
  generator had its own local `COMPANY_STATE_KEYS` duplicate of `consequence.service.ts`'s constant
  — now imports the single source of truth, so the two can't drift out of sync again. The doc's full
  canonical processing loop (Action → Decision Engine → State Update → Stakeholder Re-evaluation →
  New Events → Stakeholders Respond) is **not** a single formalized orchestrator yet — it remains the
  same event-driven pattern as before (consequence engine + stakeholder agent triggered independently
  per action type), just now over the complete variable set.
- **Stakeholder Agent — Layer 10 (Hidden Intentions) added.** Every generated stakeholder now carries
  a `hiddenIntention` the LLM is instructed to let color tone/urgency without ever stating directly —
  verified via the fallback fixture's hand-written intentions (e.g., the Head of Sales secretly needs
  the deal to hit her own quota). Locked down at the schema/query level, not just service discipline:
  `hiddenIntention` is never selected in `listStakeholders`, the nested `fromStakeholder` includes on
  inbox/Slack, or the `stakeholder:update` WebSocket broadcast — verified via curl that the field is
  absent from every one of those response shapes.
- **UX flow §8 steps 1-2 (Mission Brief, Baseline Skill Challenge)** — both screens built and
  verified in-browser. Session creation now starts at `MISSION_BRIEF` (previously skipped straight to
  `WORKSPACE_ACTIVE`); `POST .../mission-brief/continue` and `POST .../baseline-challenge/submit`
  drive the phase transitions, the latter writing both a Decision Graph node and an Evidence Graph
  object. A new `HyrtePhaseGate` component redirects the candidate into whichever screen the session's
  phase requires (and away from them once passed), mounted once in the session layout.

**Deliberately deferred** (documented here rather than silently dropped, same as Phase 1's open
questions):
- **4.12 Layers 2, 5, 9, 11** — independent/incomplete stakeholder worldview (ties to 4.13 Hidden
  Information System), stakeholders acting fully independently of the candidate beyond the existing
  delayed-message seed, distinct persona reactions to identical triggers, and stakeholders
  disagreeing with *each other* (not just the candidate). These need real design work (a "team
  meeting" or multi-stakeholder-response mechanic) — explicitly Phase 3 (Chaos Engine / Hidden
  Information System) scope, not folded into this pass.
- The canonical 4.11 processing loop as a single formal orchestrator (see above) — current behavior
  is equivalent in effect for the trigger types that exist today, but isn't literally the named
  control-flow the doc sketches. Revisit if Phase 3's Chaos Engine needs a real orchestration point.
- Baseline Challenge options carry no weighting — captured as evidence for the interviewer/report to
  use later, but there's no scoring interpretation yet since Section 7's report-scoring work is a
  Phase 7 concern.

## 7. Phase 3 status: complete, scoped down and documented (2026-08-01)

Phase 3 in the doc bundles 8 distinct sub-items (Chaos Engine, Ambiguity/Hidden-Info Engine, full
ripple/cascade Consequence Engine, Task Execution, per-context Behavioral Graph, Decision Cost,
Ethical Gray Zones, Company Culture scoring weights). Built 5 of the 8 with real, verified depth;
deferred 3 that need dedicated design work rather than fitting into this pass (see below).

**Built and verified** (curl, against the local dev DB — including a temporary shortened-delay test
of the Chaos Engine, reverted back to the real 100s delay before finishing):

- **Decision Cost (4.17)**: task completions and stakeholder-agent replies now return a paired
  `benefit`/`cost` from the LLM (e.g., completing a task: "Benefit: Improved user feedback... Cost:
  Reduced time for other tasks") alongside the company-state delta, written into evidence metadata.
  Verified live on a task completion.
- **Ethical Gray Zones (4.20)**: added `ETHICAL_DECISION` to `EvidenceType` and an `ethicalDilemma`
  flag on inbox/Slack messages, set by the generator (prompt requires exactly one flagged message per
  session; fallback fixture has one hardcoded — the CEO asking the candidate to misrepresent SSO
  status to the board). Replying to a flagged message tags the resulting evidence
  `ETHICAL_DECISION`/`PRESSURE` instead of the generic action type — verified by flagging a message
  and replying to it.
- **Behavioral Graph per-context tagging (4.18)**: added `BehaviorContext` enum
  (PEER/MANAGER/CUSTOMER/CONFLICT/PRESSURE/AMBIGUITY/FAILURE/SUCCESS) to `EvidenceObject`, nullable
  by design — not every evidence object cleanly fits one. Auto-tagged via role-text heuristics
  (`inferContextFromRole`) for stakeholder interactions, `AMBIGUITY` for the baseline challenge,
  `PRESSURE` for ignored-message escalations and chaos-wave events, `CONFLICT` when a stakeholder
  exchange drops trust sharply. New `GET .../evidence/by-context` groups evidence for a session —
  verified it correctly bucketed a baseline decision under `AMBIGUITY` and left task-completion
  evidence `UNCLASSIFIED` (a legitimate non-fit, not a bug).
- **Company Culture scoring weights (4.19)**: `culture-weights.ts` — a static per-culture weighting
  table over the Behavioral Graph's 8 named dimensions, matching the doc's "same behavior, different
  weighting" framing. **Data contract only**, same precedent as the Phase 1 DIG write-path: there is
  still no scorer anywhere in HYRTE to consume it (Section 7's shared metrics framework is Phase 7),
  so wiring it into a live score now would have nothing real to multiply against. `GET
  .../culture-weights` verified returning distinct weights for "Innovation-first" (adaptability 1.6)
  vs. neutral.
- **Chaos Engine (4.5) — scoped version**: `scheduleChaosWave`/`triggerChaosWave` fire one wave of
  2-3 correlated inbox/Slack events from different stakeholders, timed from workspace unlock (not
  session creation), content generated from live company state so it targets whichever KPI is worst.
  Verified live (temporarily shortened delay): a HARD-difficulty Sales-driven session produced an
  urgent inbox message plus 3 Slack messages across `#sales`, `#engineering`, and a CEO DM, applied a
  company-state delta, and wrote evidence tagged `chaosWave: true` / `PRESSURE`. **Honest limitation**:
  "intelligent, not random" is only half-true — the wave's *content* is state-aware, but its *timing*
  is a fixed delay, not driven by tracking the candidate's own pace/attention (that needs
  action-count/attention instrumentation this pass didn't build).
- **Fixed two more `hiddenIntention` leak vectors** found while touching this code: the escalation
  path's `stakeholder:update` broadcast in `consequence.service.ts` wasn't omitting it (same bug
  class as the two fixed in Phase 2). Consolidated the omit constant into one shared
  `hidden-intention.util.ts` instead of three independent copies, so this can't regress a fourth time.

**Deliberately deferred** (need real design work, not folded into this pass):
- **Hidden Information System (4.13) / Ambiguity Engine (4.6)** — distributing knowledge across
  stakeholders so nobody has the full picture requires redesigning what the generator gives each
  stakeholder and how the candidate discovers it; a substantially different shape from anything built
  so far, not an incremental extension.
- **Full ripple/cascade consequence chains (4.11)** beyond the existing trigger types (task
  completion, ignored message, chaos wave) — true cross-functional chains (Sales overpromises →
  Engineering overload → bugs → churn → budget cuts) need a multi-hop propagation model this pass
  doesn't build.
- **Task Execution as primary interaction mode (4.16)** — needs a real work-product UI (a PRD editor,
  backlog prioritization tool, etc.), the single largest frontend lift in Phase 3's scope; the
  simulation still only supports message-reply and task-status-toggle as interaction modes.

Per the build prompt's own phase-gate rule, holding here for review before Phase 4 (Interviewer
integration — wiring the existing AI Interviewer to read/write the Evidence Graph).

## 8. Phase 4 status: complete and verified (2026-08-01)

**Architecture decision made explicit**: Phase 4 says "wire the existing interview model to the
Evidence Graph." There are two candidate interviewers in this repo — the main product's
`practice.service.ts` (generic mock-interview engine, no concept of a HYRTE session) and HYRTE's own
`hyrte-interview.service.ts` (the post-simulation reflection interviewer, already HYRTE-session-aware
since it was built pre-merge-doc). Upgraded the latter, not the former — it's already the "Interview
Lead" the doc describes ("talks to the candidate before and after the simulation, using evidence the
simulation generated"); retrofitting the unrelated main-product interviewer into HYRTE would mean
building session-awareness from scratch rather than upgrading something that already has it. This
matches what ARCHITECTURE.md §2 flagged back in Phase 0 discovery as the intended refactor target.

**§5.2 Evidence-graph-aware questioning — built and verified live:**
- `buildEvidenceBrief` now queries `EvidenceGraphService.getForSession()` (the real graph, populated
  continuously since Phase 2/3) instead of re-deriving a summary from the raw decision log — the two
  used to be independent text summarizations of the same underlying actions.
- Each candidate turn is written into the graph as its own `INTERVIEW_STATEMENT` evidence object. If
  the LLM flags it as contradicting a specific prior evidence item (referenced by a short "EVn" label
  in the prompt), a real `CONTRADICTS` edge is created via `EvidenceGraphService.linkEvidence()` —
  this is a first-class graph fact afterward, not a one-off observation that evaporates once the turn
  ends.
- **Verified end-to-end**: left an urgent message unread (generating "ignored an urgent message"
  evidence), then told the interviewer "I always respond to every urgent customer message
  immediately." The interviewer caught the contradiction, confronted it directly, and the resulting
  `CONTRADICTS` link dropped both evidence objects' confidence scores 50→30 and flipped their status
  to `CONTRADICTED` — exactly the mechanism verified in Phase 1, now actually exercised by live
  interview content instead of a manual test call. The final report surfaced this exact contradiction,
  correctly tied to its evidence, driving a "Weak Fit" recommendation with a plain-language
  explanation (Section 7's guardrail).
- **One bug found and fixed during verification**: the LLM initially echoed the internal "EV2" label
  into candidate-facing reply text. Fixed with both a stronger prompt instruction and a regex-based
  `stripEvidenceLabels()` safety net applied to every reply/question before it's stored or returned —
  same "don't trust instruction-following alone" discipline already used for `hiddenIntention`.

**§5.4 Roboticness reduction — built and verified live:**
- `CLOSING_LINES` (11 variations), `REPORT_READY_MESSAGES` (6 variations), `MICRO_ACKS` (6 short
  fillers) as explicit arrays, not left to the LLM to vary its own phrasing.
- Fixed closing sequence: the LLM is now instructed to give only a brief final acknowledgement (no
  self-authored closing or report mention); code deterministically appends a random closing line +
  report-ready message. Verified: final turn returned `"...Thanks, that gives me a much clearer sense
  of your thinking. One moment while I finalize your report."` — the LLM's acknowledgement plus two
  bank picks, not a single LLM-authored block.
- Micro-acknowledgements inserted probabilistically (30% chance) on non-final turns — verified one
  turn opened with "Okay." where the LLM's own reply had none.

**Not touched**: the main product's `practice.service.ts`/`INTERVIEWER_SYSTEM` interviewer (used
outside HYRTE) is unaffected — Section 0.1's question of whether it should ever be unified with HYRTE
remains an open, separately-scoped decision (see ARCHITECTURE.md §4, item 4), not something this
phase needed to resolve.

Per the build prompt's own phase-gate rule, holding here for review before Phase 5 (Interviewer
depth — personalities, difficulty tiers, adversarial mode, multi-agent panel, the Living Interviewer
voice layer — the last of which is blocked on the STT provider decision in §4).

## 9. Phase 5 status: complete, scoped down and documented (2026-08-01)

Phase 5 bundles 6 sub-items (personalities, difficulty tiers, off-script handling, the Living
Interviewer voice layer, adversarial mode, multi-agent panel). Built 4 with real depth; deferred 2
that are genuinely separate, larger engineering efforts, not incremental extensions of this pass.

**Built and verified** (curl, against the local dev DB):

- **Personalities + Company Culture Injection (5.6)**: `interviewer-persona.ts` derives a base tone
  from the session's `difficulty` (EASY→Friendly&Supportive ... EXPERT→senior bar-raiser) and layers a
  `companyType`-driven voice on top (Startup/"how quickly do you learn", Enterprise/governance,
  Consulting/"walk me through your assumptions", etc.), matching the doc's own worked examples.
  Verified: an Enterprise/HARD/Compliance-first session produced noticeably sharper,
  compliance-focused pushback ("Relying on your gut is quite the strategy...") than a neutral
  MEDIUM-difficulty session would.
- **Difficulty tiers / round length (5.5)**: `getTurnRange(difficulty)` scales the interview's target
  length (EASY 4-6 → EXPERT 7-10 exchanges) instead of the old fixed 5-8 for every session. Verified:
  a HARD session ran a longer interview and closed out at 7 counted turns, within its 6-9 range.
- **Real-time adaptation (5.3)**: `computeCandidateSignal()` — a cheap proxy (reply length + hedging
  language) feeding a "give simpler/more encouraging follow-ups" or "go deeper, probe harder" note
  into the prompt each turn. Lighter-weight than the doc's full difficulty-ladder vision, but a real,
  live signal rather than nothing.
- **Off-script handling (5.7)**: `matchOffScript()` — 5 categories (salary, "are you an AI",
  "can we skip this", "how am I doing", remote-work logistics) × 2 response variations = 10 templates,
  deterministic regex match, no LLM call. Verified both the "are you an AI" and salary categories
  return their canned responses instead of derailing the evidence-based flow.
- **Adversarial "Boss Level" mode (5.9)** — the most safety-critical item, built with the guardrails
  enforced in *code*, not prompted-and-hoped-for: explicit opt-in via `POST .../interview/start
  {bossMode: true}`; a hard-capped jab counter (`interviewJabCount`/`MAX_JABS = 6`) persisted on the
  session, incremented only when the LLM flags `wasJab: true`, and the adversarial directive drops out
  of the prompt entirely once the cap is hit — the LLM cannot keep escalating past 6 regardless of
  what it "wants." Distress/opt-out detection (`requestsBossModeExit`) is a regex check that fires
  *before* any LLM call and force-disables `interviewBossMode` in the database directly — verified
  live: sent "this is a bit much... I am feeling pretty stressed" mid-jab-count-1, got an immediate
  calm canned reply, confirmed `interviewBossMode` flipped to `false` in the DB, and the next turn's
  tone was visibly softer with no further jab possible.

**Deliberately deferred:**
- **§5.8 Living Interviewer voice layer** — STT provider decision is formally resolved (OpenAI
  Realtime, reusing the existing key, per the Phase 0 default) but actual integration is deferred to
  its own dedicated pass. This is not a small bolt-on: it needs a browser audio-capture pipeline, a
  WebSocket voice gateway (the existing `voice.gateway.ts` pattern is a starting point but untested
  for real-time STT), TTS synthesis timing, and the backchannel/interruption/silence-detection logic
  the doc describes in detail — each of those is itself a meaningfully-sized feature. Building a
  shallow version now would misrepresent what "Living Interviewer" is supposed to be.
- **§5.10 Multi-agent live panel** — candidate-facing multiple personas with turn-taking logic. Most
  naturally pairs with 5.8's "distinct voice per panelist" requirement (without voice, panelists are
  just labeled chat bubbles, which undersells the feature); deferred alongside it rather than built
  as a text-only stand-in.
- **§5.11 Live interview style switching** (Behavioral → Technical → Case Study → Stress → Coaching →
  Reflection) is not a clean fit for HYRTE's reflection interviewer specifically — that interviewer
  only ever runs in "Reflection" mode by construction (it exists to probe what already happened in the
  simulation, not to run a general-purpose interview). This mode list applies more naturally to a
  future multi-agent panel or the main product's interviewer than to this one — noted, not built.

Per the build prompt's own phase-gate rule, holding here for review before Phase 6 (Decision
Council — the 9-agent committee, discussion transcript, and Decision Cortex Q&A engine).

## 10. Phase 6 status: complete, scoped down and documented (2026-08-01)

The largest phase yet. Built all 9 agents, the discussion layer, the combined report, and the
Decision Cortex Q&A engine — the four recruiter-facing surfaces from §6.3, as separate data surfaces
per the doc's own instruction. Two things explicitly scoped down (documented below), one pre-existing
gap surfaced and accepted rather than solved.

**Design decision**: `DecisionCouncilService.convene()` runs *after*
`HyrteInterviewService.generateReport()`'s existing single-call synthesis (Phase 4, proven working)
rather than replacing it — the existing call still produces strengths/developmentAreas/
contradictions/summary/evidenceTrail (candidate-facing, already verified working in Phase 4); the
Council adds the 9-agent depth on top and **overwrites `recommendation` with a deterministic vote
tally** instead of the single LLM's guess. Lower-risk than a full replacement, and more defensible
for the one field (`recommendation`) that most needs to not be a single model's opinion.

**Built and verified end-to-end** (curl, with a fresh EASY-difficulty session run to completion):

- **9 individual agent reports (§6.3.1)**: `COUNCIL_AGENTS` config (5 voters: Interview Lead, Hiring
  Manager, Functional Expert, Future Teammate, Executive/Founder; 4 non-voting oversight: Devil's
  Advocate, Bias Auditor, Evidence Auditor, Decision Cortex) — 9 concurrent LLM calls via
  `Promise.all`, each agent seeing the same evidence brief + transcript but reasoning through its own
  mandate independently. Persisted as `HyrteCouncilAgentReport`, one row per agent, directly queryable
  by a recruiter (`GET .../council/agent-reports`) — not only as input to something downstream.
  Verified: got back exactly 9 rows, correct null/stance split (4 null, 5 with a lean).
- **Committee discussion (§6.3.2)**: one synthesis call over the 9 individual outputs, prompted to
  produce Devil's-Advocate-challenges-a-named-voter / Bias-Auditor-flags-a-pattern /
  Evidence-Auditor-flags-a-claim / a-voter-responds. Verified live: Devil's Advocate directly
  challenged the Hiring Manager by name, Future Teammate responded defending the candidate's
  prioritization, Bias Auditor and Evidence Auditor raised independent findings — a real disagreement,
  not a rubber-stamp. **Documented scope cut**: this is one LLM call synthesizing a plausible
  discussion from the 9 individual outputs, not genuine multi-turn agent-to-agent LLM calls — real
  inter-agent dialogue would be far slower/costlier for a report that already has 9 concurrent calls
  in it, and a well-grounded single synthesis captures the doc's intent (a real debate surfacing real
  disagreement) without that cost.
- **Combined report (§6.3.4)**: `recommendation` computed deterministically from the 5 voters' stance
  scores (HIRE=2 ... NO_HIRE=-2, averaged, mapped to the existing "Strong Fit"/"Fit"/"Weak Fit"/"Not a
  Fit" scale) — verified the exact math: 4×LEAN_NO_HIRE + 1×NO_HIRE averaged to -1.2, correctly landing
  on "Not a Fit." `confidencePercent`/`nextStepRecommendation` come directly from the Decision Cortex
  agent's own response. Both new fields added to the existing `HyrteInterviewReport` (nullable, so old
  Phase-4-only reports stay valid) rather than a separate table — it's still one combined report.
- **Decision Cortex Q&A (§6.3.3)**: `POST .../council/qa` — reads the 3 stored layers (agent reports,
  discussion, combined report) plus prior Q&A on the session, answers grounded in that stored data,
  never re-runs the interview. Verified: asked "why does this look like a Not a Fit, was there
  disagreement?" and got an answer citing the actual committee dynamics (the high-pressure-priority
  disagreement) without touching the interview/simulation again. **One bug found and fixed during
  verification**: Decision Cortex's free-text answer initially opened with "Not a Fit" but drifted to
  "Weak Fit" by the end of the same sentence — self-inconsistent. Fixed by forcing the exact stored
  `recommendation` string into the prompt as a "use this verbatim" instruction; re-verified consistent
  after the fix. Text-only, per Phase 5's deferred voice layer (see below).
- **Access control verified**: a candidate JWT gets `403` from every `council/*` endpoint
  (`@Roles('RECRUITER','ORG_ADMIN','SUPER_ADMIN')`); a recruiter JWT succeeds.

**Deliberately deferred:**
- **Decision Cortex Q&A voice mode** — the doc says to reuse the Voice Director/Conversation
  Engine/Emotion Engine "already built for the AI Interviewer in Phase 5." Nothing to reuse: Phase 5
  explicitly deferred the entire Living Interviewer voice layer as its own dedicated pass (see §9).
  Decision Cortex Q&A will gain voice support once that infrastructure exists, not before.
- **Decision Cortex ↔ Prediction Engine wiring** — the doc's own instruction is for Decision Cortex to
  *consume* the DIG's Prediction Engine (§3.5) instead of computing predicted success independently.
  The Prediction Engine doesn't exist yet — it's explicitly Phase 7 scope ("build Decision DNA,
  Counterfactual Analysis, and Recovery Score... as report-generation features," per the build
  phases). `confidencePercent`/predicted-success currently come directly from the Decision Cortex
  agent's own reasoning; refactor to consume the Prediction Engine once Phase 7 builds it, per the
  doc's own sequencing — this isn't a Phase 6 gap, it's correctly waiting on a later phase.
- **§6.2 Reverse-interview scoring** (candidate asks 2-3 questions back, answered in character, scored
  as evidence) — not built this pass. It's a relatively self-contained feature that doesn't block the
  Decision Council's core deliberation system (Phase 6's namesake), so it was deprioritized in favor
  of finishing all four §6.3 recruiter surfaces with real depth rather than doing five things
  shallowly.
- **§6.1's "trigger an on-the-fly micro-simulation"** when Decision Cortex reports low confidence —
  the rest of 6.1 (adapting follow-up depth to evidence gaps) is already substantially satisfied by
  Phase 4's live evidence-aware questioning within a single interview session. Re-entering the
  simulation phase mid-interview to run a micro-simulation is an architecturally bigger change (HYRTE
  sessions currently move strictly `WORKSPACE_ACTIVE → INTERVIEW`, one-way) — noted, not built.

**Pre-existing gap surfaced, not fixed here**: HYRTE has no recruiter/organization assignment model
for its own sessions (unlike the main product's `Interview`/`InterviewSession`, which are org-scoped)
— every HYRTE session today is self-serve candidate practice with no recruiter attached. The
`council/*` endpoints are gated by role only (any `RECRUITER`), not "the recruiter who assigned this
candidate," because that relationship doesn't exist to scope against. This is the same gap Section
0.1 raised about HYRTE's recruiter/institution side generally (ARCHITECTURE.md §2) — building real
recruiter-assignment for HYRTE is a separate, larger scoping decision, not something to bolt on here.

Per the build prompt's own phase-gate rule, holding here for review before Phase 7 (Evaluation &
reporting — the shared metrics framework, Decision DNA, Counterfactual Analysis, Recovery Score, and
the Prediction Engine the Decision Cortex is meant to consume).

## 11. Phase 7 status: complete and verified (2026-08-01)

Built all three DIG read-models the doc explicitly names for this phase (Decision DNA, Recovery
Score, Counterfactual Analysis), plus the Prediction Engine (implied — Phase 6 deferred Decision
Cortex's predicted-success wiring specifically until this existed) and the §7 shared metrics
framework with culture-weighting. All built as genuine read-models over data already collected in
Phases 1-6 — no new data collection, matching the phase's own framing.

**Design**: `ReportIntelligenceService.compute()` runs after the Council convenes (still inside
`generateReport()`), as two grouped LLM calls rather than five separate ones — Decision
DNA/Recovery/Counterfactuals share a "look at the decision pattern" lens, Predictions/Metrics share a
"look at role fit + culture weighting" lens. All 5 outputs are nullable JSON columns on the existing
`HyrteInterviewReport` (Phase 6's precedent), so nothing about the report's identity changes — it
just gets richer.

**Built and verified end-to-end** (curl + browser, fresh EASY/Data-driven session run to completion):

- **Decision DNA (§3.5)**: constrained to the doc's fixed 10-trait vocabulary (never invents outside
  it — enforced by filtering the LLM's response against `DECISION_DNA_TRAITS` in code, not just
  prompted). Verified: returned `["data-driven", "execution-focused"]` with reasoning tied to the
  candidate's actual repeated emphasis on metrics — a correct read for a candidate who explicitly
  said "I always pull the actual metrics dashboard."
- **Recovery Score (§3.5)**: computed specifically from how the candidate handled being confronted
  with a contradiction/gap during the interview (acknowledge vs. deflect), not general competence —
  an explicit, documented interpretation choice given HYRTE has no other "recovery" signal wired up
  (the `recoveryOfId` self-relation built in Phase 1 has still never been populated by any caller;
  building the UI/flow to let candidates explicitly tag "this is a recovery from X" would be new data
  collection, which this phase's own framing rules out). Verified: scored 40/100 "Limited recovery"
  with reasoning correctly citing the candidate's repeated deflection when pressed for specifics.
- **Counterfactual Analysis (§3.5)**: an LLM-reasoned narrative over a real decision point from the
  Decision Graph, not a literal re-simulation with alternate inputs (that would be a materially larger
  feature — re-running the Living Organizational World Model with a different candidate action branch
  isn't built and is a fair scope boundary to hold here). Verified: produced a specific alternative
  path ("focus on customer support instead of the UI redesign") with a projected outcome grounded in
  the same company-state variables.
- **Prediction Engine (§3.5)**: 6 dimension-based success-likelihood predictions (Startup/Enterprise
  environments, IC/Leadership roles, high-ambiguity, customer-facing), each with a percentage-plus-
  qualitative likelihood and grounded reasoning — never a bare number. **Closed a real Phase 1 gap
  while building this**: `JobSuccessModelService.generateForSession()` existed since Phase 1 but was
  never called by anything in the live flow (only reachable via its own testing-only endpoint) — this
  is its first real caller (`ensureJobSuccessModel()`, lazily generating one if missing). Verified: a
  Job Success Model now exists for the test session with real core-outcomes/capability-requirements
  content, and the predictions visibly reference it.
- **Shared Metrics Framework (§7)**: all 8 applicable buckets scored 0-100 with mandatory
  plain-language explanations (the "AI/voice" bucket is intentionally omitted — no voice infra exists
  per Phase 5's deferral, and faking a score for it would violate the "never a bare number, never
  invented" guardrail worse than omitting it). Culture weights (`getCultureWeights`, built in Phase 3
  and unused until now) are injected into the scoring prompt so a Data-driven-culture session and a
  Sales-driven-culture session interpret the same evidence differently, per the doc's explicit intent.
- **Report page updated** to surface all of this (confidence badge, Decision DNA chips, Recovery
  Score, Evaluation Metrics meters reusing the existing `Meter` component, Predictions cards,
  Counterfactual callouts) — verified rendering correctly in-browser with zero console errors.

**Deliberately deferred:**
- **Recruiter dashboard views** (plural, aggregate-across-candidates) — genuinely blocked on the same
  gap Phase 6 surfaced: HYRTE has no recruiter/organization assignment model, so there is no "list of
  my assigned candidates" to build a dashboard over. The per-session data this phase produces is fully
  queryable by any recruiter via the existing `interview/report` and `council/*` endpoints — an
  aggregate dashboard requires the recruiter-assignment model first, which is a separate, larger
  scoping decision (same one flagged in Phase 0's Section 0.1 discussion).
- **Learning Engine (§3.5)** — explicitly Phase 9 (schema-only) per the build phases; not touched.

Per the build prompt's own phase-gate rule, holding here for review before Phase 8 (Hardening —
anti-gaming checks, audit logging, bias-auditor coverage review, the Multi-Day Memory session-flag
split).

## 12. Phase 8 status: complete and verified (2026-08-01)

The first phase with actual automated tests, not just curl/browser verification — fitting, since
"hardening" is explicitly about guarantees, and guarantees deserve a regression test, not just a
one-time manual check.

**Built and verified:**
- **Anti-gaming: cross-question validation (repetition detection)**: `repetition-detector.ts` — a
  pure Jaccard-similarity function flagging near-duplicate consecutive candidate answers, wired into
  `HyrteInterviewService.turn()` as a code-level guarantee rather than relying on the LLM noticing on
  its own (it had, unprompted, in earlier manual testing — nice but not something to depend on).
  Flagged turns get `metadata: { antiGamingFlag: 'repetitive_answer' }` on their evidence object and
  an explicit instruction is injected into the interviewer's prompt to call it out and press for
  specifics. **Verified live**: sent a lightly-reworded restatement of a prior answer and got back
  "It sounds like you're reiterating your process without providing new details" — confirmed the
  evidence object was tagged while the original wasn't. 5 unit tests in
  `test/repetition-detector.spec.ts`.
- **Audit logging across all agents**: new `HyrteAiAuditLog` table + `AuditLogService.run()` wrapper,
  applied to all 9 Council agents, the discussion synthesis, Decision Cortex Q&A, and both Report
  Intelligence calls — 12 wrapped operations per completed interview. Tracks success/failure/duration
  independent of what each agent concluded. **Verified live**: a completed session showed
  `totalAgentCalls: 12, failedAgentCalls: []`.
- **Bias-auditor coverage review**: answered directly by the audit log — `GET
  .../council/audit` returns `biasAuditorRan: true` (specifically checking for a successful
  `council.biasAuditor` entry), turning "is the Bias Auditor actually running for every session" from
  an assumption into a queryable fact. Verified true on the test session.
- **Multi-Day Memory (§4.15) — the security boundary, proven with tests, not just asserted**:
  1. `test/hyrte-memory-scoping.spec.ts` proves `HyrteStakeholderAgentService`'s memory query is
     always scoped to the exact sessionId it's called with, and that two different sessions' queries
     never cross-contaminate — this guarantee turned out to already hold from how the schema/queries
     were built in Phases 1-4, this test just makes it a regression-tested fact instead of an
     unverified assumption.
  2. **Built the positive feature this phase actually needed**: practice-mode candidates now get a
     "career continuity" note injected into their interview opening (referencing a prior practice
     session's recommendation + Decision DNA) — a scoped interpretation of 4.15's fuller vision (full
     same-company persistence across sessions would mean not regenerating a fresh company per
     session, a materially larger change to the Phase 2 fixture-per-session model, and is explicitly
     not what got built). The ASSESSMENT-mode gate is enforced as a hard `if (sessionType !==
     'PRACTICE') return ''` at the top of the query method — not a filter applied after the fact —
     and `test/hyrte-interview-continuity.spec.ts` proves an ASSESSMENT session's `startInterview()`
     never even issues the cross-session query, while a PRACTICE session's does, correctly scoped.
  3. All 25 tests across 6 suites pass (`npx jest`), including the 3 pre-existing suites this phase
     didn't touch (license-validator, risk-engine, plagiarism) — confirmed no regression.

**Deliberately deferred:**
- **Load/scale pass matching "100k+ concurrent"** — that claim belongs to marketing copy for the
  main product's existing (non-HYRTE) infrastructure. There's no environment in this session to load-
  test against, and doing so would require the actual deployed AWS infra, not local dev — out of
  scope for what's buildable here. Flagged, not silently dropped.
- **Full same-company Multi-Day Memory** (the complete 4.15 vision — one persistent, evolving company
  across many practice sessions) — see the scoped-interpretation note above. This is a real, larger
  feature for a future phase, not a gap in this one.

Per the build prompt's own phase-gate rule, holding here for review before Phase 9 (Learning Engine
— schema-only outcome-ingestion, per the build phases' own instruction not to build the retraining
loop yet).

## 13. Phase 9 status: complete and verified (2026-08-01) — all 9 build phases now done

The smallest phase by design, and the doc says so explicitly: schema + write/read path only, no
retraining loop, no aggregation, no scoring. Built exactly that and nothing more.

**Design**: modeled as an append-only event log (`HyrteHiringOutcomeEvent`), matching
`HyrteDecisionLogEntry`'s own shape, rather than one mutable row per candidate — a real hire
accumulates outcomes over months/years (hired → retained → promoted → eventually resigned), and an
event log makes each observation a permanent fact instead of overwriting history on every update.
8 event types from the doc's own list (HIRED, REJECTED, WITHDREW, OFFER_DECLINED,
RETENTION_CHECKPOINT, PROMOTED, RESIGNED, TERMINATED) plus an optional `performanceRating`
(HIGH_PERFORMER/MEETS_EXPECTATIONS/BELOW_EXPECTATIONS) on the events where that judgment applies.

**Built and verified**: `HiringOutcomeService` is deliberately just `record()` + `list()` — no
aggregation method exists, on purpose, matching the doc's "do not build the retraining loop yet."
New recruiter-gated endpoints under `hyrte/sessions/:id/hiring-outcome` (same role-only access
pattern as the Council endpoints, same documented gap: no recruiter/candidate assignment model to
scope against). Verified live: recorded a `HIRED` event then a later `RETENTION_CHECKPOINT` with
`performanceRating: HIGH_PERFORMER`, listed both back in chronological order, and confirmed a
candidate JWT gets `403` while a recruiter JWT succeeds.

**This closes out all 9 build phases from the merged doc.** Summary of what exists vs. what's
deliberately still open is in the per-phase sections above (§5-§13). One standing item remains:
**nothing in this entire 9-phase build has been committed to git or deployed** — every change across
all 9 phases is still uncommitted working-tree state.

## 14. Decision Cortex ↔ Prediction Engine loop: closed (2026-08-02)

The one dropped thread flagged at the end of Phase 9 — Decision Cortex was still computing
predicted-success independently rather than consuming the Prediction Engine, as the doc's §6.4 note
explicitly asks for. Closed now.

**What changed:**
- **Reordered `generateReport()`**: `ReportIntelligenceService.compute()` (the Prediction Engine, §7)
  now runs *before* `DecisionCouncilService.convene()`, not after — the Prediction Engine's output
  has to exist before Decision Cortex can consume it. `compute()` now returns its `predictions` array
  (in addition to persisting it) so the caller can hand it straight to `convene()`.
- **`DecisionCouncilService.convene()`** takes an optional `predictions` param, threaded only into
  the Decision Cortex agent's prompt (the other 8 agents are unaffected — this is specifically
  Decision Cortex's mandate). Its instruction: derive `confidencePercent` as a reasoned synthesis of
  the per-dimension likelihoods, weighted toward the candidate's actual target role/environment, and
  never contradict the Prediction Engine data.
- **`DecisionCortexService.ask()`** (the recruiter Q&A engine) previously didn't reference
  `report.predictions` in its context AT ALL — a real gap found while closing this loop, not just the
  originally-flagged one. Now includes it, with an explicit instruction to answer "how will they
  perform in X" questions from that stored data rather than estimating fresh.

**Verified live**: an Enterprise/Senior/Data-driven session's Prediction Engine produced Enterprise
78%, high-ambiguity 50%, others in between. Decision Cortex's `confidencePercent` came back as 70% —
sensibly weighted toward the Enterprise number (this candidate's actual target environment) rather
than a flat average of all six dimensions. Then asked the Q&A engine to compare high-ambiguity vs.
enterprise performance and got back "...weakly (50%)... strongly (78%)" — the exact stored numbers,
verbatim, not fresh estimates.

All 25 existing tests still pass; no test changes were needed for this fix (nothing it touches was
under test coverage — the existing Council/Cortex tests are integration-level curl verification, not
unit tests, consistent with how those services were verified throughout Phases 6-7).
