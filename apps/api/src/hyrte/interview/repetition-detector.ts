/**
 * §8 Hardening — anti-gaming: cross-question validation. Detects a candidate
 * stalling the interview by giving the same (or a lightly reworded) answer
 * repeatedly instead of engaging with the follow-up. A code-level guarantee
 * rather than relying on the LLM noticing on its own — it did notice
 * unprompted in manual testing, but that's not something to depend on for
 * every session.
 */

/** Jaccard similarity over lowercased word sets — cheap, deterministic, no LLM call. */
export function textSimilarity(a: string, b: string): number {
  const setA = new Set(a.toLowerCase().split(/\W+/).filter(Boolean));
  const setB = new Set(b.toLowerCase().split(/\W+/).filter(Boolean));
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const word of setA) if (setB.has(word)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

const REPETITION_THRESHOLD = 0.6;

/** True if `current` is near-duplicate of any prior candidate answer this interview. */
export function isRepetitive(current: string, priorAnswers: string[]): boolean {
  return priorAnswers.some((prior) => textSimilarity(current, prior) >= REPETITION_THRESHOLD);
}
