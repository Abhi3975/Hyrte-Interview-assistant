import {
  EVENT_QUEUE_END_FRACTION,
  PLANNED_DURATION_MINUTES,
  elapsedMs,
  meetingStartDelayMs,
  orientationEndMs,
  phaseAt,
  plannedDurationMs,
  rampedDelayMs,
  scheduledEventDelayMs,
  paceMultiplier,
} from '../src/hyrte/pacing/session-pacing';
import { EVENT_QUEUE_SIZE_BY_DIFFICULTY } from '../src/hyrte/generator/simulation-generator.service';

/**
 * Refinements doc §19 + founder feedback ("simulation gradually open up hoga
 * naki sara kuch ek saath"). These guard the two things that were actually
 * wrong: everything arriving at once, and everything being measured from the
 * wrong clock.
 */

const unlocked = (minutesAgo: number, difficulty = 'MEDIUM') => ({
  workspaceUnlockedAt: new Date(Date.now() - minutesAgo * 60_000),
  startedAt: new Date(Date.now() - (minutesAgo + 30) * 60_000),
  difficulty,
});

describe('the session clock', () => {
  it('counts from workspace unlock, not from when the session row was created', () => {
    // Regression: generation time plus however long the candidate spent on the
    // Mission Brief was being charged to them as working time.
    const s = unlocked(5);
    expect(Math.round(elapsedMs(s) / 60_000)).toBe(5);
  });

  it('treats a session that has not entered the workspace as zero minutes in', () => {
    // Regression: falling back to startedAt reported a session still sitting on
    // the Mission Brief as already in the INVESTIGATE band, which would let
    // inbound start arriving before the candidate ever saw the workspace.
    const notStarted = { workspaceUnlockedAt: null, startedAt: new Date(Date.now() - 40 * 60_000), difficulty: 'MEDIUM' };
    expect(elapsedMs(notStarted)).toBe(0);
    expect(phaseAt(0)).toBe('ORIENTATION');
  });
});

describe('the pacing bands', () => {
  it('runs §19 in order and ends in the wrap-up band', () => {
    expect(phaseAt(0)).toBe('ORIENTATION');
    expect(phaseAt(0.2)).toBe('INVESTIGATE');
    expect(phaseAt(0.4)).toBe('ROLE_TASK');
    expect(phaseAt(0.6)).toBe('STAKEHOLDER');
    expect(phaseAt(0.75)).toBe('UNEXPECTED');
    expect(phaseAt(0.95)).toBe('FINAL');
    expect(phaseAt(1)).toBe('FINAL');
  });

  it('gives every difficulty a session long enough to hold the doc\'s own structure', () => {
    for (const d of Object.keys(PLANNED_DURATION_MINUTES)) {
      expect(PLANNED_DURATION_MINUTES[d]).toBeGreaterThanOrEqual(30);
    }
  });

  it('guarantees a real quiet window even on the shortest session', () => {
    // 5/60 of a 30-minute EASY session is 2.5 minutes — not long enough to read
    // a brief and meet a team, which is what the band is for.
    expect(orientationEndMs('EASY')).toBeGreaterThanOrEqual(4 * 60_000);
    expect(orientationEndMs('EXPERT')).toBeGreaterThanOrEqual(4 * 60_000);
  });
});

describe('the ramp', () => {
  it('holds everything until the quiet window is over', () => {
    const delay = rampedDelayMs(30_000, unlocked(0));
    expect(delay).toBeGreaterThanOrEqual(orientationEndMs('MEDIUM'));
  });

  it('does not dump the held-back burst the instant orientation ends', () => {
    const atEdge = rampedDelayMs(30_000, unlocked(3.9));
    expect(atEdge).toBeGreaterThan(30_000);
  });

  it('speeds up as the session goes on, then eases off so the candidate can finish', () => {
    const investigate = rampedDelayMs(60_000, unlocked(6));
    const roleTask = rampedDelayMs(60_000, unlocked(14));
    const pressure = rampedDelayMs(60_000, unlocked(30));
    const final = rampedDelayMs(60_000, unlocked(37));

    expect(investigate).toBeGreaterThan(roleTask);
    expect(roleTask).toBeGreaterThan(pressure);
    expect(final).toBeGreaterThan(pressure);
  });
});

describe('spreading the event queue', () => {
  const spread = (raws: number[], difficulty = 'MEDIUM') => {
    const lo = Math.min(...raws);
    const hi = Math.max(...raws);
    return raws.map((r) => scheduledEventDelayMs(r, lo, hi, difficulty));
  };

  it('starts the queue at the end of the quiet window, not a third of the way into the session', () => {
    // Regression: normalising against zero rather than the queue's own range
    // put a live 210/420/630s queue's first event 14 minutes in, leaving the
    // whole investigate band silent.
    const [first] = spread([210, 420, 630]);
    expect(first).toBe(orientationEndMs('MEDIUM'));
  });

  it('spreads the whole queue across the session instead of bunching it up front', () => {
    const times = spread([15, 90, 200, 380, 560, 780]);
    expect(times[times.length - 1]).toBe(Math.round(plannedDurationMs('MEDIUM') * EVENT_QUEUE_END_FRACTION));
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1]);
  });

  it('leaves the last stretch of the session clear for wrapping up', () => {
    const last = Math.max(...spread([15, 400, 800]));
    expect(last).toBeLessThan(plannedDurationMs('MEDIUM'));
  });

  it('handles a single event, and several sharing one offset, without dividing by zero', () => {
    expect(scheduledEventDelayMs(300, 300, 300, 'MEDIUM')).toBe(orientationEndMs('MEDIUM'));
    expect(Number.isFinite(scheduledEventDelayMs(0, 0, 0, 'EASY'))).toBe(true);
  });
});

describe('when meetings happen', () => {
  it('puts every meeting inside the session', () => {
    // Regression: meetings were persisted as `now + startInHours`, so every
    // generated meeting sat hours past the end of a 30-60 minute session and
    // none had ever begun while a candidate was in the workspace.
    for (const d of ['EASY', 'MEDIUM', 'EXPERT']) {
      for (let i = 0; i < 3; i++) {
        const at = meetingStartDelayMs(i, 3, d);
        expect(at).toBeGreaterThan(orientationEndMs(d));
        expect(at).toBeLessThan(plannedDurationMs(d));
      }
    }
  });

  it('orders them and never schedules two at the same moment', () => {
    const times = [0, 1, 2].map((i) => meetingStartDelayMs(i, 3, 'MEDIUM'));
    expect(times[0]).toBeLessThan(times[1]);
    expect(times[1]).toBeLessThan(times[2]);
  });

  it('places a lone meeting early enough to actually be attended', () => {
    const only = meetingStartDelayMs(0, 1, 'MEDIUM');
    expect(only).toBeLessThan(plannedDurationMs('MEDIUM') * 0.5);
  });
});

describe('difficulty actually changes how busy it feels', () => {
  // Founder, 30 Sep, after the first pacing fix: "the current one is still too
  // fast — this can be very hard, but easy/mid need to be more realistic."
  //
  // The reason the first fix missed EASY: the intensity bands are identical
  // FRACTIONS of the session at every difficulty, and only total duration
  // changed. EASY packed the same arc into half the time, so it was denser
  // than EXPERT. Difficulty was making the session SHORTER rather than CALMER.
  const LEVELS = ['EASY', 'MEDIUM', 'HARD', 'EXPERT'];

  /** Scheduled arrivals per minute of the window they actually land in. */
  const density = (d: string) => {
    const windowMs = plannedDurationMs(d) * EVENT_QUEUE_END_FRACTION - orientationEndMs(d);
    return EVENT_QUEUE_SIZE_BY_DIFFICULTY[d] / (windowMs / 60_000);
  };

  it('makes each harder level busier than the one below it', () => {
    for (let i = 1; i < LEVELS.length; i++) {
      expect(density(LEVELS[i])).toBeGreaterThan(density(LEVELS[i - 1]));
    }
  });

  it('makes EASY meaningfully calmer than EXPERT, not marginally', () => {
    // The old numbers differed by ~10%, which nobody can feel. A candidate
    // choosing EASY should get a visibly different experience.
    expect(density('EXPERT')).toBeGreaterThan(density('EASY') * 1.4);
  });

  it('leaves more room between reactive events on easier settings', () => {
    // The other half of pace: stakeholder replies, escalations and chaos all
    // route through rampedDelayMs.
    //
    // Compared at the same FRACTION through each session, not the same
    // wall-clock minute. At a fixed minute the difficulties sit in different
    // phase bands — twelve minutes is still INVESTIGATE on HARD but already
    // ROLE_TASK on MEDIUM — so a fixed-minute comparison measures which band
    // each happens to be in, not how the difficulty paces them.
    const atHalfway = (d: string) => {
      const half = plannedDurationMs(d) * 0.4;
      return rampedDelayMs(60_000, { workspaceUnlockedAt: new Date(Date.now() - half), startedAt: new Date(), difficulty: d });
    };
    expect(atHalfway('EASY')).toBeGreaterThan(atHalfway('MEDIUM'));
    expect(atHalfway('MEDIUM')).toBeGreaterThan(atHalfway('HARD'));
    expect(atHalfway('HARD')).toBeGreaterThan(atHalfway('EXPERT'));
  });

  it('treats an unrecognised difficulty as MEDIUM, not as the harshest', () => {
    expect(paceMultiplier('WHATEVER')).toBe(paceMultiplier('MEDIUM'));
  });
});
