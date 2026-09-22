import {
  AWAY_SILENCE_MS,
  FINISHED_SILENCE_MS,
  MAX_INTERJECTIONS,
  RAMBLE_MS,
  RAMBLE_WORDS,
  STUCK_SILENCE_MS,
  THINKING_GRACE_MS,
  classifySilence,
  paceDirective,
  pickMicroReaction,
  profilePace,
  shouldInterject,
  silencePrompt,
} from '@interviewai/conversation';

/**
 * Emotionally-adaptive doc, voice layers 7 / 10 / 11 / 12.
 */

const silence = (msSilent: number, partialTranscript = '', requestedTime = false) =>
  classifySilence({ msSilent, partialTranscript, requestedTime });

describe('what a pause means', () => {
  it('does not cut off someone who is audibly mid-sentence', () => {
    // The bug this layer exists to fix: a flat 1.2s timer sent the half
    // sentence and Ally answered a thought the candidate had not finished.
    expect(silence(2_000, 'So the first thing I looked at was the latency, and')).toBe('THINKING');
    expect(silence(2_000, 'I think the right call there was probably')).toBe('THINKING');
    expect(silence(2_000, 'We shipped it in two weeks, but')).toBe('THINKING');
  });

  it('holds through audible hesitation rather than treating it as the end', () => {
    expect(silence(3_000, 'The main constraint was, um')).toBe('THINKING');
    expect(silence(3_000, 'Let me think')).toBe('THINKING');
  });

  it('comes in promptly once a real thought has landed', () => {
    const complete = 'We cut the batch size in half and the queue drained within the hour.';
    expect(silence(FINISHED_SILENCE_MS, complete)).toBe('FINISHED');
    expect(silence(FINISHED_SILENCE_MS - 200, complete)).toBe('THINKING');
  });

  it('does not mistake a few words for a finished answer', () => {
    // "So, the thing is" is a grammatically fine fragment and not an answer.
    expect(silence(2_000, 'So the thing is')).toBe('THINKING');
  });

  it('offers help to someone who never got started', () => {
    expect(silence(2_000, '')).toBe('THINKING');
    expect(silence(STUCK_SILENCE_MS, '')).toBe('STUCK');
  });

  it('eventually calls it stuck even mid-sentence, rather than waiting forever', () => {
    const trailing = 'I suppose the way I would approach that is';
    expect(silence(THINKING_GRACE_MS, trailing)).toBe('THINKING');
    expect(silence(THINKING_GRACE_MS + STUCK_SILENCE_MS, trailing)).toBe('STUCK');
  });

  it('honours an explicit request for time over every other reading', () => {
    // They told us what the silence means; guessing over the top of that is
    // the one thing guaranteed to feel unfair.
    expect(silence(STUCK_SILENCE_MS + 2_000, '', true)).toBe('THINKING');
    expect(silence(FINISHED_SILENCE_MS + 500, 'That was the whole of it.', true)).toBe('THINKING');
  });

  it('checks in when someone has been gone a long time, even having asked for time', () => {
    expect(silence(AWAY_SILENCE_MS, '', true)).toBe('AWAY');
    expect(silence(AWAY_SILENCE_MS, 'and then we')).toBe('AWAY');
  });
});

describe('what Ally says about a pause', () => {
  it('stays silent through a thought instead of filling it', () => {
    expect(silencePrompt('THINKING', 'Tell me about a hard call.')).toBeNull();
    expect(silencePrompt('FINISHED', 'Tell me about a hard call.')).toBeNull();
  });

  it('scaffolds a stuck candidate without answering for them', () => {
    const line = silencePrompt('STUCK', 'Tell me about a hard call.')!;
    expect(line).toMatch(/take your time/i);
    expect(line).toMatch(/goal|constraint/i);
  });

  it('checks in rather than pressing when someone has gone quiet entirely', () => {
    expect(silencePrompt('AWAY', null)).toMatch(/still/i);
  });
});

describe('when Ally comes in uninvited', () => {
  const rambling = {
    wordCount: RAMBLE_WORDS + 50,
    msSpeaking: RAMBLE_MS + 10_000,
    interjectionsSoFar: 0,
    candidateSpeaking: true,
  };

  it('interrupts a genuine ramble, and points them at what is being assessed', () => {
    const out = shouldInterject(rambling)!;
    expect(out).not.toBeNull();
    expect(out.line).toMatch(/decision|outcome/i);
    expect(out.mood).toBe('warm');
  });

  it('never phrases it as a complaint about how much they are talking', () => {
    const out = shouldInterject(rambling)!;
    expect(out.line).not.toMatch(/too (long|much)|rambl|get to the point|wrap up/i);
  });

  it('leaves a long answer alone when it has not been going long', () => {
    // A dense, fast, information-rich answer is a good answer.
    expect(shouldInterject({ ...rambling, msSpeaking: 20_000 })).toBeNull();
  });

  it('leaves a long silence-filled turn alone when little has been said', () => {
    expect(shouldInterject({ ...rambling, wordCount: 40 })).toBeNull();
  });

  it('never interrupts someone who has already stopped talking', () => {
    expect(shouldInterject({ ...rambling, candidateSpeaking: false })).toBeNull();
  });

  it('stops after a couple of interjections rather than talking over them all interview', () => {
    expect(shouldInterject({ ...rambling, interjectionsSoFar: MAX_INTERJECTIONS - 1 })).not.toBeNull();
    expect(shouldInterject({ ...rambling, interjectionsSoFar: MAX_INTERJECTIONS })).toBeNull();
  });
});

describe('reacting to what was actually said', () => {
  const always = () => 0;

  it('never says "Interesting" about a failure', () => {
    // The exact bug: a 30% coin flip over a generic bag produced cheerful
    // noises on top of someone admitting a project died.
    const out = pickMicroReaction('We missed the deadline and the launch got cancelled.', [], always)!;
    expect(out).not.toMatch(/interesting|makes sense/i);
    expect(out).toMatch(/mm|understood/i);
  });

  it('rewards a concrete number, which is the thing interviews most want', () => {
    expect(pickMicroReaction('We cut p99 latency by 40% in about three weeks.', [], always)).toMatch(/number|concrete/i);
  });

  it('meets an admission of fault with thanks rather than a neutral grunt', () => {
    expect(pickMicroReaction('That was my call and it was wrong.', [], always)).toMatch(/straight answer|appreciate/i);
  });

  it('makes "I don\'t know" a safe thing to have said', () => {
    expect(pickMicroReaction("Honestly, I don't know — I'd be guessing.", [], always)).toMatch(/honesty|no problem/i);
  });

  it('mostly stays quiet on an answer that triggered nothing', () => {
    const neverRandom = () => 0.99;
    expect(pickMicroReaction('The system was written in Go.', [], neverRandom)).toBeNull();
  });

  it('says nothing rather than repeat itself', () => {
    const text = 'We cut p99 latency by 40%.';
    const first = pickMicroReaction(text, [], always)!;
    const second = pickMicroReaction(text, [first], always);
    expect(second).not.toBe(first);
    const exhausted = pickMicroReaction(text, ["Good — that's a real number.", 'Okay, concrete. Good.'], always);
    expect(exhausted).toBeNull();
  });

  it('handles an empty turn without producing a reaction to nothing', () => {
    expect(pickMicroReaction('', [], always)).toBeNull();
    expect(pickMicroReaction('   ', [], always)).toBeNull();
  });
});

describe('matching how the candidate speaks', () => {
  const turns = (words: number, n: number) => Array.from({ length: n }, () => 'word '.repeat(words).trim());

  it('speeds up for someone giving clipped answers', () => {
    const profile = profilePace(turns(15, 4));
    expect(profile.pace).toBe('brisk');
    expect(profile.pauseScale).toBeLessThan(1);
    expect(paceDirective(profile)).toMatch(/short|clipped|one or two sentences/i);
  });

  it('gives room to someone who thinks out loud at length', () => {
    const profile = profilePace(turns(150, 4));
    expect(profile.pace).toBe('measured');
    expect(profile.pauseScale).toBeGreaterThan(1);
    expect(paceDirective(profile)).toMatch(/room|unhurried|not rush/i);
  });

  it('stays neutral in the middle, rather than forcing every candidate into a box', () => {
    expect(profilePace(turns(50, 4)).pace).toBe('natural');
  });

  it('will not read a style off a single turn', () => {
    // One terse "Yes" at the start is not a speaking style.
    expect(profilePace(['Yes.']).pace).toBe('natural');
    expect(profilePace([]).pace).toBe('natural');
  });

  it('ignores empty turns rather than letting them drag the average down', () => {
    expect(profilePace([...turns(150, 3), '', '   ']).pace).toBe('measured');
  });
});
