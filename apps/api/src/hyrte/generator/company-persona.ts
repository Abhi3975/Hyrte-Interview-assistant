/**
 * The Company Persona Engine, with something behind it.
 *
 * What existed was one word in one prompt: "a ${companyType} company". The UI
 * offered five options, the API accepted any string, and nothing downstream
 * read it — so a government agency and a seed-stage startup generated worlds
 * that differed only in whatever flavour the model happened to add that run.
 *
 * A company type is not flavour. It is the single biggest determinant of how
 * work actually feels: who has to agree before anything happens, whether the
 * answer is written down or has to be asked for, how much of the real reason
 * is said out loud. Those are the things a candidate is being assessed on
 * navigating, so they have to be real properties of the world, not adjectives.
 *
 * Resolved by regex over free text rather than an enum, same as
 * `resolveCompetencies` / `resolveRoleTasks` / `resolveAxisPool`: recruiters
 * type what they mean ("Series B fintech", "Big 4", "public sector body"), and
 * an unrecognised string gets a reasonable middle rather than nothing.
 */

export interface CompanyPersona {
  key: string;
  label: string;
  /** How many people have to agree before a decision sticks. Drives stakeholder behaviour. */
  approvalDepth: 1 | 2 | 3;
  /** How fast things move once they are agreed. */
  decisionSpeed: 'immediate' | 'days' | 'weeks';
  /** How much is already written down — the inverse of how much must be asked for. */
  documentationCulture: 'tribal' | 'mixed' | 'formal';
  /** How much of the real reason goes unsaid. Drives hidden intentions. */
  politicalLoad: 'low' | 'medium' | 'high';
  /** Whether an unclear brief is normal or a problem to escalate. */
  ambiguityTolerance: 'high' | 'medium' | 'low';
  /** One line, in the world's own voice, for the generation prompt. */
  worldDirective: string;
}

const PERSONAS: (CompanyPersona & { match: RegExp })[] = [
  {
    match: /\b(startup|start-up|seed|pre-seed|series\s*a|early[- ]stage|founding|yc|garage)\b/i,
    key: 'startup',
    label: 'Early-stage startup',
    approvalDepth: 1,
    decisionSpeed: 'immediate',
    documentationCulture: 'tribal',
    politicalLoad: 'low',
    ambiguityTolerance: 'high',
    worldDirective:
      'Almost nothing is written down — the answer lives in someone\'s head and has to be asked for. Anyone can decide ' +
      'almost anything, and does, often in a DM. Briefs are one line and assume context the candidate does not have. ' +
      'There is no process to hide behind and no one to escalate to; priorities change inside a day.',
  },
  {
    match: /\b(scale-?up|series\s*[b-d]|growth[- ]stage|high[- ]growth|unicorn)\b/i,
    key: 'scaleup',
    label: 'Scale-up',
    approvalDepth: 2,
    decisionSpeed: 'days',
    documentationCulture: 'mixed',
    politicalLoad: 'medium',
    ambiguityTolerance: 'medium',
    worldDirective:
      'Process is being invented while it is used — half of it is documented and the other half is still tribal, and ' +
      'nobody agrees which half. Teams that used to be one team now have to negotiate. The founders still overrule ' +
      'things occasionally, which everyone finds destabilising and nobody says so directly.',
  },
  {
    match: /\b(enterprise|corporate|fortune|multinational|large[- ]company|public[- ]company|plc|conglomerate)\b/i,
    key: 'enterprise',
    label: 'Enterprise',
    approvalDepth: 3,
    decisionSpeed: 'weeks',
    documentationCulture: 'formal',
    politicalLoad: 'high',
    ambiguityTolerance: 'low',
    worldDirective:
      'Everything has an owner, a process and a document, and finding the right one is most of the work. Decisions need ' +
      'sign-off from people who were not in the conversation. Nobody says no outright — things are referred, deferred, ' +
      'and put on an agenda. Headcount and budget are what the arguments are actually about.',
  },
  {
    match: /\b(consult|consulting|advisory|agency|professional services|big\s*4|client[- ]services)\b/i,
    key: 'consulting',
    label: 'Consulting / agency',
    approvalDepth: 2,
    decisionSpeed: 'days',
    documentationCulture: 'formal',
    politicalLoad: 'high',
    ambiguityTolerance: 'medium',
    worldDirective:
      'The client is in the room even when they are not, and utilisation is watched. Work is packaged to be presented, ' +
      'so how it looks is part of whether it is right. Internal priorities lose to client escalations without discussion. ' +
      'Partners protect relationships, which is not always the same as protecting the work.',
  },
  {
    match: /\b(government|public sector|civil service|municipal|federal|state agency|ministry|council|regulator)\b/i,
    key: 'government',
    label: 'Government / public sector',
    approvalDepth: 3,
    decisionSpeed: 'weeks',
    documentationCulture: 'formal',
    politicalLoad: 'high',
    ambiguityTolerance: 'low',
    worldDirective:
      'Everything is on the record and the record matters — an undocumented decision effectively did not happen. ' +
      'Procurement, legal and accessibility are hard constraints, not preferences. Moving fast is itself suspect. ' +
      'The people affected by a decision are the public, and someone in the room will say so.',
  },
  {
    match: /\b(non-?profit|charity|ngo|social enterprise|foundation|mission-?driven)\b/i,
    key: 'nonprofit',
    label: 'Non-profit',
    approvalDepth: 2,
    decisionSpeed: 'weeks',
    documentationCulture: 'mixed',
    politicalLoad: 'medium',
    ambiguityTolerance: 'medium',
    worldDirective:
      'Resources are genuinely scarce and everyone knows it, so the argument is about what to stop doing. Funder ' +
      'commitments constrain what can be worked on regardless of what would help most. People are here on conviction, ' +
      'which makes disagreements about priority feel like disagreements about values.',
  },
  {
    match: /\b(research|academic|university|lab|r&d|institute)\b/i,
    key: 'research',
    label: 'Research / R&D',
    approvalDepth: 2,
    decisionSpeed: 'weeks',
    documentationCulture: 'formal',
    politicalLoad: 'medium',
    ambiguityTolerance: 'high',
    worldDirective:
      'Being right matters more than being quick, and a claim without evidence gets taken apart in the meeting. ' +
      'Timelines are genuinely uncertain and saying so is acceptable. Individual ownership of a line of work is strong, ' +
      'so redirecting someone\'s project is a bigger ask than the org chart suggests.',
  },
  {
    match: /\b(sme|small business|family business|mid-?market|smb|boutique)\b/i,
    key: 'sme',
    label: 'SME',
    approvalDepth: 1,
    decisionSpeed: 'days',
    documentationCulture: 'tribal',
    politicalLoad: 'medium',
    ambiguityTolerance: 'medium',
    worldDirective:
      'A handful of long-tenured people hold the whole picture between them, and none of it is written down. ' +
      'One or two founders or owners make the real calls, sometimes reversing them. Everyone does several jobs, so ' +
      '"whose job is this" is a live and slightly touchy question.',
  },
];

/** What an unrecognised company type gets: a workable middle, never nothing. */
const FALLBACK: CompanyPersona = {
  key: 'generic',
  label: 'Established company',
  approvalDepth: 2,
  decisionSpeed: 'days',
  documentationCulture: 'mixed',
  politicalLoad: 'medium',
  ambiguityTolerance: 'medium',
  worldDirective:
    'Some things are documented and some are not, and knowing which is which is part of the job. Most decisions need ' +
    'one other person to agree. People are broadly reasonable but have their own targets, which do not always line up.',
};

export function resolveCompanyPersona(companyType: string | null | undefined): CompanyPersona {
  const text = (companyType ?? '').trim();
  if (!text) return FALLBACK;
  for (const persona of PERSONAS) {
    if (persona.match.test(text)) {
      const { match: _match, ...rest } = persona;
      return rest;
    }
  }
  return FALLBACK;
}

/** Every persona, for tests and for anywhere that needs to enumerate them. */
export function allCompanyPersonas(): CompanyPersona[] {
  return PERSONAS.map(({ match: _match, ...rest }) => rest);
}

/**
 * How many knowledge-base documents should start locked.
 *
 * §8's "everything else stays hidden until discovered" was a flat "mark 2-3 of
 * these locked" in the prompt, identical for every company. But how much is
 * written down IS the company type: at a startup almost nothing is, and the
 * candidate has to go and ask; in government it is all on the record and
 * findable. Same mechanic, genuinely different experience.
 */
export function lockedDocTarget(persona: CompanyPersona, totalDocs: number): number {
  const fraction = persona.documentationCulture === 'tribal' ? 0.5 : persona.documentationCulture === 'mixed' ? 0.3 : 0.15;
  const target = Math.round(totalDocs * fraction);
  // Always at least one to discover, and never so many that the workspace is
  // useless on arrival — a candidate who can read nothing cannot start.
  return Math.max(1, Math.min(target, Math.max(1, totalDocs - 2)));
}

/** The line the world-generation prompt gets, instead of a bare adjective. */
export function personaDirective(persona: CompanyPersona): string {
  return (
    `\n\nHOW THIS COMPANY WORKS (${persona.label}) — build the world so these are true, not so they are mentioned:\n` +
    `${persona.worldDirective}\n` +
    `Decisions need ${persona.approvalDepth === 1 ? 'one person' : persona.approvalDepth === 2 ? 'two people' : 'three or more people'} ` +
    `to agree and land in ${persona.decisionSpeed === 'immediate' ? 'hours' : persona.decisionSpeed}.`
  );
}

/** The line each stakeholder agent gets, so the persona survives into how people actually behave. */
export function personaStakeholderDirective(persona: CompanyPersona): string {
  const approval =
    persona.approvalDepth === 1
      ? 'You can decide things yourself, and you do — quickly, sometimes too quickly.'
      : persona.approvalDepth === 2
        ? 'You need one other person on side before you can commit to anything real. Say whose agreement you need.'
        : 'You cannot commit to anything alone. Name the sign-off, the forum, or the process it has to go through.';

  const politics =
    persona.politicalLoad === 'high'
      ? 'Much of your real reasoning is not said out loud. You raise process, timing or precedent instead of the actual objection.'
      : persona.politicalLoad === 'medium'
        ? 'You are mostly direct, but you will not volunteer the part that reflects badly on your own team.'
        : 'You say what you actually think, including when it is blunt.';

  const docs =
    persona.documentationCulture === 'tribal'
      ? 'If the candidate asks where something is written down, the honest answer is usually that it is not — but you know it.'
      : persona.documentationCulture === 'formal'
        ? 'You point at the document, the process or the owner rather than answering from memory.'
        : 'Some of what they need is documented and some is only in your head; you are not always sure which.';

  return `\nHOW YOU OPERATE HERE (${persona.label}):\n- ${approval}\n- ${politics}\n- ${docs}`;
}
