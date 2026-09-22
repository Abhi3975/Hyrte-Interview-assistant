/**
 * The emotionally-adaptive doc's remaining voice layers — 7, 10, 11 and 12.
 *
 * What the room already does well: the candidate can cut Ally off mid-sentence
 * (barge-in), and Ally's delivery carries one of four moods chosen in context.
 * What it did not do is the other half of a real conversation — noticing what a
 * SILENCE means, knowing when to come in, and reacting to what was actually
 * said rather than on a timer.
 *
 * All four are deterministic here, and that is the point rather than a
 * shortcut. Asking a model "is this pause thinking or stuck?" costs a network
 * round-trip in the one place a conversation cannot afford one: the pause
 * itself. These read the partial transcript that already exists on the client
 * and decide in microseconds.
 */

// ── Layer 10: what a silence means ──────────────────────────────────────────

export type SilenceKind =
  /** Mid-thought. Hold the line — auto-sending here truncates their answer. */
  | 'THINKING'
  /** A complete thought, landed. Send it and let Ally reply. */
  | 'FINISHED'
  /** They started and ran out of road, or never started. Offer a scaffold. */
  | 'STUCK'
  /** Long enough that something is probably wrong. Check they are still there. */
  | 'AWAY';

/** A finished clause needs only a beat before Ally comes in. */
export const FINISHED_SILENCE_MS = 1_200;
/** Someone audibly mid-sentence gets this much more room before we call it. */
export const THINKING_GRACE_MS = 5_000;
/** Silence this long with nothing useful said is a candidate who is stuck. */
export const STUCK_SILENCE_MS = 7_000;
/** Beyond this, ask whether they are still there rather than keep waiting. */
export const AWAY_SILENCE_MS = 25_000;
/** Below this many words, a pause is someone starting — not someone finishing. */
const MIN_WORDS_FOR_FINISHED = 4;
/**
 * A thought with no terminal punctuation is weaker evidence of being finished,
 * so it gets held longer before we act on it. Recognisers vary in whether they
 * punctuate a partial at all, and requiring punctuation outright would mean an
 * unpunctuated stream never finishes a turn.
 */
export const UNPUNCTUATED_SETTLE_MS = 2_200;

/** A landed sentence. Strong evidence, acted on at the short threshold. */
const ENDS_COMPLETE = /[.!?]["')\]]?\s*$/;

/**
 * Words that mean "I have not finished". Someone who stops after "because" is
 * composing, not done, and the old flat 1.2s timer sent their half-sentence.
 *
 * Mostly function words and copulas — the parts of speech that cannot end an
 * English sentence. "So the thing is" is grammatical and is not an answer.
 */
const TRAILING_INCOMPLETE =
  /\b(and|but|so|because|which|that|if|when|the|a|an|to|of|for|with|like|maybe|perhaps|probably|is|was|are|were|am|be|been|being|will|would|could|should|can|might|must|have|has|had|do|does|did|in|on|at|from|about|into|through|than|then|as|by|or|nor|yet|my|our|your|their|his|her|its|this|these|those|some|any|all|more|most|very|really|just|also|um+|uh+|er+|hmm+|well|i mean|you know|sort of|kind of)\s*$/i;

/** Audible thinking. Distinct from the above: these are noises, not grammar. */
const HESITATION_MARKER = /\b(um+|uh+|er+|hmm+|let me think|give me a second|one sec|hold on)\b/i;

export interface SilenceSignals {
  /** How long they have been quiet. */
  msSilent: number;
  /** What the recogniser has heard from them so far this turn. */
  partialTranscript: string;
  /** The candidate pressed "give me a second" — an explicit request for room. */
  requestedTime: boolean;
}

/**
 * Classify a pause from signals the client already has. Pure and instant.
 */
export function classifySilence({ msSilent, partialTranscript, requestedTime }: SilenceSignals): SilenceKind {
  const text = partialTranscript.trim();
  const words = text ? text.split(/\s+/).length : 0;

  // An explicit request for time outranks everything short of going missing —
  // the candidate told us what this silence means, so stop guessing.
  if (requestedTime) return msSilent >= AWAY_SILENCE_MS ? 'AWAY' : 'THINKING';

  if (msSilent >= AWAY_SILENCE_MS) return 'AWAY';

  // Nothing said at all: this is not a pause in an answer, it is an answer
  // that has not started. Give them a real beat, then offer help.
  if (words === 0) return msSilent >= STUCK_SILENCE_MS ? 'STUCK' : 'THINKING';

  const soundsIncomplete = TRAILING_INCOMPLETE.test(text) || HESITATION_MARKER.test(text.slice(-30));

  if (soundsIncomplete) {
    // They are mid-sentence. Hold well past the normal beat; only call it
    // stuck once the grace period is genuinely spent.
    return msSilent >= THINKING_GRACE_MS + STUCK_SILENCE_MS ? 'STUCK' : 'THINKING';
  }

  // A complete-sounding clause, but only a few words of it — "Right, so yeah"
  // parses fine and is not an answer.
  if (words < MIN_WORDS_FOR_FINISHED) {
    return msSilent >= STUCK_SILENCE_MS ? 'STUCK' : 'THINKING';
  }

  // Weigh the wait by how much evidence there is that they actually stopped.
  const settleMs = ENDS_COMPLETE.test(text) ? FINISHED_SILENCE_MS : UNPUNCTUATED_SETTLE_MS;
  if (msSilent >= settleMs) return 'FINISHED';
  return 'THINKING';
}

/** The line Ally says for a silence that needs one. Null when the right move is to stay quiet. */
export function silencePrompt(kind: SilenceKind, questionAsked: string | null): string | null {
  switch (kind) {
    case 'STUCK':
      // Scaffolding, not rescue — the doc is explicit that this helps them
      // show their best thinking rather than lowering the bar.
      return questionAsked
        ? "Take your time. If it helps, try it in three parts — what's the goal, what's the constraint, and what you'd do first."
        : 'Take your time — no rush at all.';
    case 'AWAY':
      return 'Still with me?';
    default:
      // THINKING and FINISHED are handled by waiting and by sending. Saying
      // something here would be interrupting a thought.
      return null;
  }
}

// ── Layer 11: when Ally comes in uninvited ──────────────────────────────────

/** Nobody is rambling before this. Interrupting earlier is rude, not attentive. */
export const RAMBLE_WORDS = 220;
/** ...and it has to have been going on a while, not just be a dense answer. */
export const RAMBLE_MS = 75_000;
/** Never twice in a row, and never more than this across one interview. */
export const MAX_INTERJECTIONS = 2;

export interface InterjectionSignals {
  /** Words in the current, still-running answer. */
  wordCount: number;
  /** How long this single answer has been going. */
  msSpeaking: number;
  /** How many times Ally has already come in uninvited this session. */
  interjectionsSoFar: number;
  /** True while the candidate is audibly still speaking. */
  candidateSpeaking: boolean;
}

export interface Interjection {
  line: string;
  /** Delivered warmly — coming in on someone is already forceful enough. */
  mood: 'warm';
}

/**
 * Should Ally come in over the candidate?
 *
 * A real interviewer does this — and does it rarely. The bar is deliberately
 * high on both length AND duration, because a long answer that is going
 * somewhere is a good answer, and cutting it off reads as impatience. Capped
 * per session so a verbose candidate is not talked over all interview.
 */
export function shouldInterject(signals: InterjectionSignals): Interjection | null {
  if (!signals.candidateSpeaking) return null;
  if (signals.interjectionsSoFar >= MAX_INTERJECTIONS) return null;
  if (signals.wordCount < RAMBLE_WORDS || signals.msSpeaking < RAMBLE_MS) return null;

  // Phrased as redirecting toward what is being assessed, never as "you are
  // talking too much" — the candidate should come out of this pointed at the
  // answer that scores, not embarrassed.
  const line =
    signals.interjectionsSoFar === 0
      ? "Sorry to jump in — that's useful context. Can you take me to the specific decision you made and why?"
      : "Let me pause you there — what was the outcome, concretely?";

  return { line, mood: 'warm' };
}

// ── Layer 12: reacting to what was actually said ────────────────────────────

/**
 * Micro-reactions were a 30% coin flip over a bag of seven acknowledgements,
 * which produces "Interesting." after a candidate says they missed the
 * deadline. A reaction that does not track the content is worse than none —
 * it is the tell that nobody is listening.
 *
 * Each rule below fires on something specific in what they just said.
 */
const REACTION_RULES: { test: RegExp; reactions: string[] }[] = [
  {
    // A real number is the thing interviewers most want and least often get.
    // The unit alternation handles "%" separately from the worded units: "40%"
    // ends on a non-word character, so a trailing \b after it can never match.
    test: /\b\d+(?:\.\d+)?\s*(?:%|\b(?:percent|x|k|m|bn|million|billion|users|customers|ms|seconds|minutes|hours|days|weeks|months)\b)/i,
    reactions: ['Good — that\'s a real number.', 'Okay, concrete. Good.'],
  },
  {
    test: /\b(i was wrong|i got it wrong|my mistake|i misjudged|that was my call and it was wrong|i'd do it differently)\b/i,
    reactions: ['That\'s a straight answer — thank you.', 'I appreciate you saying that plainly.'],
  },
  {
    test: /\b(failed|didn't work|fell over|went badly|we lost|missed the deadline|got cancelled|shut it down)\b/i,
    // Never "Interesting." on a failure — acknowledge, then keep them talking.
    reactions: ['Mm. Keep going.', 'Understood.'],
  },
  {
    test: /\b(i don't know|i'm not sure|i've not done that|no experience with that|i'd be guessing)\b/i,
    reactions: ['That\'s fine — honesty helps more than a guess here.', 'No problem at all.'],
  },
  {
    test: /\b(pushed back|disagreed|argued|escalated|said no|refused|overruled)\b/i,
    reactions: ['Right.', 'Okay — go on.'],
  },
  {
    test: /\b(we|the team|together|my team|we decided|we agreed)\b/i,
    reactions: ['Got it.', 'I see.'],
  },
];

/** Generic fallback, used sparingly — see `pickMicroReaction`. */
const NEUTRAL_REACTIONS = ['Got it.', 'I see.', 'Okay.', 'Understood.', 'Right.'];

/** How often an answer that matched no rule still gets a neutral noise. */
export const NEUTRAL_REACTION_PROBABILITY = 0.15;

/**
 * A reaction to what they just said, or null for silence.
 *
 * `recentReactions` prevents the other failure mode: the same three words
 * every turn, which reads as a script rather than a listener.
 */
export function pickMicroReaction(
  candidateText: string,
  recentReactions: string[] = [],
  random: () => number = Math.random,
): string | null {
  const text = (candidateText ?? '').trim();
  if (!text) return null;

  const recent = new Set(recentReactions);
  const fresh = (options: string[]) => options.filter((o) => !recent.has(o));

  for (const rule of REACTION_RULES) {
    if (!rule.test.test(text)) continue;
    const available = fresh(rule.reactions);
    // Every reaction for this rule has been used recently — saying nothing is
    // better than repeating one.
    if (available.length === 0) return null;
    return available[Math.floor(random() * available.length) % available.length];
  }

  if (random() >= NEUTRAL_REACTION_PROBABILITY) return null;
  const available = fresh(NEUTRAL_REACTIONS);
  if (available.length === 0) return null;
  return available[Math.floor(random() * available.length) % available.length];
}

// ── Layer 7: matching how the candidate speaks ──────────────────────────────

export type SpeakingPace = 'measured' | 'natural' | 'brisk';

export interface PaceProfile {
  pace: SpeakingPace;
  /** Mean words per candidate turn — what the pace was read from. */
  meanWordsPerTurn: number;
  /** Multiplier on Ally's inter-sentence pauses. >1 = leave more room. */
  pauseScale: number;
}

/** Terse answers get a brisker interviewer; long ones get more room to breathe. */
const TERSE_WORDS = 25;
const EXPANSIVE_WORDS = 90;
/** Fewer than this and we are reading noise, not a style. */
const MIN_TURNS_FOR_PACE = 2;

/**
 * Match Ally's delivery to the candidate's.
 *
 * Someone giving clipped 15-word answers and being met with long unhurried
 * paragraphs feels talked at; someone thinking out loud in paragraphs and
 * being met with rapid-fire feels rushed. Mirroring is the single cheapest
 * thing that makes a synthetic voice feel like it is in the room.
 *
 * Read from turn length rather than from audio: words-per-turn is already in
 * the transcript, needs no signal processing, and is stable across
 * microphones. Deliberately three coarse bands — a continuous "speech rate"
 * would be precision this signal does not have.
 */
export function profilePace(candidateTurns: string[]): PaceProfile {
  const counts = candidateTurns
    .map((t) => (t ?? '').trim())
    .filter(Boolean)
    .map((t) => t.split(/\s+/).length);

  if (counts.length < MIN_TURNS_FOR_PACE) {
    return { pace: 'natural', meanWordsPerTurn: counts[0] ?? 0, pauseScale: 1 };
  }

  const meanWordsPerTurn = Math.round(counts.reduce((a, b) => a + b, 0) / counts.length);

  if (meanWordsPerTurn <= TERSE_WORDS) return { pace: 'brisk', meanWordsPerTurn, pauseScale: 0.8 };
  if (meanWordsPerTurn >= EXPANSIVE_WORDS) return { pace: 'measured', meanWordsPerTurn, pauseScale: 1.25 };
  return { pace: 'natural', meanWordsPerTurn, pauseScale: 1 };
}

/** The pace as a line the turn prompt can act on — length is delivery, and the model controls length. */
export function paceDirective(profile: PaceProfile): string {
  switch (profile.pace) {
    case 'brisk':
      return 'DELIVERY: this candidate answers in short, clipped turns. Match them — keep your questions to one or two sentences, no preamble.';
    case 'measured':
      return 'DELIVERY: this candidate thinks out loud at length. Give them room — do not rush them along, and let your own questions be unhurried.';
    default:
      return 'DELIVERY: keep your turns conversational, roughly the length of theirs.';
  }
}
