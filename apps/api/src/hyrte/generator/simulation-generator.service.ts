import { Injectable, Logger } from '@nestjs/common';
import { AIService } from '../../ai/ai.service';
import { CreateHyrteSessionDto } from '../dto/hyrte.dto';
import { COMPANY_STATE_KEYS } from '../consequences/consequence.service';
import { ValidationReport, WorldStabilizationError, validateWorld } from './world-stabilization';
import { applyIndustryBias, industryGroundingNote } from './industry-templates';
import { resolveSignatureArtifact } from './signature-artifacts';
import {
  FixtureCalendarEvent,
  FixtureDepartment,
  FixtureEvaluationPlanItem,
  FixtureInboxMessage,
  FixtureKnowledgeDoc,
  FixtureMissionBrief,
  FixtureScheduledEvent,
  FixtureSignatureArtifact,
  FixtureSlackMessage,
  FixtureStakeholder,
  FixtureTask,
  HyrteFixture,
} from '../fixtures/hyrte-fixture.types';

/** §2 World Stabilization Gate — regenerate + re-validate up to this many times before surfacing an error. */
const MAX_REPAIR_LOOPS = 3;

const CAPS = {
  stakeholders: 6,
  inbox: 3,
  slack: 3,
  tasks: 4,
  calendarEvents: 3,
  knowledgeDocs: 8,
  successMetrics: 4,
  baselineOptions: 4,
  departments: 5,
};

/**
 * Upgrade — Event Queue full-session coverage. Previously a fixed 2-4 entries
 * clamped to a 10-120s offset regardless of session length — a "starter"
 * queue covering only the first ~75s of even a 30-minute EXPERT session, with
 * everything else past that left to the purely-reactive mechanisms (Chaos
 * Engine, escalations, Orchestrator). Now scales with difficulty the same way
 * BURST_SIZE_BY_DIFFICULTY does elsewhere (consequence.service.ts) — more
 * events, spread across more of the session, for harder difficulties. The max
 * offset is capped below the full planned duration (matches
 * PLANNED_DURATION_MINUTES on the frontend, hyrte-types.ts) rather than 100%
 * of it, deliberately: the last stretch of a session is for wrapping up
 * work-in-progress and transitioning to the reflection interview, not for
 * fresh demands landing with no time left to act on them.
 */
export const EVENT_QUEUE_SIZE_BY_DIFFICULTY: Record<string, number> = { EASY: 4, MEDIUM: 6, HARD: 8, EXPERT: 10 };
export const EVENT_QUEUE_MAX_OFFSET_SECONDS_BY_DIFFICULTY: Record<string, number> = {
  EASY: 600, // 15-min planned session, queue reaches to the 10-min mark
  MEDIUM: 840, // 20-min session, 14-min mark
  HARD: 1080, // 25-min session, 18-min mark
  EXPERT: 1320, // 30-min session, 22-min mark
};

/**
 * Upgrade §1 grounding — when a session is launched from a recruiter's
 * SimulationRequest (a real, decomposed JD), every pipeline step below gets
 * the actual core outcomes / capability requirements / industry themes
 * folded into its prompt, so the generated crisis/tasks/inbox trace back to
 * the real JD instead of just the six seed labels. Undefined for self-serve
 * PRACTICE sessions (unchanged behavior — six seeds only).
 */
export interface JobSuccessModelGrounding {
  coreOutcomes: string[];
  capabilityRequirements: { skill: string; importance: string; depth?: string }[];
  industryProbeThemes: string[];
}

/** One row per pipeline step — persisted by the caller (HyrteSessionsService) once the session exists. */
export interface WorldGenerationArtifact {
  step: 'company_org' | 'stakeholders' | 'knowledge' | 'workplace_assets' | 'event_queue' | 'signature_artifact' | 'evaluation_plan' | 'stabilization_gate';
  // FAILED_FELL_BACK — validation never passed, caller substituted the static
  // fallback fixture (PRACTICE sessions only). FAILED_BLOCKED — validation
  // never passed and the caller declined to substitute anything (ASSESSMENT
  // sessions — see HyrteSessionsService.populateWorld's GENERATION_FAILED
  // branch).
  status: 'OK' | 'FAILED_FELL_BACK' | 'FAILED_BLOCKED';
  payload: unknown;
}

export interface GeneratedWorld {
  fixture: HyrteFixture;
  artifacts: WorldGenerationArtifact[];
}

interface CompanyOrgResult {
  companyName?: string;
  companyState?: Record<string, unknown>;
  missionBrief?: Record<string, unknown>;
  baselineChallenge?: Record<string, unknown>;
  departments?: { name?: unknown }[];
}

interface StakeholdersResult {
  stakeholders?: Record<string, unknown>[];
}

interface KnowledgeResult {
  knowledgeDocs?: Record<string, unknown>[];
}

interface WorkplaceAssetsResult {
  inbox?: Record<string, unknown>[];
  slack?: Record<string, unknown>[];
  tasks?: Record<string, unknown>[];
  calendarEvents?: Record<string, unknown>[];
}

interface EventQueueResult {
  scheduledEvents?: Record<string, unknown>[];
}

interface EvaluationPlanResult {
  evaluationPlan?: Record<string, unknown>[];
}

interface SignatureArtifactResult {
  title?: string;
  description?: string;
}

/**
 * Upgrade §2/§6 — the generation pipeline, restructured into 6 ordered steps
 * (was: one mega-call producing the entire fixture as a single JSON blob).
 * Each step is its own LLM call, informed by the REAL output of the steps
 * before it (stakeholders see the real department list; knowledge/workplace
 * assets/event-queue see the real stakeholder roster) — this is what actually
 * cuts down on dangling references, not just post-hoc repair. Each step's raw
 * + sanitized output is returned as a WorldGenerationArtifact for the caller
 * to persist (doc's "persisted intermediate artifacts per step"). Step 7 —
 * D7 Evaluation Plan — runs last, since it maps observation targets onto the
 * real tasks/inbox/slack/events steps 5-6 already produced.
 */
@Injectable()
export class HyrteSimulationGeneratorService {
  private readonly logger = new Logger(HyrteSimulationGeneratorService.name);

  constructor(private readonly ai: AIService) {}

  /**
   * Upgrade §2 — World Stabilization Gate. Runs the full pipeline, validates
   * the result with real code checks (world-stabilization.ts), and — if it
   * fails — regenerates and re-validates, up to MAX_REPAIR_LOOPS times, never
   * returning an unvalidated world. Retries the WHOLE pipeline per attempt
   * rather than surgically re-running only the failing step in isolation:
   * the steps are sequentially dependent (stakeholders feed knowledge/
   * assets/events), so a full retry is simpler and no less correct for a
   * linear pipeline — a documented scope simplification, not an oversight.
   */
  async generate(dto: CreateHyrteSessionDto, grounding?: JobSuccessModelGrounding): Promise<GeneratedWorld> {
    let lastReport: ValidationReport | undefined;
    for (let attempt = 1; attempt <= MAX_REPAIR_LOOPS; attempt++) {
      try {
        const { fixture, artifacts } = await this.generateOnce(dto, grounding);
        const report = validateWorld(fixture, artifacts, attempt, dto.difficulty);
        artifacts.push({ step: 'stabilization_gate', status: report.passed ? 'OK' : 'FAILED_FELL_BACK', payload: report });
        if (report.passed) return { fixture, artifacts };
        lastReport = report;
      } catch (e) {
        // A degenerate pipeline run (e.g. zero valid stakeholders) is itself
        // a stabilization failure, not a different error class — retry it
        // the same way as a soft validation failure.
        const msg = e instanceof Error ? e.message : String(e);
        lastReport = { passed: false, attempt, checks: [{ name: 'pipeline_run', passed: false, detail: msg }] };
      }
      this.logger.warn(
        `World failed stabilization (attempt ${attempt}/${MAX_REPAIR_LOOPS}): ` +
          lastReport.checks.filter((c) => !c.passed).map((c) => `${c.name} — ${c.detail}`).join(' | '),
      );
    }
    // Never admit the candidate into a broken world — the caller
    // (HyrteSessionsService) catches this and falls back to the hand-authored
    // static fixture, which is definitionally valid, persisting this report
    // for debugging rather than silently discarding it.
    throw new WorldStabilizationError(lastReport!);
  }

  private async generateOnce(dto: CreateHyrteSessionDto, grounding?: JobSuccessModelGrounding): Promise<GeneratedWorld> {
    const artifacts: WorldGenerationArtifact[] = [];
    const nonce = Math.random().toString(36).slice(2, 8);
    const groundingNote = this.groundingNote(grounding);
    // Recruiter doc §2 — real industry template grounding (concrete
    // vocabulary/stakeholder-archetypes/typical-crises), not just the
    // industry's name dropped into a sentence.
    const industryNote = industryGroundingNote(dto.industry);

    // Step 2 — Company + Organization + Company State.
    const companyOrg = await this.step<CompanyOrgResult>(
      'company_org',
      artifacts,
      COMPANY_ORG_SYSTEM,
      `Generate a company for a ${dto.experienceLevel} ${dto.role} at a ${dto.companyType} company in ` +
        `the ${dto.industry} industry. Difficulty: ${dto.difficulty} — reflect this in how bad the ` +
        `starting company-state numbers are and how many things are simultaneously on fire. Company ` +
        `culture: ${dto.culture} — reflect this only in tone/flavor, not the numeric state. Invent a ` +
        `unique fictional company name — do not reuse common example names like Acme, Nimbus, or ` +
        `TechCorp. Variety seed: ${nonce}.${groundingNote}${industryNote}`,
      () => ({
        companyName: 'Unnamed Co',
        companyState: {},
        missionBrief: {},
        baselineChallenge: {},
        departments: [{ name: 'Engineering' }, { name: 'Product' }, { name: 'Operations' }],
      }),
    );
    const companyName = typeof companyOrg.companyName === 'string' && companyOrg.companyName.trim() ? companyOrg.companyName.trim() : 'Unnamed Co';
    const departments = sanitizeDepartments(companyOrg.departments);
    // Real, deterministic per-industry bias — a guarantee, not a prompt hope.
    const companyState = applyIndustryBias(sanitizeCompanyState(companyOrg.companyState), dto.industry);
    const missionBrief = sanitizeMissionBrief(companyOrg.missionBrief);
    const baselineChallenge = sanitizeBaselineChallenge(companyOrg.baselineChallenge);

    // Step 3 — Stakeholder Generation, informed by the real company + departments above.
    const stakeholdersRaw = await this.step<StakeholdersResult>(
      'stakeholders',
      artifacts,
      STAKEHOLDERS_SYSTEM,
      `Company: ${companyName}. Departments: ${departments.map((d) => d.name).join(', ')}. Role this ` +
        `candidate is filling: ${dto.experienceLevel} ${dto.role}. Difficulty: ${dto.difficulty} — higher ` +
        `difficulty means higher stress/urgency and lower patience across the roster. Culture: ${dto.culture}.${industryNote}`,
      () => ({ stakeholders: [] }),
    );
    const stakeholders = sanitizeStakeholders(stakeholdersRaw.stakeholders, departments);
    if (stakeholders.length === 0) throw new Error('Generated fixture had no valid stakeholders');
    assignDepartmentHeads(departments, stakeholders);
    const roster = stakeholders.map((s) => ({ key: s.key, name: s.name, role: s.role, department: s.department }));

    // Upgrade §4/Step 8 — the candidate's manager is the highest-authority
    // real stakeholder, computed after generation, never LLM-invented
    // separately (which risks naming someone who doesn't exist in the world).
    const manager = stakeholders.reduce((a, b) => ((b.authorityLevel ?? 50) > (a.authorityLevel ?? 50) ? b : a));
    missionBrief.manager = { name: manager.name, role: manager.role };

    // Doc §22 — Role-Specific Signature Challenges. Resolved deterministically
    // from the role (not LLM-guessed which artifact TYPE fits the role — only
    // its specific title/description are LLM-generated, grounded in the real
    // company situation below).
    const artifactTemplate = resolveSignatureArtifact(dto.role);

    // Steps 4-7 — Knowledge, Workplace Assets, Event Queue, and the Signature
    // Artifact are each only informed by the real stakeholder roster from
    // Step 3, not by each other's output, so they run concurrently rather
    // than as 4 more sequential round-trips (this materially cuts real-world
    // latency — 5 sequential LLM calls was measured live to push total
    // generation time past what the dev proxy chain tolerates, causing
    // spurious "Internal Server Error" responses even on a fully successful
    // generation).
    const [knowledgeRaw, assetsRaw, eventQueueRaw, signatureArtifactRaw] = await Promise.all([
      this.step<KnowledgeResult>(
        'knowledge',
        artifacts,
        KNOWLEDGE_SYSTEM,
        `Company: ${companyName}. Roster: ${JSON.stringify(roster)}. Role: ${dto.role} (${dto.industry}).${industryNote}`,
        () => ({ knowledgeDocs: [] }),
      ),
      this.step<WorkplaceAssetsResult>(
        'workplace_assets',
        artifacts,
        WORKPLACE_ASSETS_SYSTEM,
        `Company: ${companyName}. Roster: ${JSON.stringify(roster)}. Role: ${dto.role}.${groundingNote}`,
        () => ({ inbox: [], slack: [], tasks: [], calendarEvents: [] }),
      ),
      this.step<EventQueueResult>(
        'event_queue',
        artifacts,
        eventQueueSystem(dto.difficulty),
        `Company: ${companyName}. Roster: ${JSON.stringify(roster)}.`,
        () => ({ scheduledEvents: [] }),
      ),
      this.step<SignatureArtifactResult>(
        'signature_artifact',
        artifacts,
        SIGNATURE_ARTIFACT_SYSTEM,
        `Company: ${companyName}. Role: ${dto.role}. Mission objective: ${missionBrief.objective}. Current ` +
          `health: ${missionBrief.currentHealth}. Roster: ${JSON.stringify(roster)}. The candidate must ` +
          `produce ${artifactTemplate.promptHint}.`,
        () => ({ title: '', description: '' }),
      ),
    ]);
    const knowledgeDocs = sanitizeKnowledgeDocs(knowledgeRaw.knowledgeDocs);
    const signatureArtifact = sanitizeSignatureArtifact(signatureArtifactRaw, artifactTemplate.label, companyName);
    const validKeys = new Set(stakeholders.map((s) => s.key));
    const resolveKey = (k: unknown) => (typeof k === 'string' && validKeys.has(k) ? k : roster[Math.floor(Math.random() * roster.length)].key);
    const inbox = sanitizeInbox(assetsRaw.inbox, resolveKey);
    const slack = sanitizeSlack(assetsRaw.slack, resolveKey);
    const tasks = sanitizeTasks(assetsRaw.tasks);
    const calendarEvents = sanitizeCalendarEvents(assetsRaw.calendarEvents, validKeys);
    if (inbox.length === 0 && slack.length === 0) throw new Error('Generated fixture had no inbox or Slack content');
    const scheduledEvents = sanitizeScheduledEvents(
      eventQueueRaw.scheduledEvents,
      resolveKey,
      EVENT_QUEUE_SIZE_BY_DIFFICULTY[dto.difficulty] ?? EVENT_QUEUE_SIZE_BY_DIFFICULTY.MEDIUM,
      EVENT_QUEUE_MAX_OFFSET_SECONDS_BY_DIFFICULTY[dto.difficulty] ?? EVENT_QUEUE_MAX_OFFSET_SECONDS_BY_DIFFICULTY.MEDIUM,
    );

    // Step 7 — D7 Evaluation Plan. Runs last and is given the real generated
    // content (not just role/industry labels) so "which events surface each
    // signal" points at things that actually exist in this world.
    const contentSummary = JSON.stringify({
      tasks: tasks.map((t) => t.title),
      inbox: inbox.map((m) => m.subject),
      slack: slack.map((m) => m.body.slice(0, 80)),
      scheduledEvents: scheduledEvents.map((e) => e.body.slice(0, 80)),
    });
    const evaluationPlanRaw = await this.step<EvaluationPlanResult>(
      'evaluation_plan',
      artifacts,
      EVALUATION_PLAN_SYSTEM,
      `Role: ${dto.experienceLevel} ${dto.role}. Company: ${companyName}. This world's real generated ` +
        `content (tasks/inbox/slack/scheduled events): ${contentSummary}.`,
      () => ({ evaluationPlan: [] }),
    );
    const evaluationPlan = sanitizeEvaluationPlan(evaluationPlanRaw.evaluationPlan);

    return {
      fixture: {
        companyName,
        companyState,
        missionBrief,
        baselineChallenge,
        departments,
        stakeholders,
        inbox,
        slack,
        tasks,
        calendarEvents,
        knowledgeDocs,
        scheduledEvents,
        evaluationPlan,
        signatureArtifact,
      },
      artifacts,
    };
  }

  private groundingNote(grounding?: JobSuccessModelGrounding): string {
    if (!grounding) return '';
    return (
      '\n\nThis simulation must be grounded in a REAL job description a recruiter provided — the crisis, ' +
      'tasks, and inbox/Slack content should let the candidate actually demonstrate or fail these specific ' +
      `things, not generic role busywork:\n` +
      `- Core outcomes this role must accomplish: ${grounding.coreOutcomes.join('; ') || 'n/a'}\n` +
      `- Capability requirements to probe: ${grounding.capabilityRequirements.map((c) => `${c.skill} (${c.importance})`).join(', ') || 'n/a'}\n` +
      `- Industry themes to weave in: ${grounding.industryProbeThemes.join(', ') || 'n/a'}\n` +
      'At least one task and one inbox/Slack message must directly test one of the core outcomes above.'
    );
  }

  /** Runs one pipeline step; on failure, records FAILED_FELL_BACK with the fallback payload rather than aborting the whole pipeline. */
  private async step<T>(
    stepName: WorldGenerationArtifact['step'],
    artifacts: WorldGenerationArtifact[],
    system: string,
    user: string,
    fallback: () => T,
  ): Promise<T> {
    try {
      const result = await this.ai.completeJson<T>(
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        { temperature: 0.9, maxTokens: 1800 },
      );
      artifacts.push({ step: stepName, status: 'OK', payload: result });
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Pipeline step "${stepName}" failed, using fallback: ${msg}`);
      const fell = fallback();
      artifacts.push({ step: stepName, status: 'FAILED_FELL_BACK', payload: fell });
      return fell;
    }
  }
}

// ── Step prompts ──

const COMPANY_ORG_SYSTEM =
  'You are generating Step 2 (Company + Organization + Company State) of a living-workplace simulation ' +
  'for a job-interview platform. Return ONLY JSON matching this exact shape:\n' +
  '{\n' +
  '  "companyName": string,\n' +
  '  "companyState": { "revenue": int, "customerSatisfaction": int, "engineeringCapacity": int, ' +
  '"technicalDebt": int, "teamMorale": int, "budget": int, "riskLevel": int, "deadlinePressure": int, ' +
  '"marketReputation": int, "cashRunway": int, "complianceRisk": int, "productQuality": int, ' +
  '"burnout": int, "hiringCapacity": int, "operationalRisk": int, "growth": int } (each 0-100),\n' +
  '  "missionBrief": { "objective": string (1 sentence, the concrete business objective this candidate\'s ' +
  'role owns this quarter), "whyItMatters": string (1-2 sentences), "currentHealth": string (2-3 ' +
  'sentences narrating the company\'s current state in plain language), "successMetrics": string[] (2-4 ' +
  'short bullet phrases) },\n' +
  '  "baselineChallenge": { "scenario": string (2-4 sentences posing a realistic prioritization trade-off ' +
  'for this exact role, 3 concrete options embedded in the prose), "options": [{ "id": string (short ' +
  'slug), "label": string (one sentence) }] (exactly 3), "roleKnowledgeQuestion": string (one short, ' +
  'specific question testing real domain knowledge for THIS role — e.g. a PM gets asked how they\'d ' +
  'validate a feature idea, an engineer gets asked how they\'d debug a specific class of issue — ' +
  'answerable in 2-3 sentences), "toolsQuestion": string (one short question about a tool, technique, or ' +
  'industry-basics fact this role would realistically need, e.g. "what would you check first to diagnose ' +
  'X") },\n' +
  '  "departments": [{ "name": string }] (3-5 entries, realistic department names for this company\'s ' +
  'size/stage, e.g. Engineering, Sales, Marketing, Support, Finance — pick ones that would realistically ' +
  'interact with this candidate\'s role)\n' +
  '}\nThe scenario+options must be answerable in under a minute with no single objectively-correct ' +
  'option; roleKnowledgeQuestion and toolsQuestion DO have better/worse answers (they get scored). No ' +
  'prose outside the JSON.';

const STAKEHOLDERS_SYSTEM =
  'You are generating Step 3 (Stakeholder Generation) of a living-workplace simulation, given a real ' +
  'company and its department list. Return ONLY JSON: {"stakeholders": [{ "key": string (short slug), ' +
  '"name": string, "role": string (job title), "department": string (MUST exactly match one of the given ' +
  'department names), "experienceLevel": string (e.g. "3 years", "Senior", "New hire"), "authorityLevel": ' +
  'int 0-100 (org seniority/decision power — a VP should be high, an IC should be low-medium), "kpis": ' +
  'string[] (2-3 short phrases, what this person is measured on), "currentTasks": string[] (1-2 short ' +
  'phrases, what they are actively working on right now), "avatarSeed": string (slug of name), ' +
  '"personality": { "traits": string[], "goals": string[] }, "hiddenIntention": string (1 sentence — ' +
  'something this stakeholder privately wants or is hiding, never told to the candidate directly, only ' +
  'surfaces through investigation), "privateKnowledge": string[] (1-2 short facts ONLY this specific person ' +
  'individually knows — not something everyone in their department would know, a genuinely distinct piece of ' +
  'information, e.g. something they overheard, were told in confidence, or discovered themselves — never ' +
  'volunteered upfront, only surfaces if the candidate specifically asks the right person the right question), ' +
  '"stress": int, "urgency": int, "patience": int, "motivation": int ' +
  '(each 0-100) }] (4-6 entries, distinct roles across the given departments that would realistically work ' +
  'with the candidate\'s role — vary WHO knows WHAT so no two stakeholders\' privateKnowledge overlaps). No ' +
  'prose outside the JSON.';

const KNOWLEDGE_SYSTEM =
  'You are generating Step 4 (Knowledge Generation) of a living-workplace simulation, given the real ' +
  'company and stakeholder roster. Return ONLY JSON: {"knowledgeDocs": [{ "title": string, "body": string ' +
  '(2-4 sentences, concrete and specific to this company/roster — reference real stakeholder names or ' +
  'the company\'s actual situation where natural), "category": string (one of: "wiki", "prd", ' +
  '"hr_policy", "sales_deck", "roadmap", "backlog", "financial_report", "customer_history", ' +
  '"meeting_notes") }]} (6-8 entries, spread across DIFFERENT categories — do not put more than 2 docs in ' +
  'the same category). No prose outside the JSON.';

const WORKPLACE_ASSETS_SYSTEM =
  'You are generating Step 5 (Workplace Assets — the content present the MOMENT the candidate opens the ' +
  'workspace, not later) of a living-workplace simulation, given the real company and stakeholder roster. ' +
  'Return ONLY JSON: {\n' +
  '  "inbox": [{ "fromKey": string (must match a roster key), "subject": string, "body": string (2-4 ' +
  'sentences, concrete stakes), "urgent": boolean, "ethicalDilemma": boolean }] (2-3 entries, at least 1 ' +
  'urgent),\n' +
  '  "slack": [{ "channel": string ("#product"|"#engineering"|"#sales"|"#leadership"|"dm:<rosterKey>"), ' +
  '"fromKey": string (must match a roster key), "body": string (1-2 sentences), "ethicalDilemma": boolean ' +
  '}] (2-3 entries, at least one dm: channel),\n' +
  '  "tasks": [{ "title": string, "priority": "low"|"medium"|"high", "dueInHours": int }] (3-4 entries),\n' +
  '  "calendarEvents": [{ "title": string, "agenda": string (1 sentence, what this meeting is actually ' +
  'about), "startInHours": number, "durationMins": int, "attendeeKeys": string[] (1-3 roster keys who are ' +
  'actually in this meeting, plausible for the topic) }] (2-3 entries)\n' +
  '}\nExactly ONE message across inbox+slack combined must have "ethicalDilemma": true — a real ' +
  'integrity-pressure situation with no clean answer (asking the candidate to ship untested work, mislead ' +
  'a customer, hide a mistake, or bend a policy under time pressure) — never mark a normal work request as ' +
  'an ethical dilemma. No prose outside the JSON.';

/** Upgrade — full-session coverage; count and offset range now scale with difficulty (see the maps above), not a fixed 2-4 entries / 15-90s window regardless of how long the session actually runs. */
function eventQueueSystem(difficulty: string): string {
  const count = EVENT_QUEUE_SIZE_BY_DIFFICULTY[difficulty] ?? EVENT_QUEUE_SIZE_BY_DIFFICULTY.MEDIUM;
  const maxOffset = EVENT_QUEUE_MAX_OFFSET_SECONDS_BY_DIFFICULTY[difficulty] ?? EVENT_QUEUE_MAX_OFFSET_SECONDS_BY_DIFFICULTY.MEDIUM;
  return (
    'You are generating Step 6 (Event Queue) of a living-workplace simulation, given the real company and ' +
    'stakeholder roster. These are messages that arrive at various points AFTER the candidate has already ' +
    'started working — not present when they open the workspace. Spread them out to feel like a realistic ' +
    `workday's pace across the WHOLE session, not clustered near the start — offsets should vary widely ` +
    `between entries, not be evenly spaced like a metronome. Return ONLY JSON: {"scheduledEvents": [{ ` +
    '"surface": "inbox"|"slack", "fromKey": string (must match a roster key), "subject": string (inbox ' +
    'only), "channel": string (slack only, same format as workplace assets), "body": string, "urgent": ' +
    `boolean, "ethicalDilemma": boolean, "fireAtOffsetSeconds": int (15-${maxOffset}, how soon after the ` +
    `workspace unlocks this arrives) }]} (exactly ${count} entries). No prose outside the JSON.`
  );
}

const SIGNATURE_ARTIFACT_SYSTEM =
  'You are generating the ONE Role-Specific Signature Artifact for this candidate (a real, substantive ' +
  'deliverable that proves genuine job capability, not a generic task). Given the real company context and ' +
  'exactly what kind of deliverable this role produces, write a concrete, SPECIFIC title and description — ' +
  'reference the actual mission objective / current company health given below, not a generic placeholder ' +
  '("Q3 Onboarding PRD addressing the churn spike", not "Write a PRD"). Return ONLY JSON: {"title": string ' +
  '(short, concrete, references the real situation), "description": string (2-3 sentences: exactly what to ' +
  'produce and why it matters right now)}.';

const EVALUATION_PLAN_SYSTEM =
  'You are generating Step 7 (D7 Evaluation Plan) of a living-workplace simulation, given the real ' +
  'generated content (tasks, inbox, Slack, scheduled events) already in this world. This plan describes ' +
  'WHAT to observe, never scores. Return ONLY JSON: {"evaluationPlan": [{ "dimension": one of ' +
  '"role_skills"|"communication"|"leadership"|"integrity"|"prioritization"|"adaptability"|"recovery", ' +
  '"whatToObserve": string (1 sentence, concrete and behavioral, not generic), "signalSources": string[] ' +
  '(1-3 short excerpts COPIED VERBATIM from the given task/inbox/slack/event content — never invent new ' +
  'content here) }]} (exactly 7 entries, one per dimension, each grounded in real content from this ' +
  'specific world). No prose outside the JSON.';

// ── Sanitizers — LLM JSON is untrusted input feeding straight into Prisma
// writes; clamp ranges, cap array sizes, drop malformed entries, repair
// dangling references rather than let them become orphaned rows. ──

function clamp0to100(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 50;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function asRecords(v: unknown): Record<string, unknown>[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object');
}

function sanitizeCompanyState(raw: unknown): HyrteFixture['companyState'] {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return Object.fromEntries(COMPANY_STATE_KEYS.map((key) => [key, clamp0to100(r[key])])) as HyrteFixture['companyState'];
}

function sanitizeMissionBrief(raw: unknown): FixtureMissionBrief {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const metrics = Array.isArray(r.successMetrics)
    ? r.successMetrics.filter((m): m is string => typeof m === 'string').slice(0, CAPS.successMetrics)
    : [];
  return {
    objective: typeof r.objective === 'string' && r.objective.trim() ? r.objective.trim() : 'Keep the team on track this quarter.',
    whyItMatters:
      typeof r.whyItMatters === 'string' && r.whyItMatters.trim()
        ? r.whyItMatters.trim()
        : 'Leadership is watching this closely this quarter.',
    currentHealth:
      typeof r.currentHealth === 'string' && r.currentHealth.trim()
        ? r.currentHealth.trim()
        : 'The company is in a stable but demanding period, balancing growth with operational pressure.',
    successMetrics: metrics.length > 0 ? metrics : ['Deliver on the current roadmap commitments'],
  };
}

function sanitizeBaselineChallenge(raw: unknown): HyrteFixture['baselineChallenge'] {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const options = asRecords(r.options)
    .filter((o) => typeof o.id === 'string' && typeof o.label === 'string')
    .slice(0, CAPS.baselineOptions)
    .map((o) => ({ id: String(o.id), label: String(o.label) }));
  const roleKnowledgeQuestion = typeof r.roleKnowledgeQuestion === 'string' && r.roleKnowledgeQuestion.trim() ? r.roleKnowledgeQuestion.trim() : 'Walk through how you would approach your first week in this role.';
  const toolsQuestion = typeof r.toolsQuestion === 'string' && r.toolsQuestion.trim() ? r.toolsQuestion.trim() : 'What tool or resource would you reach for first to understand the current state of things?';

  if (typeof r.scenario === 'string' && r.scenario.trim() && options.length >= 2) {
    return { scenario: r.scenario.trim(), options, roleKnowledgeQuestion, toolsQuestion };
  }
  return {
    scenario:
      'Your team can only tackle one priority next: (A) a customer-requested feature that could unblock a ' +
      'stalled deal, (B) fixing a known issue affecting current users, or (C) a project already promised to ' +
      'leadership. Which do you prioritize, and why?',
    options: [
      { id: 'a', label: 'Ship the customer-requested feature' },
      { id: 'b', label: 'Fix the issue affecting current users' },
      { id: 'c', label: 'Stick to the commitment already made to leadership' },
    ],
    roleKnowledgeQuestion,
    toolsQuestion,
  };
}

function sanitizeDepartments(raw: unknown): FixtureDepartment[] {
  const names = asRecords(raw)
    .map((d) => (typeof d.name === 'string' ? d.name.trim() : ''))
    .filter((n) => n.length > 0)
    .slice(0, CAPS.departments);
  const unique = Array.from(new Set(names));
  return (unique.length > 0 ? unique : ['Engineering', 'Product', 'Operations']).map((name) => ({ name }));
}

function sanitizeStakeholders(raw: unknown, departments: FixtureDepartment[]): FixtureStakeholder[] {
  const deptNames = new Set(departments.map((d) => d.name));
  const fallbackDept = departments[0]?.name;
  return asRecords(raw)
    .filter((s) => typeof s.key === 'string' && (s.key as string).length > 0 && typeof s.name === 'string' && typeof s.role === 'string')
    .slice(0, CAPS.stakeholders)
    .map((s) => ({
      key: s.key as string,
      name: s.name as string,
      role: s.role as string,
      avatarSeed: typeof s.avatarSeed === 'string' && s.avatarSeed ? (s.avatarSeed as string) : (s.name as string).toLowerCase().replace(/\s+/g, '-'),
      department: typeof s.department === 'string' && deptNames.has(s.department) ? s.department : fallbackDept,
      experienceLevel: typeof s.experienceLevel === 'string' ? s.experienceLevel : undefined,
      authorityLevel: clamp0to100(s.authorityLevel),
      kpis: Array.isArray(s.kpis) ? s.kpis.filter((k): k is string => typeof k === 'string').slice(0, 4) : [],
      currentTasks: Array.isArray(s.currentTasks) ? s.currentTasks.filter((t): t is string => typeof t === 'string').slice(0, 3) : [],
      personality: s.personality && typeof s.personality === 'object' ? (s.personality as Record<string, unknown>) : {},
      hiddenIntention: typeof s.hiddenIntention === 'string' && s.hiddenIntention.trim() ? s.hiddenIntention.trim() : undefined,
      privateKnowledge: Array.isArray(s.privateKnowledge) ? s.privateKnowledge.filter((k): k is string => typeof k === 'string' && k.trim().length > 0).slice(0, 2) : [],
      stress: clamp0to100(s.stress),
      urgency: clamp0to100(s.urgency),
      patience: clamp0to100(s.patience),
      motivation: clamp0to100(s.motivation),
    }));
}

/** Picks the highest-authority stakeholder per department as its head — computed, never LLM-guessed. */
function assignDepartmentHeads(departments: FixtureDepartment[], stakeholders: FixtureStakeholder[]): void {
  for (const dept of departments) {
    const inDept = stakeholders.filter((s) => s.department === dept.name);
    if (inDept.length === 0) continue;
    dept.headStakeholderKey = inDept.reduce((a, b) => ((b.authorityLevel ?? 50) > (a.authorityLevel ?? 50) ? b : a)).key;
  }
}

function sanitizeKnowledgeDocs(raw: unknown): FixtureKnowledgeDoc[] {
  return asRecords(raw)
    .filter((k) => typeof k.title === 'string' && typeof k.body === 'string')
    .slice(0, CAPS.knowledgeDocs)
    .map((k) => ({ title: String(k.title), body: String(k.body), category: typeof k.category === 'string' ? k.category : 'general' }));
}

function sanitizeInbox(raw: unknown, resolveKey: (k: unknown) => string): FixtureInboxMessage[] {
  return asRecords(raw)
    .filter((m) => typeof m.subject === 'string' && typeof m.body === 'string')
    .slice(0, CAPS.inbox)
    .map((m) => ({
      fromKey: resolveKey(m.fromKey),
      subject: String(m.subject),
      body: String(m.body),
      urgent: Boolean(m.urgent),
      ethicalDilemma: Boolean(m.ethicalDilemma),
    }));
}

function sanitizeSlack(raw: unknown, resolveKey: (k: unknown) => string): FixtureSlackMessage[] {
  return asRecords(raw)
    .filter((m) => typeof m.channel === 'string' && typeof m.body === 'string')
    .slice(0, CAPS.slack)
    .map((m) => ({ channel: String(m.channel), fromKey: resolveKey(m.fromKey), body: String(m.body), ethicalDilemma: Boolean(m.ethicalDilemma) }));
}

function sanitizeTasks(raw: unknown): FixtureTask[] {
  return asRecords(raw)
    .filter((t) => typeof t.title === 'string')
    .slice(0, CAPS.tasks)
    .map((t) => ({
      title: String(t.title),
      priority: (['low', 'medium', 'high'] as const).includes(t.priority as 'low' | 'medium' | 'high') ? (t.priority as 'low' | 'medium' | 'high') : 'medium',
      dueInHours: typeof t.dueInHours === 'number' ? t.dueInHours : 24,
    }));
}

const EVALUATION_DIMENSIONS = ['role_skills', 'communication', 'leadership', 'integrity', 'prioritization', 'adaptability', 'recovery'] as const;

function sanitizeSignatureArtifact(raw: SignatureArtifactResult, artifactLabel: string, companyName: string): FixtureSignatureArtifact {
  return {
    title: raw.title?.trim() ? raw.title.trim() : `${artifactLabel} — ${companyName}`,
    description: raw.description?.trim()
      ? raw.description.trim()
      : `Produce a ${artifactLabel.toLowerCase()} addressing the company's current situation.`,
    dueInHours: 24,
  };
}

function sanitizeEvaluationPlan(raw: unknown): FixtureEvaluationPlanItem[] {
  return asRecords(raw)
    .filter((e) => (EVALUATION_DIMENSIONS as readonly string[]).includes(e.dimension as string) && typeof e.whatToObserve === 'string')
    .slice(0, EVALUATION_DIMENSIONS.length)
    .map((e) => ({
      dimension: e.dimension as FixtureEvaluationPlanItem['dimension'],
      whatToObserve: String(e.whatToObserve),
      signalSources: Array.isArray(e.signalSources) ? e.signalSources.filter((s): s is string => typeof s === 'string').slice(0, 3) : [],
    }));
}

function sanitizeCalendarEvents(raw: unknown, validKeys: Set<string>): FixtureCalendarEvent[] {
  return asRecords(raw)
    .filter((c) => typeof c.title === 'string')
    .slice(0, CAPS.calendarEvents)
    .map((c) => ({
      title: String(c.title),
      agenda: typeof c.agenda === 'string' ? c.agenda : undefined,
      startInHours: typeof c.startInHours === 'number' ? c.startInHours : 2,
      durationMins: typeof c.durationMins === 'number' ? c.durationMins : 30,
      attendeeKeys: Array.isArray(c.attendeeKeys) ? c.attendeeKeys.filter((k): k is string => typeof k === 'string' && validKeys.has(k)) : [],
    }));
}

function sanitizeScheduledEvents(
  raw: unknown,
  resolveKey: (k: unknown) => string,
  maxCount: number,
  maxOffsetSeconds: number,
): FixtureScheduledEvent[] {
  return asRecords(raw)
    .filter((e) => (e.surface === 'inbox' || e.surface === 'slack') && typeof e.body === 'string')
    .slice(0, maxCount)
    .map((e) => ({
      surface: e.surface as 'inbox' | 'slack',
      fromKey: resolveKey(e.fromKey),
      subject: typeof e.subject === 'string' ? e.subject : undefined,
      channel: typeof e.channel === 'string' ? e.channel : undefined,
      body: String(e.body),
      urgent: Boolean(e.urgent),
      ethicalDilemma: Boolean(e.ethicalDilemma),
      fireAtOffsetSeconds:
        typeof e.fireAtOffsetSeconds === 'number' ? Math.max(10, Math.min(maxOffsetSeconds, Math.round(e.fireAtOffsetSeconds))) : 20,
    }));
}
