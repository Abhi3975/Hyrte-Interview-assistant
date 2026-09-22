import { getVisibleStateKeys } from '../dig/info-scope.util';

/**
 * Refinements doc §6 — "Meetings should react to what the candidate says":
 *
 *   Candidate: "Yeah, engineering can probably handle it."
 *   Engineering Lead: "That's not what I told you this morning. We're already
 *                      at 92% capacity."
 *
 *   "The system should challenge them… The AI shouldn't simply be agreeable.
 *    Introduce a 'Reality Layer' — every NPC has: Knowledge, Memory, Goals,
 *    Incentives, Personality, Authority, Information they don't know,
 *    Information they may intentionally withhold."
 *
 * Every one of those already existed on HyrteStakeholder — kpis, currentTasks,
 * personality, authorityLevel, stress/urgency/patience, privateKnowledge,
 * hiddenIntention, plus role-scoped visibility of company state. The meeting
 * prompt simply never read any of it: it passed `{key, name, role}` and nothing
 * else, which is exactly why meetings read as "another chatbot conversation"
 * rather than a room of people with their own stakes.
 *
 * This module builds the prompt-side view. Nothing here is ever returned to the
 * candidate — `hiddenIntention` and `privateKnowledge` are prompt-only, the
 * same treatment they get in stakeholder-agent.service.ts.
 */

export interface MeetingAttendee {
  id: string;
  name: string;
  role: string;
  department: string | null;
  authorityLevel: number | null;
  kpis: string[];
  currentTasks: string[];
  personality: unknown;
  hiddenIntention: string | null;
  privateKnowledge: string[];
  stress: number;
  urgency: number;
  patience: number;
  trust: number;
  respect: number;
}

/** What this person said to the candidate BEFORE the meeting — the doc's "that's not what I told you this morning." */
export interface PriorStatement {
  speaker: string;
  at: Date;
  body: string;
}

function omitMeta(state: Record<string, unknown>): Record<string, unknown> {
  const { sessionId: _s, updatedAt: _u, ...rest } = state;
  return rest;
}

function authorityDescriptor(level: number | null): string {
  const n = level ?? 50;
  if (n >= 80) return 'you outrank everyone else in this room and can end a debate by deciding';
  if (n >= 60) return 'you are senior here and can push back hard without needing permission';
  if (n >= 40) return 'you are a peer in this room — you argue your corner, you do not decide alone';
  return 'you are junior in this room — you raise concerns, you do not overrule anyone';
}

/** One attendee's full Reality Layer, as the meeting prompt sees it. */
export function buildAttendeeCard(a: MeetingAttendee, companyState: Record<string, unknown> | null): string {
  const visibleKeys = getVisibleStateKeys(a.role);
  const scoped = companyState
    ? Object.fromEntries(Object.entries(omitMeta(companyState)).filter(([k]) => visibleKeys.includes(k as never)))
    : {};

  const parts = [
    `${a.name} — ${a.role}${a.department ? `, ${a.department}` : ''} (key: ${a.id})`,
    `  Authority: ${authorityDescriptor(a.authorityLevel)}.`,
    a.kpis.length ? `  Measured on: ${a.kpis.join('; ')}. You argue for what protects these.` : '',
    a.currentTasks.length ? `  Currently working on: ${a.currentTasks.join('; ')}.` : '',
    `  Personality/goals: ${JSON.stringify(a.personality ?? {})}.`,
    `  State right now (0-100): stress ${a.stress}, urgency ${a.urgency}, patience ${a.patience}. ` +
      `How you feel about the candidate: trust ${a.trust}, respect ${a.respect}. Let this colour how ` +
      `bluntly you push back — a stressed, low-trust person does not soften things.`,
    `  What you can see of company state from your seat: ${JSON.stringify(scoped)}. If asked about a number ` +
      `outside this, say you would need to check rather than inventing one.`,
    a.privateKnowledge.length
      ? `  THINGS ONLY YOU KNOW (never volunteer unprompted; use them if the discussion walks directly into them, ` +
        `or if someone claims something they contradict): ${a.privateKnowledge.join(' | ')}.`
      : '',
    a.hiddenIntention
      ? `  PRIVATE MOTIVE (never state outright — it shapes what you push for and what you quietly leave out): ${a.hiddenIntention}.`
      : '',
  ];
  return parts.filter(Boolean).join('\n');
}

/**
 * §6's three named behaviours, as explicit instruction. Deliberately phrased as
 * "only when it is genuinely true" — an NPC that challenges everything is as
 * unrealistic as one that agrees with everything, and the failure mode for a
 * hiring assessment is manufacturing a contradiction that was not there.
 */
export function buildRealityLayerDirective(hasPriorStatements: boolean, hasCandidateRecord: boolean): string {
  return (
    '\n\nHOW PEOPLE IN THIS ROOM BEHAVE (Reality Layer — this is what makes it a meeting rather than a chatbot):\n' +
    '- Do NOT default to agreeable. These people have their own targets, their own workload, and their own read ' +
    'of the situation, and they disagree with each other as readily as with the candidate.\n' +
    (hasPriorStatements
      ? '- If the candidate asserts something that contradicts what one of these people ACTUALLY TOLD THEM earlier ' +
        '(see "what was said before this meeting" below), that person calls it out directly and specifically — ' +
        'quoting the substance of what they really said. Only when the contradiction is real; never invent one.\n'
      : '') +
    (hasCandidateRecord
      ? '- If the candidate contradicts a position they themselves took earlier in this session, whoever it affects ' +
        'most asks about it plainly ("Earlier you said X — has that changed?"). Again, only if genuinely inconsistent.\n'
      : '') +
    '- If the candidate is vague, hand-waves, or volunteers something confidently outside what they could actually ' +
    'know, the person whose area it touches presses for specifics rather than accepting it.\n' +
    '- If the candidate goes off-topic, the most senior person in the room pulls it back to the agenda and says ' +
    'what time is left — they do not follow the tangent.\n' +
    '- Nobody in this room can read the others\' private knowledge or motives. Speak only from what YOUR character knows.'
  );
}

/** Formats the pre-meeting statement record for the prompt — §6's "that's not what I told you this morning." */
export function formatPriorStatements(statements: PriorStatement[]): string {
  if (statements.length === 0) return '';
  const lines = statements.map((s) => {
    const time = s.at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    return `  ${s.speaker} — ${time}: "${s.body.replace(/\s+/g, ' ').trim().slice(0, 240)}"`;
  });
  return `\n\nWHAT WAS SAID BEFORE THIS MEETING (these are on the record — the people who said them remember them):\n${lines.join('\n')}`;
}

/** Formats the candidate's own on-record positions this session, for consistency-checking. */
export function formatCandidateRecord(entries: string[]): string {
  if (entries.length === 0) return '';
  return (
    `\n\nWHAT THE CANDIDATE HAS ALREADY DONE OR COMMITTED TO THIS SESSION (they are accountable for these):\n` +
    entries.map((e) => `  - ${e}`).join('\n')
  );
}
