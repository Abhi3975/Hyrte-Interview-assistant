import { Injectable, Logger } from '@nestjs/common';
import { AIService } from '../../ai/ai.service';
import { CreateHyrteSessionDto } from '../dto/hyrte.dto';
import { COMPANY_STATE_KEYS } from '../consequences/consequence.service';
import {
  FixtureBaselineChallenge,
  FixtureCalendarEvent,
  FixtureInboxMessage,
  FixtureKnowledgeDoc,
  FixtureMissionBrief,
  FixtureSlackMessage,
  FixtureStakeholder,
  FixtureTask,
  HyrteFixture,
} from '../fixtures/hyrte-fixture.types';

const CAPS = { stakeholders: 6, inbox: 4, slack: 5, tasks: 4, calendarEvents: 3, knowledgeDocs: 4, successMetrics: 4, baselineOptions: 4 };

/**
 * Produces a unique `HyrteFixture` per session from the candidate's 6 inputs
 * (doc §4) — the whole point being that no two candidates get an identical
 * simulation. Culture deliberately does NOT skew the starting company-state
 * numbers here; per the doc, culture changes how the same decision is later
 * *scored* (a future system's job), not the scenario itself — it only
 * flavors tone/content in the prompt below.
 */
@Injectable()
export class HyrteSimulationGeneratorService {
  private readonly logger = new Logger(HyrteSimulationGeneratorService.name);

  constructor(private readonly ai: AIService) {}

  async generate(dto: CreateHyrteSessionDto): Promise<HyrteFixture> {
    const raw = await this.ai.completeJson<unknown>(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: this.buildUserPrompt(dto) },
      ],
      { temperature: 0.9, maxTokens: 3600 },
    );
    return sanitizeFixture(raw);
  }

  private buildUserPrompt(dto: CreateHyrteSessionDto): string {
    const nonce = Math.random().toString(36).slice(2, 8);
    return (
      `Generate a simulation for a ${dto.experienceLevel} ${dto.role} at a ${dto.companyType} ` +
      `company in the ${dto.industry} industry. Difficulty: ${dto.difficulty} — reflect this in how ` +
      `bad the starting company-state numbers are and how many things are simultaneously on fire. ` +
      `Company culture: ${dto.culture} — reflect this only in tone/flavor (what stakeholders care ` +
      `about, how they talk), not in the numeric company state. ` +
      `Invent a unique fictional company name and scenario — do not reuse common example names ` +
      `like Acme, Nimbus, or TechCorp. Variety seed: ${nonce}.`
    );
  }
}

const SYSTEM_PROMPT =
  'You are generating a living-workplace simulation for a job-interview platform. Return ONLY JSON ' +
  'matching this exact shape:\n' +
  '{\n' +
  '  "companyName": string,\n' +
  '  "companyState": { "revenue": int, "customerSatisfaction": int, "engineeringCapacity": int, ' +
  '"technicalDebt": int, "teamMorale": int, "budget": int, "riskLevel": int, "deadlinePressure": int, ' +
  '"marketReputation": int, "cashRunway": int, "complianceRisk": int, "productQuality": int, ' +
  '"burnout": int, "hiringCapacity": int, "operationalRisk": int, "growth": int } (each 0-100),\n' +
  '  "missionBrief": { "objective": string (1 sentence, the concrete business objective this ' +
  "candidate's role owns this quarter), \"whyItMatters\": string (1-2 sentences, the stakes), " +
  '"currentHealth": string (2-3 sentences narrating the company\'s current state in plain language), ' +
  '"successMetrics": string[] (2-4 short bullet phrases) },\n' +
  '  "baselineChallenge": { "scenario": string (2-4 sentences posing a realistic prioritization ' +
  'trade-off for this exact role, with 3 concrete options embedded in the prose), "options": ' +
  '[{ "id": string (short slug, e.g. "a"), "label": string (the option, one sentence) }] (exactly 3) },\n' +
  '  "stakeholders": [{ "key": string (short slug, e.g. "eng_lead"), "name": string, "role": string, ' +
  '"avatarSeed": string (slug of name), "personality": { "traits": string[], "goals": string[] }, ' +
  '"hiddenIntention": string (1 sentence — something this stakeholder privately wants or is hiding ' +
  'that is NEVER told to the candidate directly and would only surface through investigation), ' +
  '"stress": int, "urgency": int, "patience": int, "motivation": int (each 0-100 — higher difficulty ' +
  'should mean higher stress/urgency and lower patience across the roster) }] ' +
  '(4-6 entries, distinct roles that would realistically work with this candidate\'s role),\n' +
  '  "inbox": [{ "fromKey": string (must match a stakeholder key), "subject": string, "body": string ' +
  '(2-4 sentences, concrete stakes), "urgent": boolean, "arrivesLater": boolean, "ethicalDilemma": ' +
  'boolean }] (2-4 entries, at least 1 urgent, at least 1 with arrivesLater:true),\n' +
  '  "slack": [{ "channel": string ("#product" | "#engineering" | "#sales" | "#leadership" | ' +
  '"dm:<stakeholderKey>"), "fromKey": string, "body": string (1-2 sentences), "arrivesLater": boolean, ' +
  '"ethicalDilemma": boolean }] (3-5 entries, at least one dm: channel, at least 1 with arrivesLater:true),\n' +
  '  "tasks": [{ "title": string, "priority": "low"|"medium"|"high", "dueInHours": int }] (3-4 entries),\n' +
  '  "calendarEvents": [{ "title": string, "startInHours": number, "durationMins": int }] (2-3 entries),\n' +
  '  "knowledgeDocs": [{ "title": string, "body": string (2-4 sentences), "category": string }] ' +
  '(2-4 entries)\n' +
  '}\n' +
  'Every fromKey must exactly match a stakeholder key you defined. The baselineChallenge must be ' +
  'answerable in under a minute and have no single objectively-correct option — each should trade ' +
  'off against the others. Exactly ONE message across inbox+slack combined must have ' +
  '"ethicalDilemma": true — a real integrity-pressure situation with no clean answer (e.g. a ' +
  'stakeholder asking the candidate to ship something untested, mislead a customer, hide a mistake, ' +
  'or bend a policy under time pressure) — never mark a normal work request as an ethical dilemma. ' +
  'No prose outside the JSON.';

/**
 * LLM JSON is untrusted input feeding straight into Prisma writes — clamp
 * ranges, cap array sizes, drop malformed entries, and repair dangling
 * `fromKey` references rather than let them become orphaned rows.
 */
/** Clamps an unknown value to an integer 0-100, defaulting to 50 when missing/invalid. */
function clamp0to100(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 50;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Narrows an unknown array field to plain objects, dropping anything else. */
function asRecords(v: unknown): Record<string, unknown>[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object');
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

function sanitizeBaselineChallenge(raw: unknown): FixtureBaselineChallenge {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const options = asRecords(r.options)
    .filter((o) => typeof o.id === 'string' && typeof o.label === 'string')
    .slice(0, CAPS.baselineOptions)
    .map((o) => ({ id: String(o.id), label: String(o.label) }));

  if (typeof r.scenario === 'string' && r.scenario.trim() && options.length >= 2) {
    return { scenario: r.scenario.trim(), options };
  }
  // Fallback if the LLM omitted or malformed this field — never leave a session without a challenge.
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
  };
}

export function sanitizeFixture(raw: unknown): HyrteFixture {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  const stakeholders: FixtureStakeholder[] = asRecords(r.stakeholders)
    .filter(
      (s) =>
        typeof s.key === 'string' && (s.key as string).length > 0 && typeof s.name === 'string' && typeof s.role === 'string',
    )
    .slice(0, CAPS.stakeholders)
    .map((s) => ({
      key: s.key as string,
      name: s.name as string,
      role: s.role as string,
      avatarSeed:
        typeof s.avatarSeed === 'string' && s.avatarSeed
          ? (s.avatarSeed as string)
          : (s.name as string).toLowerCase().replace(/\s+/g, '-'),
      personality: s.personality && typeof s.personality === 'object' ? (s.personality as Record<string, unknown>) : {},
      hiddenIntention: typeof s.hiddenIntention === 'string' && s.hiddenIntention.trim() ? s.hiddenIntention.trim() : undefined,
      stress: clamp0to100(s.stress),
      urgency: clamp0to100(s.urgency),
      patience: clamp0to100(s.patience),
      motivation: clamp0to100(s.motivation),
    }));

  if (stakeholders.length === 0) {
    throw new Error('Generated fixture had no valid stakeholders');
  }
  const validKeys = new Set(stakeholders.map((s) => s.key));
  const anyKey = () => stakeholders[Math.floor(Math.random() * stakeholders.length)].key;
  const resolveKey = (k: unknown) => (typeof k === 'string' && validKeys.has(k) ? k : anyKey());

  const inbox: FixtureInboxMessage[] = asRecords(r.inbox)
    .filter((m) => typeof m.subject === 'string' && typeof m.body === 'string')
    .slice(0, CAPS.inbox)
    .map((m) => ({
      fromKey: resolveKey(m.fromKey),
      subject: String(m.subject),
      body: String(m.body),
      urgent: Boolean(m.urgent),
      arrivesLater: Boolean(m.arrivesLater),
      ethicalDilemma: Boolean(m.ethicalDilemma),
    }));

  const slack: FixtureSlackMessage[] = asRecords(r.slack)
    .filter((m) => typeof m.channel === 'string' && typeof m.body === 'string')
    .slice(0, CAPS.slack)
    .map((m) => ({
      channel: String(m.channel),
      fromKey: resolveKey(m.fromKey),
      body: String(m.body),
      arrivesLater: Boolean(m.arrivesLater),
      ethicalDilemma: Boolean(m.ethicalDilemma),
    }));

  if (inbox.length === 0 && slack.length === 0) {
    throw new Error('Generated fixture had no inbox or Slack content');
  }

  const tasks: FixtureTask[] = asRecords(r.tasks)
    .filter((t) => typeof t.title === 'string')
    .slice(0, CAPS.tasks)
    .map((t) => ({
      title: String(t.title),
      priority: (['low', 'medium', 'high'] as const).includes(t.priority as 'low' | 'medium' | 'high')
        ? (t.priority as 'low' | 'medium' | 'high')
        : 'medium',
      dueInHours: typeof t.dueInHours === 'number' ? t.dueInHours : 24,
    }));

  const calendarEvents: FixtureCalendarEvent[] = asRecords(r.calendarEvents)
    .filter((c) => typeof c.title === 'string')
    .slice(0, CAPS.calendarEvents)
    .map((c) => ({
      title: String(c.title),
      startInHours: typeof c.startInHours === 'number' ? c.startInHours : 2,
      durationMins: typeof c.durationMins === 'number' ? c.durationMins : 30,
    }));

  const knowledgeDocs: FixtureKnowledgeDoc[] = asRecords(r.knowledgeDocs)
    .filter((k) => typeof k.title === 'string' && typeof k.body === 'string')
    .slice(0, CAPS.knowledgeDocs)
    .map((k) => ({
      title: String(k.title),
      body: String(k.body),
      category: typeof k.category === 'string' ? (k.category as string) : 'general',
    }));

  const rawState = (r.companyState ?? {}) as Record<string, unknown>;
  const companyState = Object.fromEntries(
    COMPANY_STATE_KEYS.map((key) => [key, clamp0to100(rawState[key])]),
  ) as HyrteFixture['companyState'];

  return {
    companyName: typeof r.companyName === 'string' && r.companyName.trim() ? r.companyName.trim() : 'Unnamed Co',
    companyState,
    missionBrief: sanitizeMissionBrief(r.missionBrief),
    baselineChallenge: sanitizeBaselineChallenge(r.baselineChallenge),
    stakeholders,
    inbox,
    slack,
    tasks,
    calendarEvents,
    knowledgeDocs,
  };
}
