import { resolvePolicy, hardStrikeLevelFor } from '../src/proctoring/proctoring.service';
import type { Interview } from '@prisma/client';

function fakeInterview(config: unknown): Interview {
  return { id: 'iv1', config } as unknown as Interview;
}

describe('resolvePolicy (P3 §4/§7 — configurable enforcement policy)', () => {
  it('defaults self-serve practice sessions to WARN (never auto-terminate a demo candidate)', () => {
    expect(resolvePolicy(fakeInterview({ selfServe: true }))).toBe('WARN');
  });

  it('defaults recruiter-created assessments to TERMINATE (unchanged pre-P3 behavior)', () => {
    expect(resolvePolicy(fakeInterview({}))).toBe('TERMINATE');
    expect(resolvePolicy(fakeInterview(null))).toBe('TERMINATE');
    expect(resolvePolicy(null)).toBe('TERMINATE');
  });

  it('an explicit recruiter-configured policy always wins, even for a self-serve session', () => {
    expect(resolvePolicy(fakeInterview({ selfServe: true, proctoringPolicy: 'TERMINATE' }))).toBe('TERMINATE');
    expect(resolvePolicy(fakeInterview({ proctoringPolicy: 'PAUSE' }))).toBe('PAUSE');
    expect(resolvePolicy(fakeInterview({ proctoringPolicy: 'WARN' }))).toBe('WARN');
  });

  it('ignores a malformed proctoringPolicy value rather than trusting it blindly', () => {
    expect(resolvePolicy(fakeInterview({ proctoringPolicy: 'DELETE_EVERYTHING' }))).toBe('TERMINATE');
    expect(resolvePolicy(fakeInterview({ selfServe: true, proctoringPolicy: 123 }))).toBe('WARN');
  });
});

/**
 * AI interviewer checklist — "leaving fullscreen / switching tabs must end
 * a proctored assessment," not slowly nudge the weighted risk curve used for
 * noisy signals like face detection. hardStrikeLevelFor is the deterministic
 * strike math ProctoringService.ingest() applies only to FULLSCREEN_EXIT/
 * TAB_SWITCH (HARD_STRIKE_TYPES), only for non-WARN policies.
 */
describe('hardStrikeLevelFor (lockdown violations — fullscreen exit / tab switch)', () => {
  it('no strikes yet -> no override', () => {
    expect(hardStrikeLevelFor(0, 3)).toBe(0);
  });

  it('1st strike -> a warning (level 1), not yet max', () => {
    expect(hardStrikeLevelFor(1, 3)).toBe(1);
  });

  it('2nd strike -> immediately jumps to MAX_WARNINGS, whatever that is configured as', () => {
    expect(hardStrikeLevelFor(2, 3)).toBe(3);
    expect(hardStrikeLevelFor(2, 5)).toBe(5);
  });

  it('further strikes stay pinned at MAX_WARNINGS, never escalate past it', () => {
    expect(hardStrikeLevelFor(10, 3)).toBe(3);
  });

  it('never returns a negative level for a negative count (defensive)', () => {
    expect(hardStrikeLevelFor(-1, 3)).toBe(0);
  });
});
