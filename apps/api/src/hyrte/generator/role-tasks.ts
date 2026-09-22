import type { WorkItemType } from '@prisma/client';

/**
 * Founder feedback (WhatsApp, 7 Sep):
 *   "Task added nhi h as per the job role while working in the simulation, vo hoga."
 *   "Simulation kaafi review and approve type hori thi instead of working on real
 *    tasks disguised in the simulation, vo thk hogi."
 *
 * Refinements doc §10 ("THIS is the biggest change: Actual role execution") and
 * §11 ("Every simulation should have 1–3 Hero Tasks"):
 *
 *   "The candidate shouldn't spend 80% of the simulation: approve, delegate,
 *    review, respond, approve, respond. They need to do the work."
 *   "My Tasks tells you WHAT needs to be done. Opening the task gives you the
 *    actual tools to DO it."
 *
 * Everything the workspace had before this was reactive — read an email, reply,
 * delegate, approve someone else's artifact. The one exception, the signature
 * artifact (see signature-artifacts.ts), was a work item with a TITLE and
 * nothing behind it: opening it showed a card, not a place to produce anything.
 *
 * This module defines, per role family, the 1–3 Hero Tasks a candidate actually
 * performs and — critically — the STRUCTURE of the thing they produce. The
 * structure is deterministic and hand-authored rather than LLM-generated,
 * because it is what the evaluation reads: a PRD is scored on whether the
 * problem, scope and success metrics are actually good, which requires knowing
 * which section is which. The generator fills these templates with the real
 * company's situation; it never invents the shape.
 *
 * Resolution is by REGEX over real job-title language, same discipline as
 * signature-artifacts.ts — role is free text from a candidate picker or a
 * recruiter's JD decomposition, never an enum.
 */

/** Which interactive workspace opening this task drops the candidate into. */
export type TaskWorkspaceKind =
  /** A structured document the candidate writes section by section (PRD, campaign brief, postmortem, test plan…). */
  | 'DELIVERABLE'
  /** A recommendation backed by evidence — §Tasks "3. Launch decision": recommendation, reasoning, risks, mitigation. */
  | 'DECISION'
  /** §Tasks "2. Roadmap prioritization": rank real items into NOW / NEXT / LATER / NOT PLANNED with rationale. */
  | 'PRIORITIZATION';

export interface DeliverableSection {
  id: string;
  label: string;
  /** Placeholder shown in the editor — what a good answer to this section contains. */
  hint: string;
  /** Long-form prose vs. a short one-or-two-line answer. Drives the input height, nothing else. */
  long?: boolean;
  /** A section the candidate cannot leave empty on submit. */
  required?: boolean;
}

export interface RoleTaskTemplate {
  /** Stable key — used for the task's id suffix and to look the template back up at submit time. */
  key: string;
  title: string;
  /** One line under the title on the My Tasks card: what this task is for. */
  summary: string;
  workspace: TaskWorkspaceKind;
  type: WorkItemType;
  /** Short skill chips shown on the card — the competencies this task actually exercises. */
  tags: string[];
  /** What "done well" means, shown in the workspace's own brief panel. Fed to the reviewing stakeholder too. */
  successCriteria: string[];
  /** DELIVERABLE / DECISION: the sections the candidate fills in. Empty for PRIORITIZATION, which has its own board. */
  sections: DeliverableSection[];
  /**
   * PRIORITIZATION only — the columns items get ranked into. Ordered
   * best-to-worst so the evaluation can read intent from placement.
   */
  buckets?: string[];
  /**
   * Who should review this, matched against a stakeholder's role/department.
   * The Tasks appendix is specific about this — "Engineering agent reviews the
   * PRD. 'Requirement #3 isn't technically feasible within the current
   * sprint.'" — so a PRD goes to engineering, not to whoever happens to be the
   * most senior person in the building. Falls back to highest authority when
   * nobody in this world matches.
   */
  reviewerHint?: RegExp;
}

/** §Tasks "3. Launch decision" — the same four fields every role's judgement call is expressed in. */
const DECISION_SECTIONS: DeliverableSection[] = [
  { id: 'recommendation', label: 'Recommendation', hint: 'State the call plainly, in one or two sentences. No hedging.', required: true },
  { id: 'reasoning', label: 'Reasoning', hint: 'What evidence led you here? Name the specific numbers, conversations or documents you used.', long: true, required: true },
  { id: 'risks', label: 'Risks', hint: 'What could go wrong if you are right, and what could go wrong if you are wrong?', long: true, required: true },
  { id: 'mitigation', label: 'Mitigation', hint: 'What will you do to reduce those risks, and what would make you reverse this decision?', long: true },
];

/** §Tasks "1. Product Manager — Write PRD" — the doc's own section list, verbatim in intent. */
const PRD_SECTIONS: DeliverableSection[] = [
  { id: 'problem', label: 'Problem', hint: 'What problem are you actually solving? Ground it in something real from this company.', long: true, required: true },
  { id: 'user', label: 'Target user', hint: 'Who is this for, specifically? Not "our customers".', required: true },
  { id: 'user_problem', label: 'User problem', hint: 'Describe the pain from the user’s point of view, not the business’s.', long: true, required: true },
  { id: 'goals', label: 'Goals', hint: 'What outcomes does this need to produce? One per line.', long: true, required: true },
  { id: 'requirements', label: 'Requirements', hint: 'What has to be built. One per line — be specific enough that engineering could estimate it.', long: true, required: true },
  { id: 'scope', label: 'Scope', hint: 'In scope / out of scope. Being explicit about what you are NOT doing is the point.', long: true, required: true },
  { id: 'success_metrics', label: 'Success metrics', hint: 'Metric, current baseline, target. Use the real numbers on the Analytics screen.', long: true, required: true },
  { id: 'acceptance', label: 'Acceptance criteria', hint: 'How will you know it is done and working?', long: true },
];

const GENERIC_TASKS: RoleTaskTemplate[] = [
  {
    key: 'diagnose',
    title: 'Diagnose the core problem',
    summary: 'Work out what is actually going wrong before anyone commits to a fix.',
    workspace: 'DELIVERABLE',
    type: 'ANALYSIS',
    tags: ['Analysis', 'Investigation'],
    successCriteria: [
      'Uses real evidence from the company — metrics, documents or what colleagues actually told you',
      'Separates symptom from cause instead of restating the complaint',
      'Names what you are still uncertain about',
    ],
    sections: [
      { id: 'summary', label: 'What is going on', hint: 'Your read of the situation, in plain language.', long: true, required: true },
      { id: 'evidence', label: 'Evidence', hint: 'The specific numbers, documents or conversations this rests on.', long: true, required: true },
      { id: 'root_cause', label: 'Most likely cause', hint: 'What you believe is actually driving it, and why that over the alternatives.', long: true, required: true },
      { id: 'unknowns', label: 'What you still do not know', hint: 'Be honest about the gaps and what would close them.', long: true },
    ],
  },
  {
    key: 'decide',
    title: 'Make the call',
    summary: 'Commit to a recommendation and defend it with evidence.',
    workspace: 'DECISION',
    type: 'DECISION',
    tags: ['Decision making', 'Judgement'],
    successCriteria: ['Takes a clear position', 'Reasoning traces to real evidence', 'Names the risk honestly rather than selling the decision'],
    sections: DECISION_SECTIONS,
  },
];

const ROLE_TASKS: { pattern: RegExp; tasks: RoleTaskTemplate[] }[] = [
  {
    pattern: /product manager|\bpm\b|product owner/i,
    tasks: [
      {
        key: 'pm_prd',
        title: 'Write the PRD',
        summary: 'Turn the problem into a specification engineering can actually build against.',
        workspace: 'DELIVERABLE',
        type: 'DOCUMENT',
        tags: ['Product execution', 'Writing', 'Scope'],
        reviewerHint: /engineer|technical|\bcto\b|architect/i,
        successCriteria: [
          'Problem is grounded in this company’s real situation, not a generic template',
          'Scope is explicit about what is deliberately excluded',
          'Success metrics name a real baseline and a real target',
        ],
        sections: PRD_SECTIONS,
      },
      {
        key: 'pm_roadmap',
        title: 'Prioritize the roadmap',
        summary: 'Rank the competing asks against revenue, effort and strategy — then defend it.',
        workspace: 'PRIORITIZATION',
        type: 'DECISION',
        tags: ['Prioritization', 'Trade-offs', 'Stakeholders'],
        successCriteria: [
          'Ranking reflects the actual evidence (requests, revenue, engineering estimates), not gut feel',
          'Every item has a rationale someone could disagree with',
          'Handles the fact that two credible people want opposite things',
        ],
        sections: [],
        buckets: ['Now', 'Next', 'Later', 'Not planned'],
      },
      {
        key: 'pm_launch',
        title: 'Make the launch recommendation',
        summary: 'Launch, delay or limited rollout — with the reasoning and the go-to-market call.',
        workspace: 'DECISION',
        type: 'DECISION',
        tags: ['Decision making', 'Risk', 'GTM'],
        successCriteria: ['Takes a clear position', 'Weighs customer evidence against readiness', 'States what would change the decision'],
        sections: [...DECISION_SECTIONS, { id: 'gtm', label: 'Go-to-market recommendation', hint: 'How this reaches customers, and what sales and marketing need from you.', long: true }],
      },
    ],
  },
  {
    pattern: /software engineer|developer|full[- ]?stack|backend|frontend|\bswe\b/i,
    tasks: [
      {
        key: 'eng_debug',
        title: 'Investigate the production issue',
        summary: 'Find the real cause, not the first plausible one, and propose the fix.',
        workspace: 'DELIVERABLE',
        type: 'ANALYSIS',
        tags: ['Debugging', 'Production', 'Analysis'],
        successCriteria: ['Reasoning follows the evidence rather than a guess', 'Distinguishes the trigger from the underlying cause', 'Fix is proportionate to the actual risk'],
        sections: [
          { id: 'symptoms', label: 'What users are seeing', hint: 'The observable failure, concretely.', long: true, required: true },
          { id: 'investigation', label: 'How you investigated', hint: 'What you checked, in order, and what each step ruled in or out.', long: true, required: true },
          { id: 'root_cause', label: 'Root cause', hint: 'What is actually wrong, and the evidence that says so.', long: true, required: true },
          { id: 'fix', label: 'Proposed fix', hint: 'What you would change, and why this rather than the quicker patch.', long: true, required: true },
          { id: 'prevention', label: 'Preventing a repeat', hint: 'Test, alert, or process change that would catch this earlier next time.', long: true },
        ],
      },
      {
        key: 'eng_review',
        title: 'Review the open pull request',
        summary: 'Approve, request changes, or block — and say exactly why.',
        workspace: 'DECISION',
        type: 'APPROVAL',
        tags: ['Code review', 'Standards', 'Communication'],
        reviewerHint: /engineer|technical|\bcto\b|architect/i,
        successCriteria: ['Separates "I would do it differently" from "this is wrong"', 'Feedback is specific and actionable', 'Judgement about what is worth blocking on'],
        sections: [
          { id: 'recommendation', label: 'Verdict', hint: 'Approve, approve with comments, or request changes.', required: true },
          { id: 'reasoning', label: 'What you found', hint: 'The specific issues, and how serious each one actually is.', long: true, required: true },
          { id: 'risks', label: 'Risk if this ships as-is', hint: 'Be concrete about what would break and for whom.', long: true, required: true },
          { id: 'mitigation', label: 'What you would ask for', hint: 'The smallest set of changes that would get this to a yes.', long: true },
        ],
      },
      {
        key: 'eng_design',
        title: 'Decide the technical approach',
        summary: 'Choose how this gets built and defend the trade-off.',
        workspace: 'DECISION',
        type: 'DECISION',
        tags: ['System design', 'Trade-offs'],
        successCriteria: ['Names the alternative you rejected', 'Trade-off is stated in terms of real constraints here', 'Honest about what this approach costs later'],
        sections: DECISION_SECTIONS,
      },
    ],
  },
  {
    pattern: /data (scientist|analyst)|analytics|machine learning|\bml\b/i,
    tasks: [
      {
        key: 'data_analysis',
        title: 'Produce the analysis',
        summary: 'Answer the business question the company is actually asking.',
        workspace: 'DELIVERABLE',
        type: 'ANALYSIS',
        tags: ['Analysis', 'Rigour', 'Communication'],
        successCriteria: ['Question is framed sharply before any numbers appear', 'States assumptions and their limits', 'Conclusion is proportionate to the evidence'],
        sections: [
          { id: 'question', label: 'The question', hint: 'Restate what is actually being asked, sharply enough to be answerable.', long: true, required: true },
          { id: 'approach', label: 'Approach', hint: 'What data you used and how you cut it.', long: true, required: true },
          { id: 'findings', label: 'Findings', hint: 'What the data says. Lead with the answer, not the method.', long: true, required: true },
          { id: 'caveats', label: 'Caveats', hint: 'Where this could be wrong, and what would make you more confident.', long: true, required: true },
          { id: 'recommendation', label: 'So what', hint: 'What should the business actually do differently?', long: true, required: true },
        ],
      },
      {
        key: 'data_metric',
        title: 'Define the metric',
        summary: 'Settle what the company should actually measure, and how.',
        workspace: 'DELIVERABLE',
        type: 'DOCUMENT',
        tags: ['Metric design', 'Instrumentation'],
        successCriteria: ['Definition is unambiguous enough that two teams would compute it identically', 'Names what it deliberately excludes', 'Considers how it could be gamed'],
        sections: [
          { id: 'definition', label: 'Definition', hint: 'Exactly how this is computed, including the denominator.', long: true, required: true },
          { id: 'why', label: 'Why this one', hint: 'What decision this metric is meant to support.', long: true, required: true },
          { id: 'excludes', label: 'What it does not capture', hint: 'Be explicit about the blind spots.', long: true, required: true },
          { id: 'gaming', label: 'How it could be gamed', hint: 'If someone optimised for this number and nothing else, what would go wrong?', long: true },
        ],
      },
      { ...GENERIC_TASKS[1], key: 'data_decide', title: 'Make the recommendation', summary: 'Commit to what the business should do about it.' },
    ],
  },
  {
    pattern: /sales|account (executive|manager)|\bsdr\b|\bbdr\b|business development|customer success/i,
    tasks: [
      {
        key: 'sales_qualify',
        title: 'Qualify the account',
        summary: 'Decide whether this deal is real and what it would take to win it.',
        workspace: 'DELIVERABLE',
        type: 'ANALYSIS',
        tags: ['Qualification', 'Discovery'],
        successCriteria: ['Distinguishes interest from intent', 'Names the actual decision-maker and the actual budget', 'Willing to say a deal is not real'],
        sections: [
          { id: 'situation', label: 'Where this account is', hint: 'What you know, and how you know it.', long: true, required: true },
          { id: 'pain', label: 'The pain', hint: 'What problem are they actually trying to solve, in their words?', long: true, required: true },
          { id: 'gaps', label: 'What you still need to find out', hint: 'The questions that decide whether this is winnable.', long: true, required: true },
          { id: 'plan', label: 'Next steps', hint: 'Specific actions, with who and by when.', long: true, required: true },
        ],
      },
      {
        key: 'sales_objection',
        title: 'Handle the objection',
        summary: 'Write the response that moves this deal forward without discounting your way there.',
        workspace: 'DELIVERABLE',
        type: 'REPLY',
        tags: ['Objection handling', 'Written communication'],
        reviewerHint: /sales|revenue|account|customer/i,
        successCriteria: ['Addresses the real concern, not the stated one', 'Does not concede on price reflexively', 'Ends with a concrete next step'],
        sections: [
          { id: 'reading', label: 'What is really going on', hint: 'Your read of the objection behind the objection.', long: true, required: true },
          { id: 'response', label: 'Your response', hint: 'Write the actual message you would send. This is the deliverable, not a summary of it.', long: true, required: true },
          { id: 'fallback', label: 'If that does not land', hint: 'What you try next, and where your genuine limit is.', long: true },
        ],
      },
      { ...GENERIC_TASKS[1], key: 'sales_decide', title: 'Make the deal call', summary: 'Push, hold or walk away — and commit to it.' },
    ],
  },
  {
    pattern: /marketing|growth|brand|content/i,
    tasks: [
      {
        key: 'mkt_brief',
        title: 'Write the campaign brief',
        summary: 'Turn the business goal into something a team could actually execute.',
        workspace: 'DELIVERABLE',
        type: 'DOCUMENT',
        tags: ['Positioning', 'Planning', 'Writing'],
        reviewerHint: /marketing|growth|brand|content/i,
        successCriteria: ['Audience is specific enough to exclude someone', 'Message is a claim, not a category', 'Success is defined in numbers before launch'],
        sections: [
          { id: 'objective', label: 'Objective', hint: 'The business outcome, not the activity.', long: true, required: true },
          { id: 'audience', label: 'Audience', hint: 'Who exactly, and what they currently believe.', long: true, required: true },
          { id: 'message', label: 'Core message', hint: 'The one thing they should remember. Make it a claim you could be wrong about.', long: true, required: true },
          { id: 'channels', label: 'Channels & why', hint: 'Where this runs, and what makes each channel right for this audience.', long: true, required: true },
          { id: 'metrics', label: 'Success metrics', hint: 'Metric, baseline, target — using the real numbers from Analytics.', long: true, required: true },
        ],
      },
      {
        key: 'mkt_positioning',
        title: 'Rewrite the positioning',
        summary: 'Fix how the product is described, based on what customers actually say.',
        workspace: 'DELIVERABLE',
        type: 'DOCUMENT',
        tags: ['Messaging', 'Customer insight'],
        successCriteria: ['Grounded in real customer language from this world', 'Differentiated rather than generic', 'Survives the "a competitor could say this too" test'],
        sections: [
          { id: 'current', label: 'What is wrong with the current positioning', hint: 'Be specific and cite what customers actually said.', long: true, required: true },
          { id: 'new', label: 'New positioning statement', hint: 'Write it as it would appear on the site.', long: true, required: true },
          { id: 'proof', label: 'Proof points', hint: 'What makes the claim credible?', long: true, required: true },
        ],
      },
      { ...GENERIC_TASKS[1], key: 'mkt_decide', title: 'Make the budget call', summary: 'Decide where the spend goes and defend it.' },
    ],
  },
  {
    pattern: /designer|\bux\b|\bui\b|product design/i,
    tasks: [
      {
        key: 'design_review',
        title: 'Write the design rationale',
        summary: 'Defend the decisions behind the work, in writing, to people who will push back.',
        workspace: 'DELIVERABLE',
        type: 'DOCUMENT',
        tags: ['Design judgement', 'Communication'],
        reviewerHint: /design|product|\bux\b/i,
        successCriteria: ['Reasons from the user problem, not taste', 'Names the alternative considered and rejected', 'Anticipates the objection it will actually get'],
        sections: [
          { id: 'problem', label: 'The user problem', hint: 'What is hard for the user today, concretely.', long: true, required: true },
          { id: 'decisions', label: 'Key decisions', hint: 'The two or three choices that matter most, and why each one.', long: true, required: true },
          { id: 'rejected', label: 'What you rejected', hint: 'The alternative that was tempting, and what ruled it out.', long: true, required: true },
          { id: 'validation', label: 'How you would validate it', hint: 'What would tell you this is working after it ships?', long: true },
        ],
      },
      { ...GENERIC_TASKS[0], key: 'design_diagnose', title: 'Diagnose the drop-off', summary: 'Work out where users are failing and why.' },
      { ...GENERIC_TASKS[1], key: 'design_decide', title: 'Make the scope call', summary: 'Decide what ships when engineering can only build half of it.' },
    ],
  },
];

export function resolveRoleTasks(role: string): RoleTaskTemplate[] {
  return ROLE_TASKS.find((entry) => entry.pattern.test(role))?.tasks ?? GENERIC_TASKS;
}

export function findRoleTask(role: string, key: string): RoleTaskTemplate | undefined {
  return resolveRoleTasks(role).find((t) => t.key === key);
}
