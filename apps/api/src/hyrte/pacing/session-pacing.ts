/**
 * Founder feedback (WhatsApp, 7 Sep): "Simulation gradually open up hoga naki
 * sara kuch ek saath — speed slow kro thodi, process krne k time nhi milta and
 * bhot sari cheeze pile up hona start hojati h within 5-10 min. Isko thk krna h
 * and exploration k liye atleast 10 min dene h, uske baad speed increase thodi
 * and aese continue krna h."
 *
 * Plus Refinements doc §19 ("Don't make the simulation endless"), which gives
 * the intended shape explicitly:
 *
 *    0–5 min   Orientation
 *    5–15 min  Investigate
 *    15–30 min Perform role task
 *    30–40 min Stakeholder interaction / meeting
 *    40–50 min Unexpected event
 *    50–60 min Final decision + deliverable
 *
 * Before this module, every scheduler in the simulation ran at a flat cadence
 * from the moment it was armed — the world-event queue (offsets 10s–maxOffset),
 * the chaos wave (100s, then every 150s), ambient Slack chatter (40–75s), the
 * orchestrator review (90s) and ignored-message escalations (45–75s) all fired
 * on top of each other with no notion of "how far into the session are we."
 * That is precisely the pile-up that was reported, and there was no exploration
 * window at all.
 *
 * Everything here is pure and deterministic — no timers, no I/O. The callers
 * (HyrteSessionsService, HyrteConsequenceService, HyrteWorkTickService) keep
 * owning their own setTimeout chains and just route their delays through
 * `rampedDelayMs`.
 */

/**
 * Refinements doc §19 — "30–60 minute simulation". Was 15/20/25/30, which made
 * the doc's own six-band structure impossible to express (a 10-minute
 * exploration window does not fit inside a 15-minute session) and is the
 * mechanical reason everything felt compressed.
 */
export const PLANNED_DURATION_MINUTES: Record<string, number> = { EASY: 30, MEDIUM: 40, HARD: 50, EXPERT: 60 };

export type SimulationPhase = 'ORIENTATION' | 'INVESTIGATE' | 'ROLE_TASK' | 'STAKEHOLDER' | 'UNEXPECTED' | 'FINAL';

interface PacingBand {
  phase: SimulationPhase;
  /** Upper bound, as a fraction of the session's planned duration. */
  untilFraction: number;
  /**
   * Multiplier applied to every scheduler's base delay while in this band.
   * >1 = slower/quieter than baseline, <1 = denser. `null` means nothing new
   * arrives at all — used only for ORIENTATION.
   */
  intensity: number | null;
  label: string;
  /** Shown to the candidate so the pacing is legible rather than mysterious. */
  guidance: string;
}

/** Fractions are §19's own minute bands expressed against a 60-minute session, so they scale to any planned duration. */
const BANDS: PacingBand[] = [
  {
    phase: 'ORIENTATION',
    untilFraction: 5 / 60,
    intensity: null,
    label: 'Orientation',
    guidance: 'Get your bearings. Nothing new will arrive yet — read your brief, meet the team, look around.',
  },
  {
    phase: 'INVESTIGATE',
    untilFraction: 15 / 60,
    intensity: 2.2,
    label: 'Investigate',
    guidance: 'Dig into what is actually going on. Things start moving, but slowly.',
  },
  {
    phase: 'ROLE_TASK',
    untilFraction: 30 / 60,
    intensity: 1.4,
    label: 'Do the work',
    guidance: 'Your real tasks are the priority now. The company keeps running around you.',
  },
  {
    phase: 'STAKEHOLDER',
    untilFraction: 40 / 60,
    intensity: 1.0,
    label: 'Align the room',
    guidance: 'Meetings and stakeholders need you. Normal working pace.',
  },
  {
    phase: 'UNEXPECTED',
    untilFraction: 50 / 60,
    intensity: 0.75,
    label: 'Pressure',
    guidance: 'Something is going wrong. Expect competing demands at once.',
  },
  {
    phase: 'FINAL',
    untilFraction: 1,
    intensity: 1.5,
    label: 'Land it',
    guidance: 'Close out your decisions and deliverables. Inbound eases off so you can finish.',
  },
];

export const ORIENTATION_UNTIL_FRACTION = BANDS[0].untilFraction;

/**
 * Floor on the quiet window. §19's band is 5 minutes of a 60-minute session
 * (8.3%), which on a 30-minute EASY session works out to 2.5 minutes — not
 * long enough to actually read a Mission Brief, meet a team and look around,
 * which is the whole point of the band. Four minutes minimum regardless of
 * difficulty.
 */
const MIN_ORIENTATION_MS = 4 * 60_000;

export function orientationEndMs(difficulty: string): number {
  return Math.max(MIN_ORIENTATION_MS, plannedDurationMs(difficulty) * ORIENTATION_UNTIL_FRACTION);
}

/**
 * Where the scheduled world-event queue is allowed to run to. Deliberately
 * short of 100%: the last stretch is for finishing the deliverable, not for
 * fresh demands landing with no time left to act on them (the same reasoning
 * the generator's own EVENT_QUEUE_MAX_OFFSET already used, now expressed once
 * here instead of as four hardcoded per-difficulty seconds values).
 */
export const EVENT_QUEUE_END_FRACTION = 0.85;

export function plannedDurationMs(difficulty: string): number {
  return (PLANNED_DURATION_MINUTES[difficulty] ?? PLANNED_DURATION_MINUTES.MEDIUM) * 60_000;
}

function bandAt(fraction: number): PacingBand {
  return BANDS.find((b) => fraction < b.untilFraction) ?? BANDS[BANDS.length - 1];
}

export function phaseAt(fraction: number): SimulationPhase {
  return bandAt(fraction).phase;
}

export function phaseDescriptorAt(fraction: number): { phase: SimulationPhase; label: string; guidance: string } {
  const { phase, label, guidance } = bandAt(fraction);
  return { phase, label, guidance };
}

/**
 * How far into the session the candidate actually is. Counted from
 * `workspaceUnlockedAt` — the moment they entered the workspace — NOT from
 * `startedAt`, which is when the session row was created and the world started
 * generating. Those were the same clock before this change, which meant the
 * minutes a candidate spent on the Mission Brief and Baseline Challenge were
 * silently counted as working time and every timer armed at generation had
 * already been running for them.
 */
export function elapsedMs(session: { workspaceUnlockedAt?: Date | null; startedAt: Date }, now = Date.now()): number {
  // Null means the candidate has not entered the workspace yet (still
  // generating, or on the Mission Brief / Baseline Challenge). They are zero
  // minutes into the session, not however long the world took to build —
  // falling back to startedAt here reported a session sitting on the Mission
  // Brief as already being in the INVESTIGATE band, which is wrong in the one
  // direction that matters: it would let inbound start arriving early again.
  if (!session.workspaceUnlockedAt) return 0;
  return Math.max(0, now - new Date(session.workspaceUnlockedAt).getTime());
}

export function elapsedFraction(session: { workspaceUnlockedAt?: Date | null; startedAt: Date; difficulty: string }, now = Date.now()): number {
  return Math.min(1, elapsedMs(session, now) / plannedDurationMs(session.difficulty));
}

/**
 * The single knob every scheduler routes through. Takes the delay a mechanic
 * "wants" and returns the delay it should actually use given where the session
 * is right now:
 *
 *  - During ORIENTATION, nothing new is allowed to land, so the delay is
 *    stretched to at least the end of the orientation window. The candidate
 *    gets a genuinely quiet period to look around instead of being buried in
 *    the first two minutes.
 *  - After that, the band's intensity scales the delay — quiet and slow while
 *    investigating, normal while working, deliberately dense during the
 *    pressure band, easing off again at the end. That is the founder's
 *    "speed increase thodi and aese continue krna h", made mechanical.
 */
export function rampedDelayMs(baseMs: number, session: { workspaceUnlockedAt?: Date | null; startedAt: Date; difficulty: string }, now = Date.now()): number {
  const planned = plannedDurationMs(session.difficulty);
  const elapsed = elapsedMs(session, now);
  const quietEnds = orientationEndMs(session.difficulty);

  if (elapsed < quietEnds) {
    // Hold until orientation is over, then apply the NEXT band's intensity to
    // the mechanic's own delay — so the first inbound after orientation is
    // still slow, not an instant burst at the stroke of the window closing.
    const nextIntensity = BANDS[1].intensity ?? 1;
    return Math.round(quietEnds - elapsed + baseMs * nextIntensity);
  }
  const intensity = bandAt(elapsed / planned).intensity ?? 1;
  return Math.round(baseMs * intensity);
}

/**
 * Remaps one generated world-event offset into the real session timeline.
 *
 * The generator produces offsets in seconds meaning "this many seconds after
 * the workspace unlocks". Left alone, a queue whose offsets cluster low lands
 * almost entirely in the first couple of minutes — the pile-up that was
 * reported. This stretches the queue across the window between the end of
 * orientation and EVENT_QUEUE_END_FRACTION of the session.
 *
 * Normalised against the queue's OWN min and max rather than against zero, so
 * the earliest event lands at the start of the window and the latest at the
 * end. Normalising against zero instead left a real dead zone: a live queue
 * with offsets 210/420/630s put its first event 14 minutes in, so the whole
 * investigate band was silent. Relative spacing between events — which the
 * generator does use deliberately — is preserved either way.
 */
/**
 * Where a meeting should actually land in the session.
 *
 * The generator thinks in "startInHours" — a meeting two hours out — which was
 * persisted literally as `Date.now() + hours`. A session runs 30-60 MINUTES, so
 * no generated meeting had ever begun while a candidate was in the workspace:
 * meetings could only be entered by browsing to them, and §5's "when the
 * meeting starts it should come like a call" was unreachable by construction.
 *
 * Meetings are mapped into §19's own stakeholder band (its 30-40 minute slot of
 * a 60-minute session — "Stakeholder interaction / meeting"), spread evenly and
 * ordered by the generator's intended sequence. The first one lands a little
 * before that band so the candidate has met the room before the busiest stretch.
 */
export function meetingStartDelayMs(index: number, total: number, difficulty: string): number {
  const planned = plannedDurationMs(difficulty);
  const windowStart = Math.max(orientationEndMs(difficulty), planned * 0.4);
  const windowEnd = planned * 0.72;
  if (total <= 1) return Math.round(windowStart);
  const step = (windowEnd - windowStart) / (total - 1);
  return Math.round(windowStart + index * step);
}

export function scheduledEventDelayMs(rawOffsetSeconds: number, minRawOffsetSeconds: number, maxRawOffsetSeconds: number, difficulty: string): number {
  const planned = plannedDurationMs(difficulty);
  const windowStart = orientationEndMs(difficulty);
  const windowEnd = Math.max(windowStart, planned * EVENT_QUEUE_END_FRACTION);
  const span = maxRawOffsetSeconds - minRawOffsetSeconds;
  // A single event (or several sharing one offset) has no spread to preserve —
  // put it at the front of the window rather than dividing by zero.
  const position = span > 0 ? Math.min(1, Math.max(0, (rawOffsetSeconds - minRawOffsetSeconds) / span)) : 0;
  return Math.round(windowStart + position * (windowEnd - windowStart));
}
