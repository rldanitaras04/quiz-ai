/**
 * Duplicate-detection scoring for AI question generation (scope §13).
 *
 * Pure and dependency-free on purpose: `tests/*.test.mjs` load TypeScript
 * modules directly and cannot resolve the `@/` import alias, so everything
 * that decides "duplicate or not" lives here. The I/O around it — embedding
 * calls, DB reads — sits in `checkSimilarity` (`@/lib/ai/index.ts`).
 */

/**
 * Text as the exact-match step sees it: lower-cased, punctuation dropped,
 * whitespace collapsed. Formatting-only differences therefore count as the
 * same question; different wording does not.
 *
 * ASCII-class by design: tsconfig targets ES2017 (no `\p{…}` escapes) and the
 * corpus is English examination text.
 */
export function normalizeQuestionText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Cosine similarity between two vectors of equal length (0 for a zero
 * norm). Length mismatches — e.g. a legacy-dimension row — are treated as
 * "not comparable" and score 0 rather than throwing.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

/**
 * Normalizes whatever the database handed back for a vector column into a
 * number array. PostgREST may surface `vector` as a literal `"[1,2,3]"`
 * string or as a JSON array depending on the cast path, and a missing
 * embedding arrives as `null` — all three are handled.
 */
export function parseEmbedding(raw: unknown): number[] | null {
  if (Array.isArray(raw)) {
    return raw.every((n) => typeof n === 'number') ? (raw as number[]) : null;
  }
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) && parsed.every((n) => typeof n === 'number')
        ? (parsed as number[])
        : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** An already-persisted question the candidate is scored against. */
export interface ExistingQuestionRef {
  id?: string;
  question_text: string;
  /** null when the row has never been embedded yet: the exact-match step
   * still applies to it, and the semantic step skips it until the generate
   * route's bounded backfill warms it. */
  embedding: number[] | null;
  /** `batch` entries are candidates accepted earlier in the same generation
   * run; `bank` rows come from the subject question bank (scope §13). */
  origin?: 'assessment' | 'batch' | 'bank';
}

/** Outcome of scoring one candidate against the existing set. Empty object
 * means "no duplicate signal at all". */
export interface CandidateScore {
  /** Normalized-exact match: the strongest signal (reported score 1). */
  exactDuplicateOf?: string;
  /** Highest cosine similarity at or above the threshold (semantic path). */
  maxSimilarity?: number;
  similarQuestionId?: string;
  similarQuestionText?: string;
  similarQuestionSource?: 'assessment' | 'batch' | 'bank';
}

/**
 * Score one candidate question against what is already on file.
 *
 * Exact match (normalized text) runs against every existing question — it
 * needs no embedding. Semantic matching runs only when both sides carry
 * embeddings of the same dimension and the cosine reaches `threshold`.
 */
export function scoreAgainstExisting(
  questionText: string,
  embedding: number[] | null,
  existing: ExistingQuestionRef[],
  threshold: number
): CandidateScore {
  const normalized = normalizeQuestionText(questionText);

  if (normalized.length > 0) {
    const exact = existing.find(
      (q) => normalizeQuestionText(q.question_text) === normalized
    );
    if (exact) {
      return {
        exactDuplicateOf: exact.question_text,
        maxSimilarity: 1,
        similarQuestionId: exact.id,
        similarQuestionText: exact.question_text,
        similarQuestionSource: exact.origin ?? 'assessment',
      };
    }
  }

  if (!embedding || embedding.length === 0) return {};

  let best: CandidateScore = {};
  for (const q of existing) {
    if (!q.embedding || q.embedding.length !== embedding.length) continue;
    const similarity = cosineSimilarity(embedding, q.embedding);
    if (similarity >= threshold && (!best.maxSimilarity || similarity > best.maxSimilarity)) {
      best = {
        maxSimilarity: similarity,
        similarQuestionId: q.id,
        similarQuestionText: q.question_text,
        similarQuestionSource: q.origin ?? 'assessment',
      };
    }
  }
  return best;
}
