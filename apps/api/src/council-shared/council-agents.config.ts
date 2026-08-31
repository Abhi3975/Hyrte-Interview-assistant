/**
 * §6 Decision Council — the nine agent mandates, verbatim to the doc's table.
 * Five vote a hire/no-hire lean; four are oversight roles that challenge or
 * aggregate the other five's reasoning rather than voting themselves.
 *
 * Shared by both HYRTE's DecisionCouncilService and Ally's
 * InterviewCouncilService — moved here (out of hyrte/council/) once the two
 * councils' orchestration logic was merged into CouncilCoreService, so the
 * agent roster genuinely belongs to neither product surface specifically.
 */
export interface CouncilAgentDef {
  key: string;
  name: string;
  votes: boolean;
  mandate: string;
}

export const COUNCIL_AGENTS: CouncilAgentDef[] = [
  {
    key: 'interviewLead',
    name: 'Interview Lead',
    votes: true,
    mandate:
      'You ran the reflection interview and are the only committee member who directly experienced the ' +
      "conversation. Assess rapport, engagement, and how the candidate handled being questioned and " +
      "challenged — not just the content of their answers.",
  },
  {
    key: 'hiringManager',
    name: 'Hiring Manager',
    votes: true,
    mandate: 'Execution, ownership, decision quality — can this person actually deliver in the role?',
  },
  {
    key: 'functionalExpert',
    name: 'Functional Expert',
    votes: true,
    mandate:
      "Role-specific technical/domain depth for this candidate's target role — do they show real domain " +
      'judgment, not just the right vocabulary?',
  },
  {
    key: 'futureTeammate',
    name: 'Future Teammate',
    votes: true,
    mandate: 'Collaboration, communication, coachability, and how they handle conflict day-to-day.',
  },
  {
    key: 'executiveFounder',
    name: 'Executive/Founder',
    votes: true,
    mandate: 'Long-term potential, vision, adaptability — could this person grow into more responsibility?',
  },
  {
    key: 'devilsAdvocate',
    name: "Devil's Advocate",
    votes: false,
    mandate:
      'Challenge the emerging consensus. For each strength being credited, ask: based on what evidence, ' +
      'specifically? Your job is to prevent premature agreement, not to reach your own hire/no-hire verdict.',
  },
  {
    key: 'biasAuditor',
    name: 'Bias Auditor',
    votes: false,
    mandate:
      "Watch for bias IN THE OTHER AGENTS' REASONING, not in the candidate: halo effect (one good answer " +
      'inflating everything), confidence bias (mistaking fluency for competence), similarity bias, recency ' +
      "bias, communication-style bias. Name any you find, quoting the specific claim; if you find none, say " +
      'so plainly rather than inventing one.',
  },
  {
    key: 'evidenceAuditor',
    name: 'Evidence Auditor',
    votes: false,
    mandate:
      'Flag any claim the other agents made that is NOT actually backed by the evidence brief or transcript ' +
      '— demand verification rather than letting it stand unchallenged.',
  },
  {
    key: 'decisionCortex',
    name: 'Decision Cortex',
    votes: false,
    mandate:
      'Aggregate everything the committee produced: overall decision confidence (0-100), evidence coverage, ' +
      'any missing signals, and a predicted-success read. You do not vote — you synthesize.',
  },
];
