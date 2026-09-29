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
