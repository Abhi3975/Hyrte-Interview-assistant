import type { FixtureInboxMessage, FixtureSlackMessage, FixtureCalendarEvent } from '../fixtures/hyrte-fixture.types';

/**
 * Refinements doc §20 — "Controlled Initial Ambiguity: New employees are
 * rarely given step-by-step instructions on their first day... 27 unread
 * emails, 12 Slack conversations... The environment should feel busy—but
 * not overwhelming." The generation pipeline's own 2-3 real inbox/slack
 * items (WORKPLACE_ASSETS_SYSTEM in simulation-generator.service.ts) are
 * each LLM-authored with genuine stakes — nowhere near "busy." Asking the
 * model to author 27 full-fidelity emails in one call would blow up
 * latency/cost and dilute quality (most real inboxes are mostly routine
 * noise, not 27 equally-important crises). Instead: keep the existing
 * narrative items exactly as they are (still the only things that carry
 * real signal/urgency/ethicalDilemma), and pad the REST with cheap,
 * deterministic, template-based filler that reads as clearly lower-stakes —
 * the doc's own "discoverable through contextual clues... rather than
 * explicit instructions" only works if the noise is visibly noise.
 */

const AMBIENT_INBOX_COUNT_BY_DIFFICULTY: Record<string, number> = { EASY: 10, MEDIUM: 16, HARD: 22, EXPERT: 27 };
const AMBIENT_SLACK_COUNT_BY_DIFFICULTY: Record<string, number> = { EASY: 6, MEDIUM: 8, HARD: 10, EXPERT: 12 };

export function ambientInboxTargetCount(difficulty: string): number {
  return AMBIENT_INBOX_COUNT_BY_DIFFICULTY[difficulty] ?? AMBIENT_INBOX_COUNT_BY_DIFFICULTY.MEDIUM;
}
export function ambientSlackTargetCount(difficulty: string): number {
  return AMBIENT_SLACK_COUNT_BY_DIFFICULTY[difficulty] ?? AMBIENT_SLACK_COUNT_BY_DIFFICULTY.MEDIUM;
}

export interface RosterEntry {
  key: string;
  name: string;
  role: string;
  department?: string | null;
}

function inboxTemplates(company: string): { subject: string; body: string }[] {
  return [
    { subject: `${company} Weekly Digest`, body: `A quick roundup of what shipped, what's in progress, and what's coming up across the company this week.` },
    { subject: 'IT: Scheduled maintenance this weekend', body: `Some internal tools will be briefly unavailable during scheduled maintenance this weekend. No action needed.` },
    { subject: 'Reminder: submit your timesheet', body: `Friendly reminder to submit your hours before the end of the week.` },
    { subject: 'Benefits enrollment closes soon', body: `A reminder that the current benefits enrollment window closes soon — no changes needed if you're happy with your current selections.` },
    { subject: 'All-hands recap + slides', body: `Slides and a short recap from this week's all-hands are attached for anyone who missed it.` },
    { subject: `Welcome to ${company}!`, body: `A warm welcome from the People team — let us know if you need anything to get set up.` },
    { subject: 'Office snacks survey', body: `Quick 2-minute survey on what snacks we should stock in the kitchen this month.` },
    { subject: 'Security awareness training due', body: `This is a routine reminder that the annual security awareness training is due by the end of the month.` },
    { subject: 'New expense policy — minor update', body: `A small update to the expense reimbursement policy takes effect next month. Details linked for reference.` },
    { subject: 'Parking/badge access notice', body: `A brief notice about badge access hours over the upcoming long weekend.` },
  ];
}

function personalInboxTemplates(name: string, dept: string): { subject: string; body: string }[] {
  return [
    { subject: `FYI — moved to next sprint`, body: `Hey — just flagging that the item we discussed got bumped to next sprint. Nothing urgent, just keeping you posted.` },
    { subject: `Quick note from ${dept}`, body: `${name} here — nothing pressing, just looping you in on a small update from our side in case it's useful context.` },
    { subject: `Re: earlier thread`, body: `Closing the loop on this — it's handled, no action needed on your end.` },
    { subject: `Doc shared with you`, body: `${name} shared a document with you for reference. Take a look whenever you get a chance, no rush.` },
    { subject: `Calendar hold — tentative`, body: `Sending a tentative hold for later this week, will confirm details once the agenda firms up.` },
  ];
}

function slackTemplates(name: string, dept: string): string[] {
  return [
    `anyone free for lunch today?`,
    `shipped the fix, all green ✅`,
    `heads up, deploying a small config change, should be a no-op`,
    `does anyone have the link to the design doc from last week?`,
    `${dept} standup notes are in the channel topic if anyone missed it`,
    `coffee run in 10 if anyone wants anything`,
    `nothing urgent, just closing out this thread — thanks all`,
    `reminder: office is closed Monday for the holiday`,
    `lol this is a great meme for our retro`,
    `+1, agreed, let's go with that`,
  ];
}

/** Deterministic pseudo-random pick (index-based, not Math.random) so output is reproducible for a given call — no seed plumbing needed since callers just want VARIETY, not literal reproducibility across runs. */
function pick<T>(arr: T[], i: number): T {
  return arr[i % arr.length];
}

/**
 * Live-caught bug: `pick(pool, i)` chose purely by loop index, independent
 * of which sender the item was attributed to. Two of the four
 * personalInboxTemplates entries (and most slackTemplates entries) have no
 * name/dept interpolation at all, so whenever two DIFFERENT senders' index
 * cycles landed on the same template slot, they sent byte-for-byte
 * identical emails/messages — two named people appearing to say the exact
 * same thing at the exact same moment, which reads as obviously fake rather
 * than "real company noise." This scans forward from the natural index for
 * the first template whose rendered (subject+body) text hasn't already gone
 * out to someone else in this same generation batch; only once the whole
 * pool is exhausted does a genuine repeat become unavoidable.
 */
function pickUnused<T extends { subject: string; body: string }>(pool: T[], startIdx: number, used: Set<string>): T {
  for (let offset = 0; offset < pool.length; offset++) {
    const candidate = pool[(startIdx + offset) % pool.length];
    const key = `${candidate.subject}::${candidate.body}`;
    if (!used.has(key)) {
      used.add(key);
      return candidate;
    }
  }
  return pool[startIdx % pool.length];
}

export function generateAmbientInbox(roster: RosterEntry[], companyName: string, count: number): FixtureInboxMessage[] {
  if (count <= 0 || roster.length === 0) return [];
  const companyItems = inboxTemplates(companyName);
  const out: FixtureInboxMessage[] = [];
  const used = new Set<string>();
  for (let i = 0; i < count; i++) {
    // Roughly a third company-wide/admin noise, the rest routine personal FYIs from real roster members.
    const useCompanyWide = i % 3 === 0;
    const sender = pick(roster, i);
    const dept = sender.department ?? sender.role;
    const template = pickUnused(useCompanyWide ? companyItems : personalInboxTemplates(sender.name, dept), i, used);
    out.push({
      fromKey: useCompanyWide ? roster[0].key : sender.key,
      subject: template.subject,
      body: template.body,
      urgent: false,
      ethicalDilemma: false,
    });
  }
  return out;
}

export function generateAmbientSlack(roster: RosterEntry[], count: number): FixtureSlackMessage[] {
  if (count <= 0 || roster.length === 0) return [];
  const channels = ['#general', '#product', '#engineering', '#random'];
  const out: FixtureSlackMessage[] = [];
  const used = new Set<string>();
  for (let i = 0; i < count; i++) {
    const sender = pick(roster, i);
    const dept = sender.department ?? sender.role;
    const pool = slackTemplates(sender.name, dept).map((body) => ({ subject: '', body }));
    const { body } = pickUnused(pool, i, used);
    out.push({
      channel: pick(channels, i),
      fromKey: sender.key,
      body,
      ethicalDilemma: false,
    });
  }
  return out;
}

/**
 * Doc §20 — "A meeting starting in 20 minutes." The LLM-generated calendar
 * events (WORKPLACE_ASSETS_SYSTEM) pick startInHours freely with no floor,
 * so nothing guarantees this specific, concrete signal actually shows up.
 * Deterministic guarantee, same discipline as this codebase's other
 * structural guarantees (e.g. distributeHiddenRisks, ensureManager-style
 * derivations) — never left to the model to remember to include.
 */
const UPCOMING_MEETING_MAX_HOURS = 0.5;
const UPCOMING_MEETING_TARGET_HOURS = 0.33;

export function ensureUpcomingMeeting(calendarEvents: FixtureCalendarEvent[]): FixtureCalendarEvent[] {
  if (calendarEvents.length === 0) return calendarEvents;
  if (calendarEvents.some((e) => e.startInHours <= UPCOMING_MEETING_MAX_HOURS)) return calendarEvents;
  const earliestIndex = calendarEvents.reduce((best, e, i) => (e.startInHours < calendarEvents[best].startInHours ? i : best), 0);
  return calendarEvents.map((e, i) => (i === earliestIndex ? { ...e, startInHours: UPCOMING_MEETING_TARGET_HOURS } : e));
}
