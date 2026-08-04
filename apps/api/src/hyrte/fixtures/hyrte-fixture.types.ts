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
  /** Upgrade §3 — matches a name in FixtureOrganization.departments. */
  department?: string;
  experienceLevel?: string;
  /** Fixed org-position fact, distinct from `influence` (candidate-relationship-specific, mutates). */
  authorityLevel?: number;
  kpis?: string[];
  currentTasks?: string[];
  personality: Record<string, unknown>;
  /** §4.12 Layer 10 — never returned to the candidate, only read by the stakeholder-agent prompt. */
  hiddenIntention?: string;
  /** 0-100, shaped by difficulty. Omitted values default to 50 (see sanitizeFixture/db default). */
  stress?: number;
  urgency?: number;
  patience?: number;
  motivation?: number;
}

/** Upgrade §2 — lightweight Organization structure for the simulated company. */
export interface FixtureDepartment {
  name: string;
  headStakeholderKey?: string;
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
  agenda?: string;
  startInHours: number;
  durationMins: number;
}

/**
 * Upgrade §6 — Event Queue. Only SCHEDULED events are pre-generated content
 * (the old `arrivesLater` boolean, now with an explicit offset and a real
 * queue row instead of a bare setTimeout). CONDITIONAL events describe a
 * trigger, not content — their actual message is generated at fire time from
 * live company state (ignored-message escalation, chaos wave), so `body`ish
 * fields are absent here by design; see HyrteWorldEvent's schema comment.
 */
export interface FixtureScheduledEvent {
  surface: 'inbox' | 'slack';
  fromKey: string;
  subject?: string; // inbox only
  channel?: string; // slack only
  body: string;
  fireAtOffsetSeconds: number;
  urgent?: boolean;
  ethicalDilemma?: boolean;
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

/**
 * Upgrade §4/Step 9 — Role Calibration, "not MCQ-only". `scenario`+`options`
 * is the original decision-framework judgment call (kept deliberately
 * unscored — no single correct option, per the doc). `roleKnowledgeQuestion`
 * and `toolsQuestion` are new: short free-text questions testing real role
 * knowledge and tools/industry familiarity, LLM-scored at submission time
 * into a calibrationScore that adjusts event difficulty (see
 * HyrteConsequenceService.scheduleChaosWave).
 */
export interface FixtureBaselineChallenge {
  scenario: string;
  options: FixtureBaselineChallengeOption[];
  roleKnowledgeQuestion: string;
  toolsQuestion: string;
}

/** UX flow §8 step 1 — shown before the workspace opens. */
export interface FixtureMissionBrief {
  objective: string;
  whyItMatters: string;
  currentHealth: string;
  successMetrics: string[];
  /** Upgrade §4/Step 8 — the candidate's reporting manager, derived from the real generated roster (highest-authority stakeholder), not invented separately. */
  manager?: { name: string; role: string };
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
  /** Upgrade §2 — Organization structure; empty for the static fallback fixture (pre-upgrade shape). */
  departments: FixtureDepartment[];
  stakeholders: FixtureStakeholder[];
  inbox: FixtureInboxMessage[];
  slack: FixtureSlackMessage[];
  tasks: FixtureTask[];
  calendarEvents: FixtureCalendarEvent[];
  knowledgeDocs: FixtureKnowledgeDoc[];
  /** Upgrade §6 — Event Queue (SCHEDULED content only; see FixtureScheduledEvent). */
  scheduledEvents: FixtureScheduledEvent[];
}
