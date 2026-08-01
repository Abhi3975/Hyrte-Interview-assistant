import { isRepetitive, textSimilarity } from '../src/hyrte/interview/repetition-detector';

describe('repetition-detector (§8 anti-gaming)', () => {
  it('scores identical text as fully similar', () => {
    expect(textSimilarity('I prioritized the bug fixes', 'I prioritized the bug fixes')).toBe(1);
  });

  it('scores completely unrelated text as zero similarity', () => {
    expect(textSimilarity('I prioritized the bug fixes', 'The weather is nice today')).toBeLessThan(0.2);
  });

  it('flags a lightly reworded restatement as repetitive', () => {
    const prior = ['I always pull the actual metrics dashboard before committing to a direction.'];
    const current = 'I always pull the actual metrics dashboard before I commit to a direction.';
    expect(isRepetitive(current, prior)).toBe(true);
  });

  it('does not flag a genuinely different answer', () => {
    const prior = ['I always pull the actual metrics dashboard before committing to a direction.'];
    const current = 'Honestly, I should have looped in the CEO earlier since her message overlapped with my decision.';
    expect(isRepetitive(current, prior)).toBe(false);
  });

  it('checks against every prior answer, not just the immediately preceding one', () => {
    const prior = [
      'We focused on stabilizing the core workflow first.',
      'I planned a lightweight feedback form to gather input.',
    ];
    const current = 'We focused on stabilizing the core workflow first and foremost.';
    expect(isRepetitive(current, prior)).toBe(true);
  });
});
