// ---------------------------------------------------------------------------
// Pre-exam quality checks — scope §31 (pre-exam half).
// ---------------------------------------------------------------------------
// "Pre-exam: source-grounding coverage, TOS alignment, difficulty
//  distribution, Bloom distribution, exact duplicate count, semantic
//  similarity flags, validation issues."
//
// Pure and alias-free (node --test friendly, like item-analysis.ts): the
// server action loads rows, assembles QualityQuestion[], and every check below
// is deterministic and unit tested. Flags are analytic guidance for faculty
// judgement, never automatic rejections.

// node --test loads this module directly, so relative imports carry explicit
// .ts extensions (tsconfig sets allowImportingTsExtensions).
import { cosineSimilarity, normalizeQuestionText } from './ai/duplicate-check.ts';
import { tosMarginals, type TosRow } from './ai/tos.ts';

export interface QualityQuestion {
  id: string;
  position: number | null;
  question_type: string;
  question_text: string;
  difficulty: string;
  bloom_level: string;
  points: number;
  /** Canonical topic title of the question, or null when untagged. */
  topic_title: string | null;
  choice_count: number;
  has_correct_choice: boolean;
  has_canonical_answer: boolean;
  /** At least one linked source chunk (§31 source-grounding coverage). */
  grounded: boolean;
  embedding: number[] | null;
}

export interface ValidationIssue {
  question_id: string;
  position: number | null;
  issues: string[];
}

/** Structural problems that make a question unanswerable or unscorable. */
export function validateQualityQuestions(questions: QualityQuestion[]): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  for (const q of questions) {
    const issues: string[] = [];
    if (q.question_text.trim().length < 10) {
      issues.push('Question text is empty or too short');
    }
    if (q.question_type === 'multiple_choice' || q.question_type === 'true_false') {
      if (q.choice_count < 2) issues.push('Needs at least two choices');
      if (!q.has_correct_choice) issues.push('No correct choice selected');
    }
    if (q.question_type === 'identification' && !q.has_canonical_answer) {
      issues.push('No canonical answer set');
    }
    if (!Number.isFinite(q.points) || q.points < 1) issues.push('Points must be at least 1');
    if (issues.length > 0) {
      out.push({ question_id: q.id, position: q.position, issues });
    }
  }
  return out;
}

export type QualityDimension = 'difficulty' | 'bloom_level' | 'question_type' | 'topic_title';

export interface DimensionCount {
  key: string;
  count: number;
}

/** Counts per key of one dimension, sorted alphabetically for stable display. */
export function dimensionCounts(
  questions: QualityQuestion[],
  dimension: QualityDimension
): DimensionCount[] {
  const counts = new Map<string, number>();
  for (const q of questions) {
    const key = String(q[dimension] ?? '(untagged)');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

export interface DuplicateGroup {
  normalized: string;
  question_ids: string[];
  positions: number[];
}

/** Same normalized text appearing on more than one question (§31 exact duplicates). */
export function exactDuplicates(questions: QualityQuestion[]): DuplicateGroup[] {
  const byNormalized = new Map<string, QualityQuestion[]>();
  for (const q of questions) {
    const normalized = normalizeQuestionText(q.question_text);
    if (!normalized) continue;
    const list = byNormalized.get(normalized) ?? [];
    list.push(q);
    byNormalized.set(normalized, list);
  }
  const groups: DuplicateGroup[] = [];
  for (const [normalized, list] of byNormalized) {
    if (list.length < 2) continue;
    groups.push({
      normalized,
      question_ids: list.map(q => q.id),
      positions: list.map(q => q.position ?? 0),
    });
  }
  return groups.sort((a, b) => a.positions[0] - b.positions[0]);
}

export interface SimilarityFlag {
  a_id: string;
  b_id: string;
  a_position: number | null;
  b_position: number | null;
  score: number;
}

/**
 * Pairs of embedded questions at or above the similarity threshold (§31
 * semantic similarity flags). Questions without embeddings are skipped; pairs
 * are exact-duplicate candidates too (cosine ≈ 1) and simply score highest.
 */
export function semanticSimilarityFlags(
  questions: QualityQuestion[],
  threshold: number
): SimilarityFlag[] {
  const embedded = questions.filter(q => q.embedding && q.embedding.length > 0);
  const flags: SimilarityFlag[] = [];
  for (let i = 0; i < embedded.length; i += 1) {
    for (let j = i + 1; j < embedded.length; j += 1) {
      const score = cosineSimilarity(embedded[i].embedding!, embedded[j].embedding!);
      if (score >= threshold) {
        flags.push({
          a_id: embedded[i].id,
          b_id: embedded[j].id,
          a_position: embedded[i].position,
          b_position: embedded[j].position,
          score,
        });
      }
    }
  }
  return flags.sort((a, b) => b.score - a.score);
}

export interface GroundingCoverage {
  grounded: number;
  total: number;
  /** Percentage with one decimal. */
  percentage: number;
}

/** §31 source-grounding coverage: questions with ≥1 linked source chunk. */
export function groundingCoverage(questions: QualityQuestion[]): GroundingCoverage {
  const total = questions.length;
  const grounded = questions.filter(q => q.grounded).length;
  return {
    grounded,
    total,
    percentage: total > 0 ? Math.round((grounded / total) * 1000) / 10 : 0,
  };
}

export interface TosAlignmentMismatch {
  dimension: 'total' | 'type' | 'difficulty' | 'bloom' | 'topic';
  key: string;
  expected: number;
  actual: number;
}

export interface TosAlignment {
  /** A TOS snapshot exists on this version (approved under §10). */
  approved: boolean;
  expected_items: number;
  actual_items: number;
  mismatches: TosAlignmentMismatch[];
}

function toRecord(counts: DimensionCount[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of counts) out[c.key] = c.count;
  return out;
}

/**
 * §31 TOS alignment: compares the approved table of specs against the actual
 * questions, dimension by dimension (totals, type, difficulty, Bloom, topic).
 * Without an approved TOS there is nothing to align to — approved: false.
 */
export function tosAlignment(
  snapshot: { rows?: TosRow[] } | null | undefined,
  questions: QualityQuestion[]
): TosAlignment {
  const actualItems = questions.length;
  const rows = Array.isArray(snapshot?.rows) ? snapshot!.rows! : null;
  if (!rows) {
    return { approved: false, expected_items: 0, actual_items: actualItems, mismatches: [] };
  }

  const expected = tosMarginals(rows);
  const mismatches: TosAlignmentMismatch[] = [];

  const compare = (
    dimension: TosAlignmentMismatch['dimension'],
    exp: Record<string, number>,
    act: Record<string, number>
  ): void => {
    for (const key of new Set([...Object.keys(exp), ...Object.keys(act)])) {
      const e = exp[key] ?? 0;
      const a = act[key] ?? 0;
      if (e !== a) mismatches.push({ dimension, key, expected: e, actual: a });
    }
  };

  if (expected.totalItems !== actualItems) {
    mismatches.push({
      dimension: 'total',
      key: 'items',
      expected: expected.totalItems,
      actual: actualItems,
    });
  }
  compare('type', expected.byType, toRecord(dimensionCounts(questions, 'question_type')));
  compare('difficulty', expected.byDifficulty, toRecord(dimensionCounts(questions, 'difficulty')));
  compare('bloom', expected.byBloom, toRecord(dimensionCounts(questions, 'bloom_level')));
  compare(
    'topic',
    expected.byTopic,
    toRecord(dimensionCounts(questions, 'topic_title'))
  );

  return {
    approved: true,
    expected_items: expected.totalItems,
    actual_items: actualItems,
    mismatches,
  };
}
