import type { WorkItemType } from '@prisma/client';

/**
 * Refinements doc §22 — "Role-Specific Signature Challenges: every role
 * should include ONE signature work artifact that demonstrates genuine job
 * capability, not just communication skills" (a PM's PRD, an Engineer's
 * debug report, etc.) — before this, every role got the same generic
 * document/reply/decision/approval/build/analysis/meeting_outcome work
 * items regardless of role, per the audit's own finding.
 *
 * Role is free text (candidate self-serve picker OR a recruiter's
 * JD-decompose flow, which can produce almost any string), so this
 * resolves by REGEX pattern over real job-title language rather than an
 * exact-match table — same discipline as this codebase's existing
 * COMMITMENT_DEPARTMENT/CAPACITY_DEPARTMENT department matchers.
 */
export interface SignatureArtifactTemplate {
  /** Short display label for the artifact type, e.g. "Product Requirements Document (PRD)". */
  label: string;
  workItemType: WorkItemType;
  /** What the candidate is actually being asked to produce — fed into the world-generation prompt as real, concrete grounding. */
  promptHint: string;
}

const SIGNATURE_ARTIFACTS: { pattern: RegExp; template: SignatureArtifactTemplate }[] = [
  {
    pattern: /product manager|\bpm\b|product owner/i,
    template: {
      label: 'Product Requirements Document (PRD)',
      workItemType: 'DOCUMENT',
      promptHint: 'a real PRD for a specific, currently-contested feature or roadmap decision — including the problem, proposed scope, and trade-offs — that stakeholders will actually push back on',
    },
  },
  {
    pattern: /devops|site reliability|\bsre\b|infrastructure engineer|platform engineer/i,
    template: {
      label: 'Incident Postmortem',
      workItemType: 'ANALYSIS',
      promptHint: 'a real incident postmortem for a specific production/infrastructure failure already referenced elsewhere in the world — root cause, impact, and remediation plan',
    },
  },
  {
    pattern: /\bqa\b|quality assurance|test engineer|sdet/i,
    template: {
      label: 'Test Plan',
      workItemType: 'DOCUMENT',
      promptHint: 'a real test plan for a specific upcoming release or feature already referenced elsewhere in the world, including what could plausibly go wrong',
    },
  },
  {
    pattern: /software engineer|developer|full[- ]?stack|backend|frontend|\bswe\b/i,
    template: {
      label: 'Debug Investigation Report',
      workItemType: 'ANALYSIS',
      promptHint: 'a real debug investigation report for a specific production issue already referenced elsewhere in the world — findings, root cause hypothesis, and proposed fix',
    },
  },
  {
    pattern: /data scientist|machine learning|\bml\b/i,
    template: {
      label: 'Model Evaluation Memo',
      workItemType: 'ANALYSIS',
      promptHint: 'a real model/data evaluation memo covering a specific quality or performance concern already referenced elsewhere in the world',
    },
  },
  {
    pattern: /data analyst|analytics/i,
    template: {
      label: 'Data Analysis Report',
      workItemType: 'ANALYSIS',
      promptHint: 'a real data analysis report investigating a specific KPI trend or business question already referenced elsewhere in the world',
    },
  },
  {
    pattern: /designer|\bux\b|\bui\b/i,
    template: {
      label: 'Design Review Memo',
      workItemType: 'DOCUMENT',
      promptHint: 'a real design review memo defending specific design decisions on a feature already referenced elsewhere in the world, anticipating pushback',
    },
  },
  {
    pattern: /\bsdr\b|\bbdr\b|business development/i,
    template: {
      label: 'Prospect Outreach Plan',
      workItemType: 'DOCUMENT',
      promptHint: 'a real prospect outreach/qualification plan for a specific target account already referenced elsewhere in the world',
    },
  },
  {
    pattern: /customer success|account manager|client success/i,
    template: {
      label: 'Customer Success Plan',
      workItemType: 'DOCUMENT',
      promptHint: 'a real success/retention plan for a specific at-risk customer already referenced elsewhere in the world',
    },
  },
  {
    pattern: /sales/i,
    template: {
      label: 'Deal Proposal',
      workItemType: 'DOCUMENT',
      promptHint: 'a real deal proposal or negotiation plan for a specific prospective/existing customer already referenced elsewhere in the world',
    },
  },
  {
    pattern: /recruiter|talent acquisition/i,
    template: {
      label: 'Hiring Recommendation',
      workItemType: 'DECISION',
      promptHint: 'a real hiring recommendation memo for a specific open role or candidate already referenced elsewhere in the world, with justified reasoning',
    },
  },
  {
    pattern: /\bhr\b|human resources|people (partner|ops)/i,
    template: {
      label: 'People Recommendation Memo',
      workItemType: 'DECISION',
      promptHint: 'a real people/HR recommendation memo addressing a specific employee-relations or policy situation already referenced elsewhere in the world',
    },
  },
  {
    pattern: /finance|accounting|\bfp&a\b/i,
    template: {
      label: 'Budget Justification Memo',
      workItemType: 'DECISION',
      promptHint: 'a real budget approval/rejection memo with financial reasoning for a specific spend request already referenced elsewhere in the world',
    },
  },
  {
    pattern: /marketing/i,
    template: {
      label: 'Campaign Brief',
      workItemType: 'DOCUMENT',
      promptHint: 'a real campaign brief for a specific upcoming launch or initiative already referenced elsewhere in the world, with goals and target metrics',
    },
  },
  {
    pattern: /project manager|program manager/i,
    template: {
      label: 'Delivery Re-Plan',
      workItemType: 'DECISION',
      promptHint: 'a real re-plan of a specific delivery timeline already referenced elsewhere in the world, addressing a concrete blocker or dependency',
    },
  },
  {
    pattern: /operations|\bops\b/i,
    template: {
      label: 'Process Improvement Proposal',
      workItemType: 'DOCUMENT',
      promptHint: 'a real proposal to fix a specific operational bottleneck already referenced elsewhere in the world',
    },
  },
];

const FALLBACK_TEMPLATE: SignatureArtifactTemplate = {
  label: 'Key Deliverable',
  workItemType: 'DOCUMENT',
  promptHint: "a real, substantive deliverable that represents this role's core responsibility, grounded in a specific situation already referenced elsewhere in the world",
};

export function resolveSignatureArtifact(role: string): SignatureArtifactTemplate {
  const match = SIGNATURE_ARTIFACTS.find((entry) => entry.pattern.test(role));
  return match ? match.template : FALLBACK_TEMPLATE;
}
