import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_ANALYSIS_THRESHOLDS,
  DISCRIMINATION_MIN_N,
  DISCRIMINATION_MIN_GROUP,
  ITEM_FLAG_LABELS,
  computeDiscriminationIndex,
  discriminationRating,
  itemFlags,
  passRate,
  summarizeItemStats,
} from '../src/lib/item-analysis.ts';

// ---------------------------------------------------------------------------
// Discrimination index D = (RU/NU) − (RL/NL) (scope §29)
// ---------------------------------------------------------------------------

/** 20 attempts, totals 100, 90, … 10; correct on the top 6 + attempt 15. */
function fixture20() {
  const totals = new Map();
  const items = [];
  for (let i = 1; i <= 20; i += 1) {
    const attemptId = `a${i}`;
    totals.set(attemptId, 110 - 10 * i);
    items.push({ attemptId, correct: i <= 6 || i === 15 });
  }
  return { items, totals };
}

test('D matches the hand-computed upper27% − lower27% value', () => {
  const { items, totals } = fixture20();
  // groupSize = max(3, ceil(20 * 0.27)) = 6 → RU = 6/6, RL = 1/6.
  const d = computeDiscriminationIndex(items, totals, 27);
  assert.ok(Math.abs(d - (1 - 1 / 6)) < 1e-9, `D = ${d}`);
});

test('the configured group size genuinely changes D (methodology is configurable)', () => {
  const { items, totals } = fixture20();
  const d27 = computeDiscriminationIndex(items, totals, 27);
  const d50 = computeDiscriminationIndex(items, totals, 50);
  // 50% groups: RU = 6/10, RL = 1/10 → D = 0.5 (versus ~0.833 at 27%).
  assert.ok(Math.abs(d50 - 0.5) < 1e-9, `D@50 = ${d50}`);
  assert.notEqual(d27, d50);
});

test('D is null when there are too few scored attempts, no variance, or overlapping groups', () => {
  const { items, totals } = fixture20();

  // Fewer than DISCRIMINATION_MIN_N scored attempts.
  const fewItems = items.slice(0, DISCRIMINATION_MIN_N - 1);
  assert.equal(computeDiscriminationIndex(fewItems, totals, 27), null);
  // Attempts without a total score are ignored (unscored).
  const emptyTotals = new Map();
  assert.equal(computeDiscriminationIndex(items, emptyTotals, 27), null);

  // No variance: everyone correct / everyone incorrect.
  const allRight = items.map(i => ({ ...i, correct: true }));
  assert.equal(computeDiscriminationIndex(allRight, totals, 27), null);
  const allWrong = items.map(i => ({ ...i, correct: false }));
  assert.equal(computeDiscriminationIndex(allWrong, totals, 27), null);

  // Groups would overlap (7 attempts at 50% → groups of 4 + 4 > 7).
  const seven = items.slice(0, 7);
  assert.equal(computeDiscriminationIndex(seven, totals, 50), null);
});

test('each comparison group keeps at least the minimum size', () => {
  // n = 6 at 5%: ceil(0.3) = 1 → max(3, 1) = 3; 3*2 = 6 ≤ 6 → computable,
  // identical to the 27% grouping because the minimum floor dominates.
  const totals = new Map();
  const items = [];
  for (let i = 1; i <= 6; i += 1) {
    totals.set(`a${i}`, 100 - i);
    items.push({ attemptId: `a${i}`, correct: i <= 3 });
  }
  const d5 = computeDiscriminationIndex(items, totals, 5);
  const d27 = computeDiscriminationIndex(items, totals, 27);
  assert.ok(Math.abs(d5 - 1) < 1e-9, `D@5 = ${d5}`);
  assert.equal(d5, d27);
  assert.ok(DISCRIMINATION_MIN_GROUP >= 1);
});

// ---------------------------------------------------------------------------
// Ratings and item review flags — configurable interpretation (scope §29)
// ---------------------------------------------------------------------------

test('discrimination rating uses the configured cut-offs', () => {
  const t = DEFAULT_ANALYSIS_THRESHOLDS;
  assert.equal(discriminationRating(null, t), 'n/a');
  assert.equal(discriminationRating(0.35, t), 'good');
  assert.equal(discriminationRating(0.3, t), 'good');
  assert.equal(discriminationRating(0.25, t), 'fair');
  assert.equal(discriminationRating(0.05, t), 'weak');
  assert.equal(discriminationRating(-0.1, t), 'negative');

  // Custom cut-offs re-interpret the same number.
  const strict = { ...t, goodD: 0.5, fairD: 0.4 };
  assert.equal(discriminationRating(0.45, strict), 'fair');
  assert.equal(discriminationRating(0.35, strict), 'weak');
});

test('item flags reflect the configured thresholds', () => {
  const t = DEFAULT_ANALYSIS_THRESHOLDS;
  const base = { responses: 10, difficultyIndex: 0.7, discriminationIndex: 0.4, distractorPercentages: [20, 30] };
  assert.deepEqual(itemFlags(base, t), []);

  assert.deepEqual(itemFlags({ ...base, responses: 0, difficultyIndex: 0, discriminationIndex: null }, t), ['no_responses']);
  assert.deepEqual(itemFlags({ ...base, difficultyIndex: 0.9 }, t), ['too_easy']);
  assert.deepEqual(itemFlags({ ...base, difficultyIndex: 0.29 }, t), ['too_hard']);
  assert.deepEqual(itemFlags({ ...base, discriminationIndex: -0.05 }, t), ['negative_discrimination']);
  assert.deepEqual(itemFlags({ ...base, discriminationIndex: 0.05 }, t), ['weak_discrimination']);
  assert.deepEqual(itemFlags({ ...base, distractorPercentages: [2, 30] }, t), ['low_use_distractor']);
  assert.deepEqual(itemFlags({ ...base, distractorPercentages: [0, 30] }, t), ['low_use_distractor']);
  assert.deepEqual(itemFlags({ ...base, responses: 3, discriminationIndex: null }, t), ['insufficient_responses']);
  // Enough responses but no variance (D null) → extremes already cover it.
  assert.deepEqual(itemFlags({ ...base, difficultyIndex: 0.7, discriminationIndex: null }, t), []);

  // Strict easy threshold flags a mid-range item that the default lets pass.
  const strict = { ...t, easyP: 0.65 };
  assert.deepEqual(itemFlags(base, strict), ['too_easy']);

  // Flags stack.
  const stacked = itemFlags(
    { ...base, difficultyIndex: 0.95, discriminationIndex: -0.2, distractorPercentages: [1] },
    t
  );
  assert.deepEqual(stacked, ['too_easy', 'negative_discrimination', 'low_use_distractor']);
});

test('every flag has a human label', () => {
  const all = [
    'no_responses',
    'too_easy',
    'too_hard',
    'insufficient_responses',
    'weak_discrimination',
    'negative_discrimination',
    'low_use_distractor',
  ];
  for (const flag of all) {
    assert.equal(typeof ITEM_FLAG_LABELS[flag], 'string');
    assert.ok(ITEM_FLAG_LABELS[flag].length > 0);
  }
});

// ---------------------------------------------------------------------------
// Pass rate against the configured pass mark (scope §29/§31)
// ---------------------------------------------------------------------------

test('passRate counts scores at or above the configured mark', () => {
  assert.equal(passRate([], 60), 0);
  assert.equal(passRate([50, 60, 70], 60), (2 / 3) * 100);
  assert.equal(passRate([50, 60, 70], 70), (1 / 3) * 100);
  assert.equal(passRate([100, 100], 100), 100);
});

test('default thresholds are coherent', () => {
  const t = DEFAULT_ANALYSIS_THRESHOLDS;
  assert.equal(t.groupPercent, 27);
  assert.equal(t.passMark, 60);
  assert.ok(t.goodD > t.fairD, 'Good cut-off must exceed Fair');
  assert.ok(t.easyP > t.hardP, 'easy threshold must exceed hard threshold');
  assert.ok(t.hardP > 0 && t.easyP <= 1);
  for (const v of Object.values(t)) assert.equal(typeof v, 'number');
});

// ---------------------------------------------------------------------------
// Bank item-statistics snapshots (scope §30)
// ---------------------------------------------------------------------------

const CHOICES_A = [
  { id: 'cA', choice_key: 'A' },
  { id: 'cB', choice_key: 'B' },
  { id: 'cC', choice_key: 'C' },
];

test('summarizeItemStats builds a MCQ snapshot with distractor performance', () => {
  const responses = [
    { attempt_id: 't1', selected_choice_id: 'cB', earned_points: 1 },
    { attempt_id: 't2', selected_choice_id: 'cB', earned_points: 1 },
    { attempt_id: 't3', selected_choice_id: 'cA', earned_points: 0 },
    { attempt_id: 't4', selected_choice_id: 'cA', earned_points: 0 },
  ];
  const snap = summarizeItemStats({
    questionType: 'multiple_choice',
    responses,
    choices: CHOICES_A,
    correctChoiceId: 'cB',
    totalByAttempt: new Map(),
    groupPercent: 27,
    computedAt: '2026-10-03T00:00:00.000Z',
  });
  assert.ok(snap);
  assert.equal(snap.n, 4);
  assert.equal(snap.correct_count, 2);
  assert.equal(snap.difficulty_index, 0.5);
  assert.equal(snap.computed_at, '2026-10-03T00:00:00.000Z');
  // n = 4 < 6 → D not computable.
  assert.equal(snap.discrimination_index, null);

  const byKey = Object.fromEntries(snap.distractors.map(d => [d.choice_key, d]));
  assert.equal(byKey.B.selections, 2);
  assert.equal(byKey.B.percentage, 50);
  assert.equal(byKey.B.is_correct, true);
  assert.equal(byKey.A.selections, 2);
  assert.equal(byKey.A.is_correct, false);
  assert.equal(byKey.C.selections, 0);
  assert.equal(byKey.C.percentage, 0);
  assert.equal(snap.distractors.length, 3);
});

test('summarizeItemStats counts identification correctness by earned points', () => {
  const snap = summarizeItemStats({
    questionType: 'identification',
    responses: [
      { attempt_id: 't1', selected_choice_id: null, earned_points: 2 },
      { attempt_id: 't2', selected_choice_id: null, earned_points: 0 },
      { attempt_id: 't3', selected_choice_id: null, earned_points: null },
    ],
    choices: [],
    correctChoiceId: null,
    totalByAttempt: new Map(),
    groupPercent: 27,
  });
  assert.ok(snap);
  assert.equal(snap.n, 3);
  assert.equal(snap.correct_count, 1);
  assert.ok(Math.abs(snap.difficulty_index - 1 / 3) < 1e-9);
  assert.deepEqual(snap.distractors, []);
});

test('summarizeItemStats returns null without responses and computes D with enough scored attempts', () => {
  assert.equal(
    summarizeItemStats({
      questionType: 'multiple_choice',
      responses: [],
      choices: CHOICES_A,
      correctChoiceId: 'cA',
      totalByAttempt: new Map(),
      groupPercent: 27,
    }),
    null
  );

  // 8 attempts: correct on the top 4 scores only → strong discrimination.
  const responses = [];
  const totals = new Map();
  for (let i = 1; i <= 8; i += 1) {
    const attemptId = `t${i}`;
    totals.set(attemptId, 100 - i);
    responses.push({
      attempt_id: attemptId,
      selected_choice_id: i <= 4 ? 'cA' : 'cC',
      earned_points: i <= 4 ? 1 : 0,
    });
  }
  const snap = summarizeItemStats({
    questionType: 'multiple_choice',
    responses,
    choices: CHOICES_A,
    correctChoiceId: 'cA',
    totalByAttempt: totals,
    groupPercent: 27,
  });
  assert.ok(snap);
  assert.equal(snap.n, 8);
  assert.equal(snap.correct_count, 4);
  assert.equal(snap.difficulty_index, 0.5);
  assert.ok(typeof snap.discrimination_index === 'number');
  assert.ok(snap.discrimination_index > 0, `D = ${snap.discrimination_index}`);
});
