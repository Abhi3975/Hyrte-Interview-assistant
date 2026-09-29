import { hardStrikeLevelFor, resolvePolicy } from '../src/proctoring/proctoring.service';
import { MAX_WARNINGS } from '../src/proctoring/risk-weights';

/**
 * "I want it completely proctored mode."
 *
 * The honest boundary first, because it is easy to mistake for a missing
 * feature: no web page can see, count, or close the browser's other tabs.
 * There is no API for it in any browser, deliberately. What IS enforceable is
 * the moment the candidate leaves — fullscreen exit and tab blur are both
 * detectable instantly — and STRICT ends the session right there.
 *
 * The reason none of this appeared to work: self-serve sessions default to
 * WARN, and WARN is exempt from hard strikes entirely.
 */

const cfg = (config: Record<string, unknown> | null) => ({ config } as never);

describe('which sessions are actually enforced', () => {
  it('explains the silence — self-serve defaulted to WARN, which is strike-exempt', () => {
    expect(resolvePolicy(cfg({ selfServe: true }))).toBe('WARN');
  });

  it('enforces a real recruiter assessment by default', () => {
    expect(resolvePolicy(cfg({ selfServe: false }))).toBe('TERMINATE');
    expect(resolvePolicy(cfg(null))).toBe('TERMINATE');
    expect(resolvePolicy(null)).toBe('TERMINATE');
  });

  it('lets a self-serve candidate opt into being properly proctored', () => {
    // The explicit policy beats the selfServe default, so asking for STRICT
    // is not quietly downgraded to WARN.
    expect(resolvePolicy(cfg({ selfServe: true, proctoringPolicy: 'STRICT' }))).toBe('STRICT');
  });
});

describe('what STRICT actually costs you', () => {
  it('ends the interview the FIRST time they leave — no warning shot', () => {
    expect(hardStrikeLevelFor(1, MAX_WARNINGS, true)).toBe(MAX_WARNINGS);
  });

  it('still gives one warning under the normal policy', () => {
    expect(hardStrikeLevelFor(1, MAX_WARNINGS, false)).toBe(1);
    expect(hardStrikeLevelFor(2, MAX_WARNINGS, false)).toBe(MAX_WARNINGS);
  });

  it('does nothing at all when nothing happened', () => {
    expect(hardStrikeLevelFor(0, MAX_WARNINGS, true)).toBe(0);
    expect(hardStrikeLevelFor(0, MAX_WARNINGS, false)).toBe(0);
  });

  it('defaults to the forgiving behaviour when strictness is not passed', () => {
    // Every existing caller predates the flag; none of them should suddenly
    // start terminating on a first offence.
    expect(hardStrikeLevelFor(1, MAX_WARNINGS)).toBe(1);
  });
});

describe('one candidate\'s strictness must not reach another candidate', () => {
  // Caught live, before it reached anyone: the self-serve Interview row is
  // looked up by organizationId + title + category + difficulty and REUSED
  // across candidates. Storing the policy on it meant the first person to
  // enable strict mode silently made everyone else's interviews strict too —
  // terminating their session on a first tab switch they never agreed to.
  // Verified on production: a session created WITHOUT the flag came back
  // STRICT and terminated. The policy belongs on the session.

  it('ignores a shared interview row when the session did not opt in', () => {
    const sharedRow = cfg({ selfServe: true });
    expect(resolvePolicy(sharedRow, false)).toBe('WARN');
  });

  it('applies strictness only to the session that asked for it', () => {
    const sharedRow = cfg({ selfServe: true });
    expect(resolvePolicy(sharedRow, true)).toBe('STRICT');
    expect(resolvePolicy(sharedRow, false)).toBe('WARN');
  });

  it('lets a session opt in even where the interview says otherwise', () => {
    expect(resolvePolicy(cfg({ proctoringPolicy: 'WARN' }), true)).toBe('STRICT');
  });

  it('defaults to not-strict when the flag is absent entirely', () => {
    // Every caller that predates the flag must keep its old behaviour.
    expect(resolvePolicy(cfg({ selfServe: true }))).toBe('WARN');
    expect(resolvePolicy(cfg({ selfServe: false }))).toBe('TERMINATE');
  });
});

describe('strict is the default now, not the opt-in', () => {
  // It shipped opt-in, and opt-in meant the room only LOOKED proctored: an
  // unticked box fell back to WARN, which is exempt from hard strikes, so
  // switching tabs did nothing at all. A candidate who believes they are
  // being watched and is not has been misled — worse than an openly relaxed
  // interview. These pin the layer where the default lives.

  it('leaves resolvePolicy itself unchanged — it reports what the session says', () => {
    // The default belongs at session creation, not in this pure function.
    // Keeping it honest here is what lets a relaxed session stay relaxed.
    expect(resolvePolicy(cfg({ selfServe: true }), false)).toBe('WARN');
    expect(resolvePolicy(cfg({ selfServe: true }), true)).toBe('STRICT');
  });

  it('still lets a candidate deliberately relax it', () => {
    // `strictProctoring: false` is an explicit choice and must survive — the
    // practice case is real, and silently overriding it would be its own lie.
    expect(resolvePolicy(cfg({ selfServe: true }), false)).toBe('WARN');
  });
});
