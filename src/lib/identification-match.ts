// ---------------------------------------------------------------------------
// Identification answer matching — scope §26 (Automated Score and Item
// Information, "identification support list").
// ---------------------------------------------------------------------------
// Pure module: no imports (in particular no `@/` aliases) so it can be unit
// tested directly under `node --test`, like `identity-verification.ts`.
//
// The matcher returns a tiered verdict instead of a bare 0/1:
//
//   1. Normalization of case, whitespace and punctuation.
//   2. Exact match (after normalization) against the canonical answer.
//   3. Exact match against an approved alias / alternative answer.
//   4. Fuzzy match (normalized Levenshtein similarity) against every
//      reference answer, best score wins:
//        similarity >= FUZZY_AUTO_ACCEPT  → auto-scored correct;
//        FUZZY_REVIEW_FLOOR <= sim < auto → held for faculty review
//                                            (`manual_review`, points NULL);
//        similarity <  review floor       → auto-scored incorrect.
//   5. No reference answer (unkeyed item) → held for faculty review: the
//      machine must not declare an answer wrong when it has nothing to
//      compare it against.
//
// An unanswered item is definitively incorrect (the student had the chance to
// answer) — it still surfaces in the faculty review queue through the
// `earned_points = 0` filter.

/** Similarity at or above this auto-accepts a fuzzy match as correct. */
export const FUZZY_AUTO_ACCEPT = 0.9;
/** Similarity at or above this but below auto-accept → faculty review. */
export const FUZZY_REVIEW_FLOOR = 0.6;
/**
 * Fuzzy matching is skipped when either side is longer than this many
 * characters: Levenshtein on multi-hundred-character strings is both costly
 * and meaningless (a long answer differs from its key in many ways at once).
 * Such answers only ever match exactly; otherwise they are held for review.
 */
export const FUZZY_MAX_LENGTH = 256;
/**
 * Below this length, one-character differences move the similarity score by
 * so much that fuzzy matching would mostly produce noise (e.g. "cat"/"car"
 * scores 0.67). Short answers are exact-match only; a near-miss lands at 0
 * points and still reaches faculty through the zero-score review filter.
 */
export const FUZZY_MIN_LENGTH = 4;

export type IdentificationOutcome = 'correct' | 'manual_review' | 'incorrect';
export type IdentificationMethod = 'exact' | 'alias' | 'fuzzy' | 'none';

export interface IdentificationVerdict {
  outcome: IdentificationOutcome;
  method: IdentificationMethod;
  /** 0..1 — 1 for exact/alias matches, the computed score for fuzzy. */
  similarity: number;
  /** The reference answer the verdict was reached against (best fuzzy candidate). */
  candidate: string | null;
}

/** Case / whitespace / punctuation normalization (scope §26 item 1). */
export function normalizeIdentification(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ');
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Two-row dynamic program — O(min(m,n)) memory.
  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    const swap = prev;
    prev = curr;
    curr = swap;
  }
  return prev[b.length];
}

/** Normalized Levenshtein similarity in [0, 1]: 1 − distance / max length. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

function isFuzzyEligible(a: string, b: string): boolean {
  const minLen = Math.min(a.length, b.length);
  const maxLen = Math.max(a.length, b.length);
  return minLen >= FUZZY_MIN_LENGTH && maxLen <= FUZZY_MAX_LENGTH;
}

/**
 * Judge a free-text identification answer against the canonical answer and
 * its approved aliases. Never throws; always returns a verdict.
 */
export function matchIdentification(
  textAnswer: string | null | undefined,
  canonicalAnswer: string | null | undefined,
  acceptedAnswers: readonly string[] | null | undefined
): IdentificationVerdict {
  const answer = (textAnswer ?? '').trim();
  if (answer === '') {
    return { outcome: 'incorrect', method: 'none', similarity: 0, candidate: null };
  }
  const normalized = normalizeIdentification(answer);

  const references: string[] = [];
  if (canonicalAnswer && canonicalAnswer.trim()) references.push(canonicalAnswer);
  for (const accepted of acceptedAnswers ?? []) {
    if (accepted && accepted.trim()) references.push(accepted);
  }

  // Tier 2/3: exact (post-normalization) match — canonical first so `candidate`
  // reports the strongest reference, then approved aliases.
  const normalizedRefs = references.map((ref) => ({ ref, norm: normalizeIdentification(ref) }));
  const exact = normalizedRefs.find((r) => r.norm === normalized);
  if (exact) {
    const isCanonical = canonicalAnswer != null && exact.ref === canonicalAnswer;
    return {
      outcome: 'correct',
      method: isCanonical ? 'exact' : 'alias',
      similarity: 1,
      candidate: exact.ref,
    };
  }

  // Tier 5: nothing to compare against — faculty decides.
  if (normalizedRefs.length === 0) {
    return { outcome: 'manual_review', method: 'none', similarity: 0, candidate: null };
  }

  // Tier 4: fuzzy band — only against references eligible for fuzzy scoring.
  const eligible = normalizedRefs.filter((r) => isFuzzyEligible(normalized, r.norm));
  if (eligible.length === 0) {
    // Either the strings are too short for fuzzy (exact-only, already missed)
    // or too long to judge reliably — a non-exact long answer goes to faculty
    // rather than being declared wrong by an unreliable score.
    const tooLong =
      normalized.length > FUZZY_MAX_LENGTH ||
      normalizedRefs.some((r) => r.norm.length > FUZZY_MAX_LENGTH);
    return tooLong
      ? { outcome: 'manual_review', method: 'none', similarity: 0, candidate: null }
      : { outcome: 'incorrect', method: 'none', similarity: 0, candidate: null };
  }

  let best: { ref: string; sim: number } | null = null;
  for (const r of eligible) {
    const sim = similarity(normalized, r.norm);
    if (!best || sim > best.sim) best = { ref: r.ref, sim: sim };
  }
  if (!best) {
    return { outcome: 'manual_review', method: 'none', similarity: 0, candidate: null };
  }

  if (best.sim >= FUZZY_AUTO_ACCEPT) {
    return { outcome: 'correct', method: 'fuzzy', similarity: best.sim, candidate: best.ref };
  }
  if (best.sim >= FUZZY_REVIEW_FLOOR) {
    return { outcome: 'manual_review', method: 'fuzzy', similarity: best.sim, candidate: best.ref };
  }
  return { outcome: 'incorrect', method: 'fuzzy', similarity: best.sim, candidate: best.ref };
}
