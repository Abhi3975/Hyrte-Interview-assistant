import { addressingRule, stripSelfAddress } from '../src/hyrte/agents/addressing';

/**
 * Founder feedback, 30 Sep 2026. Four items; these cover the two with logic
 * behind them. Pacing has its own tests in session-pacing.spec.ts.
 */

describe('team members addressing themselves instead of each other', () => {
  // "John wants to ask Lisa about something but he (John) says 'Hey John, I
  // need you to do this'. Then Lisa responds to John."
  //
  // Cause: every prompt that generates person-to-person text says "You are
  // <name>" and "write in your own voice", and never says who is being
  // written TO. The sender is the only name in the prompt, so it is the name
  // the greeting reaches for. Same bug as the escalation email that opened
  // "Alice, this is now critical" — sent by Alice.

  it('names the recipient, and forbids the sender by name', () => {
    const rule = addressingRule('Lisa Chen', 'John Park');
    expect(rule).toContain('Lisa Chen');
    expect(rule).toMatch(/never "John Park"/);
    // Naming the trap is what stops it — "address the recipient" alone leaves
    // the sender's name as the only one in context.
    expect(rule).toMatch(/greeting yourself/i);
  });

  it('strips a greeting the sender aimed at themselves', () => {
    expect(stripSelfAddress('Hey John, I need this by Friday.', 'John Park')).toBe('I need this by Friday.');
    expect(stripSelfAddress('John — can you take this one?', 'John Park')).toBe('Can you take this one?');
    expect(stripSelfAddress('Hi John: quick one for you.', 'John Park')).toBe('Quick one for you.');
  });

  it('leaves a correctly addressed message completely alone', () => {
    const correct = 'Hey Lisa, I need this by Friday.';
    expect(stripSelfAddress(correct, 'John Park')).toBe(correct);
  });

  it('does not touch the sender\'s name used legitimately mid-sentence', () => {
    // "as John said earlier" is fine — only a self-greeting at the very start
    // is the bug, and over-stripping would mangle real sentences.
    const fine = 'Lisa, as John mentioned earlier, this needs the security review first.';
    expect(stripSelfAddress(fine, 'John Park')).toBe(fine);
  });

  it('survives odd names without throwing or over-matching', () => {
    expect(stripSelfAddress('Hey, here is the update.', 'Jo')).toBe('Hey, here is the update.');
    expect(stripSelfAddress('', 'John Park')).toBe('');
    // A one-character or empty name is not a safe pattern to strip on.
    const text = 'A, this is the thing.';
    expect(stripSelfAddress(text, 'A')).toBe(text);
  });

  it('re-capitalises what is left so the message still reads properly', () => {
    expect(stripSelfAddress('Hey John, the deploy is green.', 'John Park')).toBe('The deploy is green.');
  });
});
