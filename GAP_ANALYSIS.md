# HYRTE — Simulation Workflow Upgrade: Gap Analysis (U0)

Audited against the 20-step pipeline + Section 1 entry point in the upgrade prompt (dated 2026-08-03).
Method: read the actual schema (`prisma/schema.prisma`), the actual services (`hyrte-sessions.service.ts`,
`simulation-generator.service.ts`, `hyrte-workplace.service.ts`, `consequence.service.ts`,
`stakeholder-agent.service.ts`, `job-success-model.service.ts`), the actual entry-point page
(`apps/web/src/app/hyrte/page.tsx`), and the repo's own prior self-audit (`ARCHITECTURE.md`, 9 phases,
dated 2026-08-01/02) — not surface impressions. Corrects the prompt's own §0.5 observations where they
don't match the code (see note at the end).

## Gap table

| Pipeline element | Exists today? | Where in the codebase | What must change |
|---|---|---|---|
| **§1 Entry point** (JD intake, Job Success Model, six-seed Recruiter Config, `SimulationRequest`) | **Partial** | `apps/web/src/app/hyrte/page.tsx` (candidate-facing six-seed form); `job-success-model.service.ts` (`generateFromText`) | Wrong owner (candidate, not recruiter — no recruiter/candidate assignment model exists for HYRTE at all) and wrong order (session/world is created *first* from the six seeds; JD text, if pasted, is submitted *afterward* to a separate best-effort endpoint that only updates a `JobSuccessModel` row and never reaches the generator). No `SimulationRequest` object exists in any form. |
| **Step 1 — Simulation Request** | **No** | `CreateHyrteSessionDto` → `HyrteSessionsService.create()` | The six seeds go straight from the candidate's form into the generator call. There is no intermediate `SimulationRequest` object, no single accepted input shape gating generation. |
| **Step 2 — World Generation** (Company/Organization/Company State) | **Partial** | `simulation-generator.service.ts` (company name + `missionBrief` narrative); `HyrteCompanyState` model | Company name + a 4-field narrative brief + 16 numeric KPIs exist. No `Organization`/department/reporting-hierarchy model for the *simulated* company (the schema's only `Organization` model is the real platform tenant — a recruiter's own account — completely unrelated). No structured products/revenue-as-figure/employee-count/named-customer entities; "current crisis" and "company history" are implicit in one paragraph of prose, not structured fields. |
| **Step 3 — Stakeholder Generation** | **Partial** | `HyrteStakeholder` model; `stakeholder-agent.service.ts` | Has: name, role (free string), personality JSON (traits/goals), hiddenIntention, trust/respect/cooperation/influence, stress/urgency/patience/motivation, per-stakeholder memory. Missing: `department` field, explicit KPIs field, "current tasks" linkage (`HyrteTask` has no assignee), stakeholder↔stakeholder relationships (today's 4 relationship numbers are *toward the candidate only*), explicit "authority level"/"experience" fields. Names randomize per session (good, anti-cheat-friendly) but role *archetypes* are freely regenerated text too, not pinned to a fixed library, so identical seeds don't guarantee identical role structure across sessions. |
| **Step 4 — Knowledge Generation** | **Partial** | `HyrteKnowledgeDoc` model, generated per session | 2-4 docs with freeform `category` string. The doc's fuller list (wiki, PRDs, API docs, HR policy, sales decks, roadmap, backlog, financial reports, customer history, meeting notes) isn't represented as distinct types — narrower breadth than the pipeline wants, but the mechanism (LLM-generated, consistent with the same company) is sound. |
| **Step 5 — Workplace Assets** | **Partial/Yes** | `HyrteInboxMessage`, `HyrteSlackMessage`, `HyrteTask`, `HyrteCalendarEvent`; `/hyrte/session/[id]/*` pages | Inbox, Slack (channels + DMs), tasks, calendar all exist and are pre-populated per session. Missing as distinct generated assets: notifications (real-time updates arrive via WebSocket only, no persisted notification feed), pending approvals, work-product documents (KB docs exist but aren't candidate-editable deliverables), and meetings are calendar entries (title/time) with no agenda/attendee/content surface. |
| **Step 6 — Event Queue** | **No** | `arrivesLater: boolean` + a random 12-35s delay timer in `hyrte-sessions.service.ts`; `scheduleIgnoredCheck`/`scheduleChaosWave` in `consequence.service.ts` | No `EventQueue` table, no `immediate`/`scheduled`/`conditional` tagging as first-class objects. What exists is imperative `setTimeout` logic scattered in service code (functionally a crude analog to "scheduled" and "conditional," but not a declarative, pre-generated, inspectable queue). |
| **Step 7 — Initial Evaluation Plan** | **Partial/Yes** | `InvestigationPlan` model + service (§3.4) | LLM-backed, consumes the Job Success Model + current evidence coverage, correctly reports gaps. Close in spirit to "what to observe, no scores yet" — just not literally shaped as the doc's 8 named observation categories. |
| **World Stabilization Gate** | **No** — the single largest structural gap | `sanitizeFixture()` in `simulation-generator.service.ts` | Does schema/range validation (clamps 0-100, caps array sizes, drops malformed entries) and *silently repairs* dangling `fromKey` references by repointing to a random valid stakeholder. This is fundamentally different from the pipeline's requirement: no cross-entity consistency pass, no pass/fail gate, no repair-loop-with-retry-limit, no persisted validation report, and nothing blocks Mission Brief entry — a broken-but-"repaired" world is indistinguishable from a good one today. |
| **Step 8 — Mission Brief** | **Yes** | `HyrteSession.missionBrief`, phase `MISSION_BRIEF`, `/hyrte/session/[id]/mission-brief` | Built and pulls entirely from the generated world (objective/whyItMatters/currentHealth/successMetrics). Reasonably solid match. |
| **Step 9 — Role Calibration** | **Partial** | Phase `BASELINE_SKILL_CHECK`, `HyrteSession.baselineChallenge`/`baselineResponse` | Today: one prioritization scenario, 3 MCQ-style options + free-text reasoning. The doc wants a broader battery (role knowledge, decision framework, tools familiarity, industry basics) — today's version is one judgment call, not multi-dimension. Written to Evidence Graph, but doesn't yet adjust event difficulty weights afterward (confirmed uninterpreted per `ARCHITECTURE.md` §6). |
| **Step 10 — Candidate Enters Workplace** | **Yes** | Phase `WORKSPACE_ACTIVE`; `/hyrte/session/[id]/{dashboard,inbox,slack,tasks,calendar,knowledge-base,analytics}` | Solid. Minor gap: no dedicated "Notifications" surface (real-time pushes are ephemeral WebSocket events, not a persisted feed). |
| **Step 11 — Candidate Observes** (passive behavioral tracking) | **Partial** | Only specific actions are logged (`hyrte-workplace.service.ts`'s `logDecision()` calls) | What opened first, dwell time per surface, navigation order are **not** tracked at all — only explicit actions (reply, send, task-status-change, KB view) become evidence. Passive browsing behavior generates zero signal today. |
| **Step 12 — Candidate Acts → structured event** | **Partial** | `hyrte-workplace.service.ts` (`replyInbox`/`sendSlack`/`updateTask`) | Actions do get logged as structured Decision Graph nodes + Evidence objects. But there is no single funnel — each action type calls its own downstream handler directly. |
| **Step 13 — Decision Engine** (change-set before anything responds) | **No** — the second-largest structural gap | N/A — logic is split across `hyrte-workplace.service.ts`, `consequence.service.ts`, `stakeholder-agent.service.ts` | Confirmed by reading the code directly: `replyInbox()` calls `logDecision()` then immediately fires `agent.respond()` (fire-and-forget) — state-delta computation and reply-generation happen *together*, inside one LLM call per handler, not as a separate, inspectable change-set object computed first. There is no module that answers "who's affected / does state change / do relationships change / should new events spawn" as one step before anything reacts. |
| **Step 14 — Company State Update** (versioned) | **Partial** | `HyrteCompanyState` (single mutable row, updated in place by `consequence.service.ts`) | The single-mutable-object part matches exactly. No history/versioning — past values are overwritten, not snapshotted, so "show state evolution over time" in the final report isn't literally possible from this table today (only the Decision Graph's text log approximates a timeline). |
| **Step 15 — Stakeholder AI Thinks** (own memory/emotion/relationships) | **Yes, strong match** | `stakeholder-agent.service.ts`, `HyrteStakeholderMemory` | Genuinely conditions each reply on that stakeholder's own memory, relationship state, and emotional state (not a global narrator) — this is one of the best-built parts of the existing system. Gap: no independent/incomplete worldview (every stakeholder implicitly sees the same Knowledge Base) and no stakeholder-disagrees-with-stakeholder mechanic. |
| **Step 16 — AI Responds** (independent, unsynchronized, correct surface, realistic delay) | **Partial/Yes** | `reactIndependently()` (0.5 probability, `stakeholder-agent.service.ts`) | Independent/unsynchronized reactions from non-party stakeholders are real and verified live. Direct replies to the candidate's own action fire almost immediately (fire-and-forget async, seconds not hours) — only the chaos-wave and ignored-message paths are deliberately delayed. |
| **Step 17 — Chaos Engine** | **Partial** | `scheduleChaosWave`/`triggerChaosWave` in `consequence.service.ts` | One wave of 2-3 correlated messages, content is state-aware (targets the worst KPI) — but timing is a fixed delay (100s from workspace unlock), not attention/pace-instrumented, and it's a single wave per session, not intervals plural, and not literally drawn from an Event Queue (none exists). |
| **Step 18 — Candidate Reacts → loop to Step 13** | **Yes in effect, not architecturally** | Same handlers as Step 12 | The loop exists functionally (the candidate can keep acting, handlers keep firing) but since Step 13's Decision Engine doesn't exist as a distinct component, "returns to Step 13" is a loose analogy today, not a literal shared re-entrant path. |
| **Step 19 — Recovery Phase** | **Partial** | `HyrteDecisionLogEntry.recoveryOfId`/`recoveries` (schema, Phase 1); Recovery Score in `ReportIntelligenceService` | The schema field for linking a recovery action to the mistake it recovers from exists but **has never been populated by any caller** (confirmed in `ARCHITECTURE.md` §11). Recovery Score is computed narrowly from how the candidate handled being confronted with a contradiction *during the reflection interview*, not from in-simulation recovery actions during Phase 3 itself. |
| **Step 20 — End Simulation / Evaluation Compile** | **Yes, strong match — best-built part of the system** | `DecisionCouncilService`, `DecisionCortexService`, `ReportIntelligenceService`, `HyrteInterviewReport` | 9-agent Decision Council with deterministic vote tally, Decision Cortex Q&A, Decision DNA/Recovery Score/Counterfactuals/Predictions/culture-weighted Metrics — all built, verified, and already exactly what the prompt says not to rebuild. Feeds a behavioral recommendation grounded in evidence, never a bare number. |
| **Cross-cutting: Evidence Graph as spine** | **Yes, strong match** | `EvidenceObject`/`EvidenceLink`, `EvidenceGraphService` | `EvidenceType` enum already has `SIMULATION_ACTION`, `SIMULATION_DECISION`, `STAKEHOLDER_INTERACTION`, `BEHAVIORAL_SIGNAL`, `SKILL_DEMONSTRATION`, `CONTRADICTION`, `ETHICAL_DECISION` — near 1:1 with the pipeline's required evidence object types. This is genuinely solid and should not be rebuilt. |
| **Cross-cutting: `world_id` on every asset** | **No** (low-risk gap) | — | No explicit `world_id` field anywhere; `sessionId` is the de facto equivalent since one session = one generated world with no reuse across sessions today. Functionally fine, but not literally what the prompt asks for — worth adding explicitly if any future feature needs to distinguish "world" from "session" (e.g. re-running a world with a different candidate). |
| **Cross-cutting: delayed, not instant, consequences** | **Partial** | `consequence.service.ts` | Ignored-message escalation and the chaos wave are deliberately delayed. Direct stakeholder replies to the candidate's own action are not — they resolve in seconds via a fire-and-forget async call, not modeled as a realistic multi-hour delay. |
| **Cross-cutting: AI interviewer stays a subsystem** | **Yes** | `hyrte-interview.service.ts`, phase enum | Interview only runs in the `INTERVIEW` phase, strictly after `WORKSPACE_ACTIVE` — no evidence of question-flow leaking into the Phase 3 workspace loop. |

## Answers to the six required questions

1. **What currently triggers simulation content generation, and what inputs does it use?**
   `POST /hyrte/sessions` (`HyrteSessionsService.create()`), called directly from the candidate-facing
   `/hyrte` page. Inputs: exactly the six seed fields (`role`, `experienceLevel`, `industry`,
   `companyType`, `difficulty`, `culture`) via `CreateHyrteSessionDto`, passed straight into
   `HyrteSimulationGeneratorService.generate(dto)`. A pasted JD, if any, is submitted **separately and
   afterward** to `/profile/ingest/job-description` — a best-effort call (failures are silently
   swallowed) that only creates/updates a `JobSuccessModel` row. The generator itself never receives or
   reads that JD text or its decomposition — it has zero influence on the generated company, stakeholders,
   or events.

2. **Does a single mutable Company State object exist? Where does state live today?**
   Yes: `HyrteCompanyState`, one row per `HyrteSession` (`sessionId` is its primary key), 16 integer KPIs
   (revenue, customerSatisfaction, engineeringCapacity, technicalDebt, teamMorale, budget, riskLevel,
   deadlinePressure, marketReputation, cashRunway, complianceRisk, productQuality, burnout,
   hiringCapacity, operationalRisk, growth). Mutated in place by direct Prisma updates from
   `consequence.service.ts` and the stakeholder agent. No history/versioning table exists — once a value
   changes, the prior value is gone except as inferable text in the Decision Graph log.

3. **Do stakeholders have persistent per-session memory/emotion state, or are they stateless prompt personas?**
   Persistent, genuinely — not stateless. `HyrteStakeholder` carries live trust/respect/cooperation/
   influence and stress/urgency/patience/motivation values, read and updated after every interaction;
   `HyrteStakeholderMemory` is a per-stakeholder conversation transcript read back on every subsequent
   reply to stay coherent. Real gaps: relationship state is candidate-facing only (no
   stakeholder↔stakeholder relationship modeling), and every stakeholder implicitly has access to the
   same generated Knowledge Base — there's no "independent, incomplete worldview" per stakeholder yet.

4. **Are candidate actions routed through any central decision layer today, or do surfaces respond independently?**
   Surfaces respond independently, per action type, procedurally. `HyrteWorkplaceService`'s
   `replyInbox`/`sendSlack`/`updateTask` each directly call whichever handler owns that action's
   consequences (`HyrteStakeholderAgentService.respond()`, `HyrteConsequenceService.reasonTaskConsequence()`,
   `scheduleIgnoredCheck()`) as soon as the action is logged. There is no shared Decision Engine module all
   actions pass through first, and no formal, inspectable change-set object computed before any of these
   fire — this is the single biggest architectural gap versus the target pipeline.

5. **Is there any validation between generation and candidate entry today?**
   Only inline sanitization at generation time (`sanitizeFixture()`): clamps KPI numbers to 0-100, caps
   array sizes, drops malformed entries, and silently re-points dangling `fromKey` references to a random
   valid stakeholder rather than rejecting or regenerating. There is no post-generation cross-entity
   consistency pass, no pass/fail gate, no repair-loop with a retry limit, and no persisted validation
   report — nothing currently prevents a candidate from entering a world with subtle inconsistencies, it's
   just less likely because sanitization repairs the most obvious breakage (orphan references) silently.

6. **Where does the flow currently start, and what needs to move so it starts at the Job Description / Recruiter Configuration section?**
   Starts at `/hyrte` — a candidate-facing six-seed picker gated only behind candidate login
   (`requiredRoles={['CANDIDATE']}`). There is no recruiter-facing configuration screen anywhere in the
   repo. To match Section 1: (a) the entry point needs a recruiter-owned surface — which also means
   confronting the pre-existing, repeatedly-flagged gap that **HYRTE has no recruiter/candidate assignment
   model at all** (every session today is self-serve candidate practice; this was already surfaced three
   separate times in `ARCHITECTURE.md`'s own Phase 6/7/9 audits, unrelated to this new prompt); (b) JD
   decomposition needs to run and produce a real `SimulationRequest` **before** generation is callable,
   not as an optional afterthought; (c) the six seeds need to become recruiter-set/JD-prefilled defaults,
   not a candidate's own free picks.

## Note: correcting the prompt's own §0.5 observations

Section 0.5 states World Generation, Company/Organization/Company State, Stakeholder agents, Knowledge
Base, Workplace Assets, Event Queue, Mission Brief, Role Calibration, and HYRTE branding are all "confirmed
ABSENT" from the deployed product. That's only true if you stop at the surface the interview/proctoring
product shows. All of the above exist at `/hyrte` and its sub-routes, in a substantial, mostly-working
form (see table above) — this was a 9-phase build already completed in an earlier session (documented in
full in `ARCHITECTURE.md`), just not yet linked from the main product's top-level nav in a way that made it
obviously discoverable during a surface-level pass. The real gaps are the ones in the table: no formal
Event Queue, no real Stabilization Gate, no formal Decision Engine, no recruiter-owned entry point — not
"none of this exists."
