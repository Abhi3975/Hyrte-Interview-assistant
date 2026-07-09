import { createHash } from 'node:crypto';

/**
 * Lightweight structural plagiarism detection using k-gram token shingling +
 * winnowing-style fingerprints and Jaccard similarity.
 *
 * This resists superficial edits (renamed variables, reformatting, added
 * comments) far better than a raw string diff, while staying cheap enough to
 * run inline on every submission. It is a *signal*, not proof — high similarity
 * is surfaced to reviewers as evidence, consistent with the "never
 * auto-accuse" principle.
 */

const K = 5; // shingle size in tokens

/** Normalize code to a token stream, stripping comments/whitespace/identifiers
 * so cosmetic changes don't defeat the check. */
export function tokenize(code: string, language: string): string[] {
  let src = code;
  // Strip common comment styles.
  src = src.replace(/\/\/.*$/gm, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
  if (language === 'python') src = src.replace(/#.*$/gm, ' ');
  // Collapse string/number literals to placeholders (structure over content).
  src = src.replace(/"(\\.|[^"])*"|'(\\.|[^'])*'/g, ' STR ');
  src = src.replace(/\b\d+(\.\d+)?\b/g, ' NUM ');
  // Split into identifier/operator tokens.
  const raw = src.match(/[A-Za-z_]\w*|[^\sA-Za-z0-9_]/g) ?? [];
  // Map identifiers to a generic token so renames don't matter, keep keywords.
  return raw.map((t) => (/^[A-Za-z_]\w*$/.test(t) && !KEYWORDS.has(t) ? 'ID' : t));
}

/** Set of k-gram fingerprints for a token stream. */
export function fingerprints(tokens: string[]): Set<string> {
  const grams = new Set<string>();
  for (let i = 0; i + K <= tokens.length; i++) {
    const gram = tokens.slice(i, i + K).join(' ');
    grams.add(createHash('sha1').update(gram).digest('hex').slice(0, 12));
  }
  return grams;
}

/** Serialize a fingerprint set for storage. */
export function fingerprintString(fps: Set<string>): string {
  return [...fps].sort().join(',');
}

export function parseFingerprint(s: string | null | undefined): Set<string> {
  return new Set(s ? s.split(',').filter(Boolean) : []);
}

/** Jaccard similarity in [0,1]. */
export function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  for (const x of small) if (large.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

const KEYWORDS = new Set([
  'if', 'else', 'for', 'while', 'return', 'function', 'def', 'class', 'const',
  'let', 'var', 'int', 'float', 'double', 'char', 'void', 'public', 'private',
  'static', 'new', 'import', 'from', 'in', 'range', 'len', 'print', 'true',
  'false', 'null', 'None', 'break', 'continue', 'switch', 'case',
]);
