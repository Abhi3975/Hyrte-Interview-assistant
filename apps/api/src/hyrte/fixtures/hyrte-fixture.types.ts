/**
 * Shape produced by any HYRTE session seeder — the hardcoded fallback fixture
 * (`pm-saas-startup.fixture.ts`) and the Dynamic Simulation Generator
 * (`generator/simulation-generator.service.ts`) both return this, so
 * `hyrte-sessions.service.ts` can consume either without caring which one ran.
 */

export interface FixtureStakeholder {
  key: string;
  name: string;
  role: string;
  avatarSeed: string;
  personality: Record<string, unknown>;
  /** §4.12 Layer 10 — never returned to the candidate, only read by the stakeholder-agent prompt. */
  hiddenIntention?: string;
  /** 0-100, shaped by difficulty. Omitted values default to 50 (see sanitizeFixture/db default). */
  stress?: number;
  urgency?: number;
  patience?: number;
  motivation?: number;
}

export interface FixtureInboxMessage {
  fromKey: string;
  subject: string;
  body: string;
  urgent: boolean;
  /** True = scheduled to arrive a little after session start, not immediately. */
  arrivesLater?: boolean;
  /** §4.20 Ethical Gray Zones — real pressure, no clean answer, tracked but never flagged "correct". */
  ethicalDilemma?: boolean;
}

export interface FixtureSlackMessage {
  channel: string; // "#product" | "dm:<stakeholderKey>"
  fromKey: string;
  body: string;
  arrivesLater?: boolean;
  ethicalDilemma?: boolean;
}

export interface FixtureTask {
  title: string;
  priority: 'low' | 'medium' | 'high';
  dueInHours?: number;
}

export interface FixtureCalendarEvent {
  title: string;
  startInHours: number;
  durationMins: number;
}

export interface FixtureKnowledgeDoc {
  title: string;
  body: string;
  category: string;
}

export interface FixtureBaselineChallengeOption {
  id: string;
  label: string;
}

/** UX flow §8 step 2 — a quick warm-up scenario before the workspace opens. */
export interface FixtureBaselineChallenge {
  scenario: string;
  options: FixtureBaselineChallengeOption[];
}

/** UX flow §8 step 1 — shown before the workspace opens. */
export interface FixtureMissionBrief {
  objective: string;
  whyItMatters: string;
  currentHealth: string;
  successMetrics: string[];
}

export interface HyrteFixture {
  companyName: string;
  companyState: {
    revenue: number;
    customerSatisfaction: number;
    engineeringCapacity: number;
    technicalDebt: number;
    teamMorale: number;
    budget: number;
    riskLevel: number;
    deadlinePressure: number;
    marketReputation: number;
    cashRunway: number;
    complianceRisk: number;
    // §4.11 Living Organizational World Model — full canonical variable list.
    productQuality: number;
    burnout: number;
    hiringCapacity: number;
    operationalRisk: number;
    growth: number;
  };
  missionBrief: FixtureMissionBrief;
  baselineChallenge: FixtureBaselineChallenge;
  stakeholders: FixtureStakeholder[];
  inbox: FixtureInboxMessage[];
  slack: FixtureSlackMessage[];
  tasks: FixtureTask[];
  calendarEvents: FixtureCalendarEvent[];
  knowledgeDocs: FixtureKnowledgeDoc[];
}
