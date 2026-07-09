import { LicenseValidator } from '../src/questions/aggregator/license-validator';

describe('LicenseValidator', () => {
  const v = new LicenseValidator();

  it('accepts permissive licenses', () => {
    for (const raw of ['MIT', 'apache-2.0', 'bsd-3-clause', 'cc0']) {
      expect(v.validate({ rawLicense: raw }).allowed).toBe(true);
    }
  });

  it('rejects unknown / missing licenses by default', () => {
    expect(v.validate({ rawLicense: 'GPL-3.0' }).allowed).toBe(false);
    expect(v.validate({}).allowed).toBe(false);
  });

  it('hard-blocks known proprietary hosts regardless of claimed license', () => {
    const decision = v.validate({ rawLicense: 'MIT', sourceUrl: 'https://leetcode.com/problems/x' });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/denylist/i);
  });

  it('requires attribution for CC-BY', () => {
    const without = v.validate({ rawLicense: 'cc-by-4.0' });
    expect(without.allowed).toBe(false);
    expect(without.requiresAttribution).toBe(true);

    const withAttr = v.validate({ rawLicense: 'cc-by-4.0', attribution: 'Author (CC-BY-4.0)' });
    expect(withAttr.allowed).toBe(true);
  });

  it('blocks the named proprietary sources from the policy', () => {
    for (const host of ['interviewbit.com', 'geeksforgeeks.org', 'hackerrank.com', 'udemy.com']) {
      expect(v.validate({ rawLicense: 'MIT', sourceUrl: `https://${host}/x` }).allowed).toBe(false);
    }
  });
});
