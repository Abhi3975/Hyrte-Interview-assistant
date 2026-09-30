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
  // ── Practical-task library (founder PDF, "My tasks practical v1") ────────
  // Nine role families the library names that had no tasks of their own and
  // fell through to the generic diagnose/decide pair. Ordered before the
  // broader families below because resolution is first-match: "AI/ML Engineer"
  // and "QA Engineer" would otherwise be swallowed by /engineer/, "Technical
  // Support" by /support/, and "HR Operations" by /operations/.
  {
    // Must precede the engineer family — an ML engineer debugging a model is
    // not the same task as a backend engineer debugging an API.
    pattern: /\b(ai|ml|machine learning|data scien)\w*\s*(engineer|scientist)?|mlops|\bllm\b/i,
    tasks: [
      {
        key: 'aiml_debug',
        title: 'Debug the AI workflow',
        summary: 'Something in the pipeline is producing bad output. Find out what, and prove it.',
        workspace: 'DELIVERABLE',
        type: 'ANALYSIS',
        tags: ['Model debugging', 'Evaluation'],
        reviewerHint: /engineer|data|technical|\bai\b|\bml\b/i,
        successCriteria: [
          'Separates a data problem from a model problem from a prompt problem',
          'Proposes a measurement, not just an opinion about quality',
          'States what would falsify the diagnosis',
        ],
        sections: [
          { id: 'symptom', label: 'What the output is doing wrong', hint: 'Be concrete — a specific bad case beats "quality is poor".', long: true, required: true },
          { id: 'hypotheses', label: 'Candidate causes', hint: 'Data, model, prompt, retrieval, evaluation itself. Which are live and why?', long: true, required: true },
          { id: 'evaluation', label: 'How you would measure it', hint: 'What you would run, on what set, and what number would tell you it is fixed.', long: true, required: true },
          { id: 'falsify', label: 'What would prove you wrong', hint: 'The result that would send you back to the start.', long: true },
        ],
      },
      { ...GENERIC_TASKS[1], key: 'aiml_decide', title: 'Make the ship call', summary: 'Decide whether this model is good enough to put in front of users.' },
    ],
  },
  {
    // Before the engineer family: a QA engineer's hero task is a test plan,
    // not a code review.
    pattern: /\bqa\b|quality assurance|\btester\b|test engineer|\bsdet\b/i,
    tasks: [
      {
        key: 'qa_testplan',
        title: 'Test the release',
        summary: 'A release is due. Decide what gets tested, find what is broken, and say whether it ships.',
        workspace: 'DELIVERABLE',
        type: 'DOCUMENT',
        tags: ['Test design', 'Risk'],
        reviewerHint: /engineer|qa|quality|product/i,
        successCriteria: [
          'Prioritises by risk rather than testing everything equally',
          'Writes reproducible steps, not "it is broken"',
          'Gives a clear ship / do-not-ship position',
        ],
        sections: [
          { id: 'risk', label: 'Where the risk actually is', hint: 'What in this release is most likely to break, and what would it cost?', long: true, required: true },
          { id: 'cases', label: 'What you will test', hint: 'The cases that matter, in priority order. Include at least one edge case per area.', long: true, required: true },
          { id: 'found', label: 'Bugs found', hint: 'One per line: steps to reproduce, expected, actual, severity.', long: true, required: true },
          { id: 'verdict', label: 'Ship or hold', hint: 'Your call, and the specific bug that drives it.', required: true },
        ],
      },
      { ...GENERIC_TASKS[0], key: 'qa_diagnose', title: 'Reproduce the reported bug', summary: 'A customer says it is broken. Work out whether it is, and where.' },
    ],
  },
  {
    // Before the generic support family — a technical support engineer
    // troubleshoots a system; a support agent handles a person.
    pattern: /technical support|support engineer|\bl2\b|\bl3\b|solutions engineer|field engineer/i,
    tasks: [
      {
        key: 'techsupport_troubleshoot',
        title: 'Troubleshoot the product issue',
        summary: 'A customer is blocked and escalating. Work out what is actually wrong.',
        workspace: 'DELIVERABLE',
        type: 'ANALYSIS',
        tags: ['Troubleshooting', 'Customer comms'],
        reviewerHint: /support|engineer|technical|customer/i,
        successCriteria: [
          'Distinguishes what the customer reported from what is actually happening',
          'Gives the customer something usable now, not only a root cause',
          'Names when to escalate rather than holding on to it',
        ],
        sections: [
          { id: 'reported', label: 'What was reported', hint: 'In the customer’s words, then in technical terms.', long: true, required: true },
          { id: 'investigation', label: 'What you checked', hint: 'Logs, config, versions, recent changes — and what each ruled in or out.', long: true, required: true },
          { id: 'workaround', label: 'Unblock them now', hint: 'What the customer can do today, even if the real fix takes longer.', long: true, required: true },
          { id: 'escalation', label: 'Escalate or own it', hint: 'If this needs engineering, say what you would hand over and why.', long: true },
        ],
      },
      { ...GENERIC_TASKS[1], key: 'techsupport_decide', title: 'Make the escalation call', summary: 'Decide whether this becomes an engineering problem, and defend it.' },
    ],
  },
  {
    pattern: /customer success|\bcsm\b|account manage|renewal|retention manager/i,
    tasks: [
      {
        key: 'cs_renewal',
        title: 'Handle the renewal risk',
        summary: 'A paying account is showing every sign of leaving. Work out why, and what you would say.',
        workspace: 'DELIVERABLE',
        type: 'DOCUMENT',
        tags: ['Retention', 'Difficult conversations'],
        reviewerHint: /customer|success|sales|account|revenue/i,
        successCriteria: [
          'Diagnoses the real reason rather than the stated one',
          'Proposes something the company can actually honour',
          'Does not promise away margin or engineering time it cannot spend',
        ],
        sections: [
          { id: 'signals', label: 'What the account is telling you', hint: 'Usage, tickets, sentiment, who has gone quiet. Use the real numbers.', long: true, required: true },
          { id: 'why', label: 'Why they are really leaving', hint: 'The stated reason is rarely the whole reason. What do you think it is?', long: true, required: true },
          { id: 'offer', label: 'What you would put on the table', hint: 'Be specific and be honest about what it costs us.', long: true, required: true },
          { id: 'conversation', label: 'How you would open the call', hint: 'Write the first thing you would actually say to them.', long: true, required: true },
        ],
      },
      { ...GENERIC_TASKS[1], key: 'cs_decide', title: 'Decide what to concede', summary: 'Choose what you will and will not give away to keep this account.' },
    ],
  },
  {
    pattern: /customer support|support (agent|rep|specialist)|helpdesk|service desk|\bcx\b/i,
    tasks: [
      {
        key: 'support_resolve',
        title: 'Resolve the customer issue',
        summary: 'An unhappy customer needs an answer. Give them one — and fix what caused it.',
        workspace: 'DELIVERABLE',
        type: 'REPLY',
        tags: ['Customer comms', 'Ownership'],
        reviewerHint: /support|customer|service|operations/i,
        successCriteria: [
          'Answers the question actually asked, in plain language',
          'Takes ownership instead of routing the customer onward',
          'Separates the individual fix from the thing that keeps causing it',
        ],
        sections: [
          { id: 'understanding', label: 'What they need', hint: 'Restate the problem as the customer experiences it, not as a ticket category.', long: true, required: true },
          { id: 'reply', label: 'Your reply to the customer', hint: 'Write it as you would send it. Tone matters as much as accuracy here.', long: true, required: true },
          { id: 'fix', label: 'What you did internally', hint: 'The actual steps taken to resolve it on our side.', long: true, required: true },
          { id: 'prevent', label: 'Stop it recurring', hint: 'What would keep the next customer from hitting this at all?', long: true },
        ],
      },
      { ...GENERIC_TASKS[0], key: 'support_diagnose', title: 'Find the pattern in the tickets', summary: 'Several customers are reporting variations of the same thing. Work out what it is.' },
    ],
  },
  {
    pattern: /recruit|talent acquisition|\bta\b\s*(partner|specialist)|sourcer|hiring manager/i,
    tasks: [
      {
        key: 'rec_screen',
        title: 'Run the screening interview',
        summary: 'Design and run a first-round screen that actually separates candidates.',
        workspace: 'DELIVERABLE',
        type: 'DOCUMENT',
        tags: ['Assessment design', 'Judgement'],
        reviewerHint: /hr|people|talent|recruit|hiring/i,
        successCriteria: [
          'Questions map to the role’s real requirements, not to personality',
          'Defines what a good and a weak answer sound like BEFORE interviewing',
          'Reaches a decision rather than a summary',
        ],
        sections: [
          { id: 'must_haves', label: 'What this role genuinely requires', hint: 'Three or four things. Not a wish list — what would make someone fail without it.', long: true, required: true },
          { id: 'questions', label: 'Your screening questions', hint: 'One per line, each tied to a requirement above.', long: true, required: true },
          { id: 'bar', label: 'What a strong answer sounds like', hint: 'For your two most important questions, describe strong vs weak. This is what stops the bar drifting.', long: true, required: true },
          { id: 'decision', label: 'Advance or reject', hint: 'Your call on the candidate in the brief, with the evidence behind it.', long: true, required: true },
        ],
      },
      { ...GENERIC_TASKS[1], key: 'rec_decide', title: 'Make the hiring recommendation', summary: 'Commit to advance or reject, and defend it to the hiring manager.' },
    ],
  },
  {
    // Before the operations family — "HR Operations" contains "operations".
    pattern: /\bhr\b|human resources|people ops|people operations|hris/i,
    tasks: [
      {
        key: 'hr_onboarding',
        title: 'Run the onboarding workflow',
        summary: 'Someone starts Monday. Make sure everything that has to happen, happens.',
        workspace: 'DELIVERABLE',
        type: 'DOCUMENT',
        tags: ['Process design', 'Coordination'],
        reviewerHint: /hr|people|operations|manager/i,
        successCriteria: [
          'Covers access, payroll, compliance and the human side — not just IT setup',
          'Names who is responsible for each step, not just what the step is',
          'Has a check that catches a step being missed',
        ],
        sections: [
          { id: 'before', label: 'Before day one', hint: 'What must be done in advance, by whom, and by when.', long: true, required: true },
          { id: 'day_one', label: 'Day one', hint: 'What the new joiner actually experiences, hour by hour.', long: true, required: true },
          { id: 'first_month', label: 'First month', hint: 'Checkpoints, training, and who owns each one.', long: true, required: true },
          { id: 'failure', label: 'What usually goes wrong', hint: 'The step most often missed here, and how your process catches it.', long: true },
        ],
      },
      { ...GENERIC_TASKS[1], key: 'hr_decide', title: 'Make the policy call', summary: 'Decide how to handle a case the policy does not cleanly cover.' },
    ],
  },
  {
    // Before the operations family — a logistics incident is its own shape.
    pattern: /logistic|supply chain|shipment|warehouse|fulfilment|fulfillment|freight/i,
    tasks: [
      {
        key: 'log_delay',
        title: 'Resolve the delayed shipment',
        summary: 'A shipment is late and customers are already asking. Sort it out.',
        workspace: 'DELIVERABLE',
        type: 'DECISION',
        tags: ['Incident handling', 'Trade-offs'],
        reviewerHint: /operations|logistic|supply|customer/i,
        successCriteria: [
          'Weighs cost against customer impact explicitly rather than defaulting to either',
          'Communicates to the customer before they chase again',
          'Fixes the immediate case and names the systemic one',
        ],
        sections: [
          { id: 'situation', label: 'Where it actually is', hint: 'What is delayed, by how long, and who is affected.', long: true, required: true },
          { id: 'options', label: 'Your options', hint: 'At least two, with what each costs and what each saves.', long: true, required: true },
          { id: 'call', label: 'What you are doing', hint: 'The option you picked and why it beats the others here.', long: true, required: true },
          { id: 'comms', label: 'What you tell the customer', hint: 'Write the message. Being early and honest beats being precise and late.', long: true, required: true },
        ],
      },
      { ...GENERIC_TASKS[0], key: 'log_diagnose', title: 'Find why deliveries keep slipping', summary: 'This is the third delay this month. Work out what is actually causing it.' },
    ],
  },
  {
    pattern: /operations|\bops\b|operations executive|business operations|process/i,
    tasks: [
      {
        key: 'ops_incident',
        title: 'Resolve the operational incident',
        summary: 'Something has broken in how the business runs. Stabilise it, then fix the cause.',
        workspace: 'DELIVERABLE',
        type: 'ANALYSIS',
        tags: ['Incident response', 'Process'],
        reviewerHint: /operations|manager|director|\bcoo\b/i,
        successCriteria: [
          'Stops the bleeding before investigating the cause',
          'Traces to a process failure rather than blaming a person',
          'Proposes a change that would have prevented it',
        ],
        sections: [
          { id: 'impact', label: 'What is affected right now', hint: 'Who is blocked, what it is costing, and how fast it is getting worse.', long: true, required: true },
          { id: 'immediate', label: 'What you did first', hint: 'The containment step, before any investigation.', long: true, required: true },
          { id: 'cause', label: 'Why it happened', hint: 'The process gap, not the individual. Be specific about where it broke.', long: true, required: true },
          { id: 'prevent', label: 'What changes', hint: 'The concrete change, and who owns it.', long: true, required: true },
        ],
      },
      { ...GENERIC_TASKS[1], key: 'ops_decide', title: 'Make the trade-off call', summary: 'Decide what to sacrifice when you cannot protect everything at once.' },
    ],
  },
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
    // "Marketer" was missing: /marketing/ does not match "Performance
    // Marketer", one of the commonest titles in the library, so it fell
    // through to the generic pair. Caught by the coverage test below.
    pattern: /market(ing|er)|growth|brand|content|demand gen|\bseo\b|\bsem\b|paid (media|ads|search)/i,
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
