import { resolvePolicy } from '../src/proctoring/proctoring.service';
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
