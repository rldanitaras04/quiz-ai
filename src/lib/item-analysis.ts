// ---------------------------------------------------------------------------
// Item and distractor analysis — scope §29.
// ---------------------------------------------------------------------------
// "Difficulty index: P = R / N. Discrimination index using configurable
//  upper/lower group methodology: D = (RU / NU) − (RL / NL). Distractor
//  analysis: selection count/percentage per option; correct option; low-use
//  distractor identification; item review flags. Interpretation thresholds
//  must be configurable and treated as analytic guidance, not unquestionable
//  conclusions."
//
// Pure, zero-import (node --test friendly, like identification-match.ts).
// `analytics/actions.ts` supplies the resolved thresholds from system_settings
// via getSettings(); the constants below are the fallback for direct callers.

export interface AnalysisThresholds {
  /** Upper/lower group size as a share (%) of scored attempts. */
  groupPercent: number;
  /** Percentage score at or above which an attempt passes. */
  passMark: number;
  /** P at or above → "too easy" flag. */
  easyP: number;
  /** P below → "too hard" flag. */
  hardP: number;
  /** D below (but not negative) → "weak discrimination" flag. */
  minDisc: number;
  /** Rating cut-offs: Good when D ≥ goodD, Fair when D ≥ fairD. */
  goodD: number;
  fairD: number;
  /** Selection share (%) below which a distractor is flagged low-use. */
  lowDistractorPct: number;
}

export const DEFAULT_ANALYSIS_THRESHOLDS: AnalysisThresholds = {
  groupPercent: 27,
  passMark: 60,
  easyP: 0.9,
  hardP: 0.3,
  minDisc: 0.1,
  goodD: 0.3,
  fairD: 0.2,
  lowDistractorPct: 5,
};

/** Fewer scored attempts than this → D is not meaningful (null). */
export const DISCRIMINATION_MIN_N = 6;
/** Each comparison group holds at least this many attempts. */
export const DISCRIMINATION_MIN_GROUP = 3;

/**
 * Discrimination index D = (RU / NU) − (RL / NL).
 *
 * Respondents are ranked by total percentage; the top and bottom
 * `groupPercent`% (at least DISCRIMINATION_MIN_GROUP each when n allows) form
 * the groups. Returns null when there are too few scored attempts
 * (DISCRIMINATION_MIN_N) to form meaningful groups, when the item has no
 * variance (everyone correct or everyone incorrect), or when the groups would
 * overlap.
 */
export function computeDiscriminationIndex(
  items: { attemptId: string; correct: boolean }[],
  totalByAttempt: Map<string, number>,
  groupPercent: number = DEFAULT_ANALYSIS_THRESHOLDS.groupPercent
): number | null {
  const scored = items.filter((i) => totalByAttempt.has(i.attemptId));
  const n = scored.length;
  if (n < DISCRIMINATION_MIN_N) return null;

  const correctCount = scored.filter((i) => i.correct).length;
  if (correctCount === 0 || correctCount === n) return null;

  const groupSize = Math.max(DISCRIMINATION_MIN_GROUP, Math.ceil(n * (groupPercent / 100)));
  if (groupSize * 2 > n) return null;

  const sorted = scored
    .slice()
    .sort(
      (a, b) => (totalByAttempt.get(b.attemptId) ?? 0) - (totalByAttempt.get(a.attemptId) ?? 0)
    );

  const upper = sorted.slice(0, groupSize);
  const lower = sorted.slice(sorted.length - groupSize);

  const ru = upper.filter((i) => i.correct).length / upper.length;
  const rl = lower.filter((i) => i.correct).length / lower.length;
  return ru - rl;
}

export type DiscriminationRating = 'good' | 'fair' | 'weak' | 'negative' | 'n/a';

/** Interpretation of D against the configured cut-offs (analytic guidance). */
export function discriminationRating(
  d: number | null,
  t: AnalysisThresholds = DEFAULT_ANALYSIS_THRESHOLDS
): DiscriminationRating {
  if (d === null) return 'n/a';
  if (d < 0) return 'negative';
  if (d >= t.goodD) return 'good';
  if (d >= t.fairD) return 'fair';
  return 'weak';
}

export type ItemFlag =
  | 'no_responses'
  | 'too_easy'
  | 'too_hard'
  | 'insufficient_responses'
  | 'weak_discrimination'
  | 'negative_discrimination'
  | 'low_use_distractor';

export const ITEM_FLAG_LABELS: Record<ItemFlag, string> = {
  no_responses: 'No responses',
  too_easy: 'Too easy',
  too_hard: 'Too hard',
  insufficient_responses: 'Too few responses for D',
  weak_discrimination: 'Weak discrimination',
  negative_discrimination: 'Negative discrimination',
  low_use_distractor: 'Low-use distractor',
};

export interface ItemFlagInput {
  /** N — scored responses to this item. */
  responses: number;
  /** P — difficulty index (correct / responses); ignored when responses = 0. */
  difficultyIndex: number;
  /** D — discrimination index, or null when not computable. */
  discriminationIndex: number | null;
  /** Selection percentages of the NON-correct options (MCQ/TF only). */
  distractorPercentages: number[];
}

/**
 * Item review flags (scope §29 "item review flags") against the configured
 * thresholds. Flags are prompts for faculty judgement, not verdicts.
 */
export function itemFlags(
  input: ItemFlagInput,
  t: AnalysisThresholds = DEFAULT_ANALYSIS_THRESHOLDS
): ItemFlag[] {
  const flags: ItemFlag[] = [];

  if (input.responses === 0) {
    flags.push('no_responses');
    return flags;
  }

  if (input.difficultyIndex >= t.easyP) flags.push('too_easy');
  if (input.difficultyIndex < t.hardP) flags.push('too_hard');

  const d = input.discriminationIndex;
  if (d === null) {
    if (input.responses < DISCRIMINATION_MIN_N) flags.push('insufficient_responses');
    // No-variance items (D = null with enough responses) are already
    // surfaced by the P extremes above.
  } else if (d < 0) {
    flags.push('negative_discrimination');
  } else if (d < t.minDisc) {
    flags.push('weak_discrimination');
  }

  if (input.distractorPercentages.some((pct) => pct < t.lowDistractorPct)) {
    flags.push('low_use_distractor');
  }

  return flags;
}

/** Share (%) of scores at or above the pass mark. */
export function passRate(scores: number[], passMark: number): number {
  if (scores.length === 0) return 0;
  return (scores.filter((s) => s >= passMark).length / scores.length) * 100;
}

// ---------------------------------------------------------------------------
// Historical item statistics for the question bank (scope §30)
// ---------------------------------------------------------------------------

export interface BankDistractorStat {
  choice_key: string;
  selections: number;
  percentage: number;
  is_correct: boolean;
}

/**
 * Snapshot stored on `question_bank.item_stats` when a question is saved to
 * the bank — "historical item statistics; distractor performance" (§30).
 */
export interface ItemStatsSnapshot {
  n: number;
  correct_count: number;
  difficulty_index: number;
  discrimination_index: number | null;
  distractors: BankDistractorStat[];
  computed_at: string;
}

export interface ItemStatsInput {
  questionType: string;
  /** The question's responses across every scored attempt (any deployment). */
  responses: {
    attempt_id: string;
    selected_choice_id: string | null;
    earned_points: number | null;
  }[];
  /** Choices for MCQ/TF items, in display order. */
  choices: { id: string; choice_key: string }[];
  correctChoiceId: string | null;
  /** Attempt id → total percentage score (for the discrimination index). */
  totalByAttempt: Map<string, number>;
  groupPercent: number;
  /** ISO timestamp stamped into the snapshot (injectable for tests). */
  computedAt?: string;
}

/**
 * Builds the bank snapshot from already-loaded rows. Returns null when the
 * question has no responses — there is no history to record yet.
 *
 * Correctness mirrors the analytics item analysis: MCQ/TF by exact choice
 * match, identification by earned_points > 0 (partial credit counts as not
 * fully correct, same as `difficulty_index` there).
 */
export function summarizeItemStats(input: ItemStatsInput): ItemStatsSnapshot | null {
  const { responses } = input;
  if (responses.length === 0) return null;

  const isCorrect = (r: ItemStatsInput['responses'][number]): boolean => {
    if (input.questionType === 'multiple_choice' || input.questionType === 'true_false') {
      return (
        input.correctChoiceId !== null &&
        r.selected_choice_id !== null &&
        r.selected_choice_id === input.correctChoiceId
      );
    }
    if (input.questionType === 'identification') {
      return r.earned_points !== null && r.earned_points > 0;
    }
    return false;
  };

  const correctCount = responses.filter(isCorrect).length;
  const difficultyIndex = correctCount / responses.length;

  const discriminationIndex = computeDiscriminationIndex(
    responses.map(r => ({ attemptId: r.attempt_id, correct: isCorrect(r) })),
    input.totalByAttempt,
    input.groupPercent
  );

  const distractors: BankDistractorStat[] = [];
  if (input.questionType === 'multiple_choice' || input.questionType === 'true_false') {
    const selections = new Map<string, number>();
    for (const r of responses) {
      if (r.selected_choice_id) {
        selections.set(r.selected_choice_id, (selections.get(r.selected_choice_id) ?? 0) + 1);
      }
    }
    for (const choice of input.choices) {
      const count = selections.get(choice.id) ?? 0;
      distractors.push({
        choice_key: choice.choice_key,
        selections: count,
        percentage: (count / responses.length) * 100,
        is_correct: choice.id === input.correctChoiceId,
      });
    }
  }

  return {
    n: responses.length,
    correct_count: correctCount,
    difficulty_index: difficultyIndex,
    discrimination_index: discriminationIndex,
    distractors,
    computed_at: input.computedAt ?? new Date().toISOString(),
  };
}
