export interface HyrteStakeholder {
  id: string;
  name: string;
  role: string;
  avatarSeed: string;
  trust: number;
  respect: number;
  cooperation: number;
  influence: number;
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
}

export interface HyrteBaselineChallengeOption {
  id: string;
  label: string;
}

export interface HyrteBaselineChallenge {
  scenario: string;
  options: HyrteBaselineChallengeOption[];
}

export interface HyrteSession {
  id: string;
  companyName: string;
  role: string;
  phase: string;
  missionBrief: HyrteMissionBrief | null;
  baselineChallenge: HyrteBaselineChallenge | null;
}

export interface HyrteInboxMessage {
  id: string;
  subject: string;
  body: string;
  urgent: boolean;
  readAt: string | null;
  createdAt: string;
  fromStakeholder?: HyrteStakeholder | null;
}

export interface HyrteSlackMessage {
  id: string;
  channel: string;
  body: string;
  createdAt: string;
  fromStakeholder?: HyrteStakeholder | null;
}

export interface HyrteTask {
  id: string;
  title: string;
  priority: string;
  status: string;
  dueAt: string | null;
}

export interface HyrteCalendarEvent {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
}

export interface HyrteKnowledgeDoc {
  id: string;
  title: string;
  body: string;
  category: string;
}

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
