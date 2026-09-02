import {
  ambientInboxTargetCount,
  ambientSlackTargetCount,
  ensureUpcomingMeeting,
  generateAmbientInbox,
  generateAmbientSlack,
  RosterEntry,
} from '../src/hyrte/generator/ambient-noise';
import type { FixtureCalendarEvent } from '../src/hyrte/fixtures/hyrte-fixture.types';

const ROSTER: RosterEntry[] = [
  { key: 'a', name: 'Jane', role: 'Engineering Lead', department: 'Engineering' },
  { key: 'b', name: 'Priya', role: 'Sales Rep', department: 'Sales' },
];

describe('ambient inbox/slack targets scale with difficulty (refinements doc §20)', () => {
  it('EXPERT matches the doc\'s own literal numbers — 27 emails, 12 Slack conversations', () => {
    expect(ambientInboxTargetCount('EXPERT')).toBe(27);
    expect(ambientSlackTargetCount('EXPERT')).toBe(12);
  });

  it('scales up monotonically from EASY to EXPERT', () => {
    const inboxCounts = ['EASY', 'MEDIUM', 'HARD', 'EXPERT'].map(ambientInboxTargetCount);
    expect(inboxCounts).toEqual([...inboxCounts].sort((a, b) => a - b));
    const slackCounts = ['EASY', 'MEDIUM', 'HARD', 'EXPERT'].map(ambientSlackTargetCount);
    expect(slackCounts).toEqual([...slackCounts].sort((a, b) => a - b));
  });

  it('unknown difficulty falls back to MEDIUM, never throws or returns 0', () => {
    expect(ambientInboxTargetCount('NOT_A_REAL_DIFFICULTY')).toBe(ambientInboxTargetCount('MEDIUM'));
  });
});

describe('generateAmbientInbox / generateAmbientSlack', () => {
  it('produces exactly the requested count, never more, never fewer', () => {
    expect(generateAmbientInbox(ROSTER, 'Acme', 24)).toHaveLength(24);
    expect(generateAmbientSlack(ROSTER, 9)).toHaveLength(9);
  });

  it('every generated item is low-stakes — never urgent, never an ethical dilemma', () => {
    const inbox = generateAmbientInbox(ROSTER, 'Acme', 20);
    expect(inbox.every((m) => m.urgent === false && m.ethicalDilemma === false)).toBe(true);
    const slack = generateAmbientSlack(ROSTER, 10);
    expect(slack.every((m) => m.ethicalDilemma === false)).toBe(true);
  });

  it('every fromKey resolves to a real roster member — no orphan references', () => {
    const inbox = generateAmbientInbox(ROSTER, 'Acme', 15);
    const validKeys = new Set(ROSTER.map((r) => r.key));
    expect(inbox.every((m) => validKeys.has(m.fromKey))).toBe(true);
    const slack = generateAmbientSlack(ROSTER, 8);
    expect(slack.every((m) => validKeys.has(m.fromKey))).toBe(true);
  });

  it('is a safe no-op with zero count or an empty roster — never throws', () => {
    expect(generateAmbientInbox(ROSTER, 'Acme', 0)).toEqual([]);
    expect(generateAmbientInbox([], 'Acme', 10)).toEqual([]);
    expect(generateAmbientSlack(ROSTER, 0)).toEqual([]);
    expect(generateAmbientSlack([], 10)).toEqual([]);
  });

  it('varies content across a large batch rather than repeating one line 27 times', () => {
    const inbox = generateAmbientInbox(ROSTER, 'Acme', 20);
    const distinctSubjects = new Set(inbox.map((m) => m.subject));
    expect(distinctSubjects.size).toBeGreaterThan(3);
  });

  // Live-caught bug: two DIFFERENT roster members could end up with
  // byte-for-byte identical filler text (e.g. Mark Johnson and Julia Lee
  // both sending "Hey — just flagging that the item we discussed got
  // bumped to next sprint...", verbatim, in the same session) — the naive
  // index-based template pick had no idea two different people had already
  // "said" the same static line. Two different named people appearing to
  // send the exact same email at the exact same moment reads as obviously
  // fake, not "a real company's routine noise."
  it('never sends two DIFFERENT senders byte-identical filler text in one batch', () => {
    const roster: RosterEntry[] = [
      { key: 'a', name: 'Mark Johnson', role: 'Product Owner', department: 'Product' },
      { key: 'b', name: 'Julia Lee', role: 'Operations Manager', department: 'Operations' },
      { key: 'c', name: 'Aaron Smith', role: 'Senior Product Designer', department: 'Product' },
      { key: 'd', name: 'Laura Garcia', role: 'Engineering Team Lead', department: 'Engineering' },
      { key: 'e', name: 'Sam Patel', role: 'Sales Lead', department: 'Sales' },
    ];
    const seenTextToSender = new Map<string, string>();
    const inbox = generateAmbientInbox(roster, 'CatalystFlow', 16);
    for (const m of inbox) {
      const key = `${m.subject}::${m.body}`;
      const priorSender = seenTextToSender.get(key);
      expect(priorSender === undefined || priorSender === m.fromKey).toBe(true);
      seenTextToSender.set(key, m.fromKey);
    }
    const seenSlackToSender = new Map<string, string>();
    const slack = generateAmbientSlack(roster, 10);
    for (const m of slack) {
      const priorSender = seenSlackToSender.get(m.body);
      expect(priorSender === undefined || priorSender === m.fromKey).toBe(true);
      seenSlackToSender.set(m.body, m.fromKey);
    }
  });
});

describe('ensureUpcomingMeeting (refinements doc §20 — "a meeting starting in 20 minutes")', () => {
  function event(startInHours: number): FixtureCalendarEvent {
    return { title: 'Sync', startInHours, durationMins: 30 };
  }

  it('leaves the list untouched when a meeting already starts within 30 minutes', () => {
    const events = [event(2), event(0.25), event(5)];
    expect(ensureUpcomingMeeting(events)).toEqual(events);
  });

  it('pulls the earliest meeting in to ~20 minutes when nothing starts soon', () => {
    const events = [event(4), event(1), event(6)];
    const result = ensureUpcomingMeeting(events);
    expect(result.some((e) => e.startInHours <= 0.5)).toBe(true);
    // The originally-earliest event (index 1, startInHours: 1) is the one pulled forward.
    expect(result[1].startInHours).toBeLessThanOrEqual(0.5);
    expect(result[0].startInHours).toBe(4);
    expect(result[2].startInHours).toBe(6);
  });

  it('is a safe no-op on an empty calendar', () => {
    expect(ensureUpcomingMeeting([])).toEqual([]);
  });
});
