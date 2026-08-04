export interface HyrteStakeholder {
  id: string;
  name: string;
  role: string;
  avatarSeed: string;
  department: string | null;
  experienceLevel: string | null;
  currentTasks: string[];
  // Trust/respect/cooperation/influence/stress/urgency/patience/motivation are
  // intentionally absent — Hard Rule #5 (Master Build Prompt): candidate-facing
  // payloads physically exclude trust/emotion numerics. The API omits these
  // fields via OMIT_CANDIDATE_INTERNALS before the row ever reaches this type.
}

/** Part E3/G7 — Recruiter Live Console only. Full-fidelity row, "internals allowed" by design. Never use this type on a candidate-facing page. */
export interface HyrteStakeholderInternal extends HyrteStakeholder {
  hiddenIntention: string | null;
  privateKnowledge: string[];
  trust: number;
  respect: number;
  cooperation: number;
  influence: number;
  stress: number;
  urgency: number;
  patience: number;
  motivation: number;
}

export interface HyrteCompanyState {
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
  productQuality: number;
  burnout: number;
  hiringCapacity: number;
  operationalRisk: number;
  growth: number;
}

export interface HyrteMissionBrief {
  objective: string;
  whyItMatters: string;
  currentHealth: string;
  successMetrics: string[];
  manager?: { name: string; role: string };
}

export interface HyrteBaselineChallengeOption {
  id: string;
  label: string;
}

export interface HyrteBaselineChallenge {
  scenario: string;
  options: HyrteBaselineChallengeOption[];
  roleKnowledgeQuestion: string;
  toolsQuestion: string;
}

export interface HyrteSession {
  id: string;
  companyName: string;
  role: string;
  phase: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD' | 'EXPERT';
  startedAt: string;
  missionBrief: HyrteMissionBrief | null;
  baselineChallenge: HyrteBaselineChallenge | null;
}

/** Part E1 Mission Brief "duration" field — informational only, no enforcement/auto-submit. */
export const PLANNED_DURATION_MINUTES: Record<HyrteSession['difficulty'], number> = {
  EASY: 15,
  MEDIUM: 20,
  HARD: 25,
  EXPERT: 30,
};

export interface HyrteInboxMessage {
  id: string;
  subject: string;
  body: string;
  urgent: boolean;
  readAt: string | null;
  createdAt: string;
  fromStakeholder?: HyrteStakeholder | null;
  /** Set only on the auto-generated follow-up an ignored urgent message escalates into. */
  escalatesMessageId: string | null;
}

export interface HyrteWorldEvent {
  id: string;
  kind: 'IMMEDIATE' | 'SCHEDULED' | 'CONDITIONAL';
  status: 'PENDING' | 'FIRED' | 'CANCELLED';
  surface: string;
  triggerCondition: string | null;
  firedAt: string | null;
  createdAt: string;
}

export interface HyrteSlackMessage {
  id: string;
  channel: string;
  body: string;
  createdAt: string;
  fromStakeholder?: HyrteStakeholder | null;
}

export type WorkItemStage = 'NEW' | 'IN_PROGRESS' | 'WAITING_REVIEW' | 'BLOCKED' | 'DONE';
export type WorkItemPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface HyrteWorkItemReview {
  requiredFrom?: string;
  requestedAt?: string;
  decidedAt?: string | null;
  decision?: 'approve' | 'request_changes' | 'reject' | 'reassign' | null;
  note?: string | null;
}

export interface HyrteWorkItemHistoryEntry {
  at: string;
  actor: string;
  action: string;
  note?: string;
}

export interface HyrteWorkItem {
  id: string;
  title: string;
  type: string;
  origin: 'ORCHESTRATOR' | 'STAKEHOLDER' | 'CANDIDATE_DELEGATION' | 'EVENT';
  priority: WorkItemPriority;
  stage: WorkItemStage;
  dueAt: string | null;
  ownerStakeholderId: string | null;
  ownerIsCandidate: boolean;
  ownerStakeholder?: HyrteStakeholder | null;
  artifacts: { type: string; content: string }[];
  review: HyrteWorkItemReview | null;
  history: HyrteWorkItemHistoryEntry[];
}

export interface HyrteCalendarEvent {
  id: string;
  title: string;
  agenda: string | null;
  startAt: string;
  endAt: string;
  attendeeStakeholderIds: string[];
}

export interface HyrteKnowledgeDoc {
  id: string;
  title: string;
  body: string;
  category: string;
}

export const ACTION_LABELS: Record<string, string> = {
  'email.reply': 'Replied to an email',
  'slack.send': 'Sent a Slack message',
  'task.stage_change': 'Changed a task stage',
  'knowledge_base.view': 'Consulted the knowledge base',
  'baseline_challenge.submit': 'Answered the warm-up challenge',
  'command_bar.overreach': 'Attempted an out-of-authority command',
  'command_bar.delegate': 'Delegated work via the command bar',
  'work_item.review_approve': 'Approved a work item',
  'work_item.review_request_changes': 'Requested changes on a work item',
  'work_item.review_reject': 'Rejected a work item',
  'work_item.review_reassign': 'Reassigned a work item',
  'meeting.attend': 'Joined a meeting',
};

export interface HyrteDecisionLogEntry {
  id: string;
  actor: string;
  actionType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface HyrteInterviewTurn {
  role: 'interviewer' | 'candidate';
  content: string;
}

export interface HyrteInterviewReport {
  strengths: string[];
  developmentAreas: string[];
  contradictions: { claimedInInterview: string; evidenceFromSimulation: string }[];
  recommendation: string;
  summary: string;
  evidenceTrail: { action: string; interviewProbe: string; interpretation: string }[];
  confidencePercent: number | null;
  nextStepRecommendation: string | null;
  decisionDNA: { traits: string[]; reasoning: string } | null;
  recoveryScore: { score: number; descriptor: string; reasoning: string } | null;
  counterfactuals: { decisionPoint: string; alternativePath: string; projectedOutcome: string }[];
  predictions: { dimension: string; likelihood: string; reasoning: string }[];
  metricsBreakdown: { bucket: string; score: number; explanation: string }[];
  generatedAt: string;
}

// §6.3 Decision Council — recruiter-facing surfaces (agent-reports, discussion, qa).
export interface HyrteCouncilAgentReport {
  id: string;
  agentKey: string;
  agentName: string;
  stance: 'HIRE' | 'LEAN_HIRE' | 'LEAN_NO_HIRE' | 'NO_HIRE' | null;
  reasoning: string;
  keyPoints: string[];
  citedEvidenceIds: string[];
  createdAt: string;
}

export interface HyrteCouncilDiscussionEntry {
  agentKey: string;
  statement: string;
  respondingToAgentKey: string | null;
  ordinal: number;
}

export interface HyrteCouncilQA {
  id: string;
  question: string;
  answer: string;
  createdAt: string;
}

export const COMPANY_STATE_LABELS: Record<keyof HyrteCompanyState, string> = {
  revenue: 'Revenue',
  customerSatisfaction: 'Customer Satisfaction',
  engineeringCapacity: 'Engineering Capacity',
  technicalDebt: 'Technical Debt',
  teamMorale: 'Team Morale',
  budget: 'Budget',
  riskLevel: 'Risk Level',
  deadlinePressure: 'Deadline Pressure',
  marketReputation: 'Market Reputation',
  cashRunway: 'Cash Runway',
  complianceRisk: 'Compliance Risk',
  productQuality: 'Product Quality',
  burnout: 'Team Burnout',
  hiringCapacity: 'Hiring Capacity',
  operationalRisk: 'Operational Risk',
  growth: 'Growth',
};

/** Fields where LOW is good and HIGH is bad — inverts the Meter's color logic. */
export const INVERTED_COMPANY_STATE_KEYS: Set<keyof HyrteCompanyState> = new Set([
  'technicalDebt',
  'riskLevel',
  'deadlinePressure',
  'complianceRisk',
  'burnout',
  'operationalRisk',
]);

/**
 * §4.1 Analytics tab scoping — "the same dashboards an employee in that role
 * would actually see, no more." HYRTE's actual tracked metrics are the 16
 * company-state variables, not the doc's full per-role metric catalogs
 * (MAU/API-latency/win-rate etc. — that needs a new metric-generation layer,
 * a separate, larger build). This is a scoped but real interpretation: every
 * role used to see the identical 16-meter dashboard; now each sees a curated,
 * role-appropriate subset of the same underlying data, framed for that job.
 */
const ROLE_ANALYTICS_KEYS: { pattern: RegExp; keys: (keyof HyrteCompanyState)[] }[] = [
  { pattern: /product/i, keys: ['productQuality', 'customerSatisfaction', 'growth', 'deadlinePressure', 'technicalDebt', 'marketReputation'] },
  { pattern: /engineer|developer|technical/i, keys: ['engineeringCapacity', 'technicalDebt', 'operationalRisk', 'productQuality', 'deadlinePressure'] },
  { pattern: /sales/i, keys: ['revenue', 'growth', 'marketReputation', 'deadlinePressure', 'customerSatisfaction'] },
  { pattern: /\bhr\b|people|human resources/i, keys: ['teamMorale', 'burnout', 'hiringCapacity', 'complianceRisk'] },
  { pattern: /financ/i, keys: ['budget', 'cashRunway', 'complianceRisk', 'revenue', 'riskLevel'] },
  { pattern: /marketing/i, keys: ['marketReputation', 'growth', 'customerSatisfaction', 'budget'] },
];

export function getAnalyticsKeysForRole(role: string): (keyof HyrteCompanyState)[] {
  const match = ROLE_ANALYTICS_KEYS.find((r) => r.pattern.test(role));
  return match ? match.keys : (Object.keys(COMPANY_STATE_LABELS) as (keyof HyrteCompanyState)[]);
}

/**
 * §8.1's canonical report groups every metric under "Role Competency (50%)"
 * / "Workplace Intelligence (50%)" rather than a flat list — mirrors
 * apps/api/.../evaluation-metrics.ts's METRIC_BUCKET_GROUP exactly. Purely
 * a presentation grouping over scores the API already returns; no new data.
 */
export const METRIC_BUCKET_GROUP: Record<string, 'ROLE_COMPETENCY' | 'WORKPLACE_INTELLIGENCE'> = {
  'Technical/Role Competency': 'ROLE_COMPETENCY',
  Cognitive: 'ROLE_COMPETENCY',
  Communication: 'WORKPLACE_INTELLIGENCE',
  Behavioral: 'WORKPLACE_INTELLIGENCE',
  'Confidence & Delivery': 'WORKPLACE_INTELLIGENCE',
  'Risk Detection': 'WORKPLACE_INTELLIGENCE',
  'Hiring Readiness': 'WORKPLACE_INTELLIGENCE',
  'Recruiter Decision': 'WORKPLACE_INTELLIGENCE',
};

export function groupMetrics(metrics: { bucket: string; score: number; explanation: string }[]) {
  const roleCompetency = metrics.filter((m) => METRIC_BUCKET_GROUP[m.bucket] === 'ROLE_COMPETENCY');
  const workplaceIntelligence = metrics.filter((m) => METRIC_BUCKET_GROUP[m.bucket] === 'WORKPLACE_INTELLIGENCE');
  const avg = (arr: { score: number }[]) => (arr.length ? Math.round(arr.reduce((s, m) => s + m.score, 0) / arr.length) : null);
  return {
    roleCompetency: { buckets: roleCompetency, avgScore: avg(roleCompetency) },
    workplaceIntelligence: { buckets: workplaceIntelligence, avgScore: avg(workplaceIntelligence) },
  };
}
