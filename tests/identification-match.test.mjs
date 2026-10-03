import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FUZZY_AUTO_ACCEPT,
  FUZZY_REVIEW_FLOOR,
  FUZZY_MAX_LENGTH,
  normalizeIdentification,
  similarity,
  matchIdentification,
} from '../src/lib/identification-match.ts';

// ---------------------------------------------------------------------------
// Normalization — scope §26 item 1: case, whitespace, punctuation.
// ---------------------------------------------------------------------------

test('normalization folds case, trims, strips punctuation and collapses whitespace', () => {
  assert.equal(normalizeIdentification('  Mito-Chondria! '), 'mitochondria');
  assert.equal(normalizeIdentification('Golgi\tApparatus.'), 'golgi apparatus');
  assert.equal(normalizeIdentification('Smooth  endoplasmic   reticulum'),
    'smooth endoplasmic reticulum');
});

test('similarity is 1 for identical strings and 0 when one side is empty', () => {
  assert.equal(similarity('nucleus', 'nucleus'), 1);
  assert.equal(similarity('', ''), 1);
  assert.equal(similarity('nucleus', ''), 0);
});

test('similarity is normalized Levenshtein (kitten/sitting = 1 - 3/7)', () => {
  assert.ok(Math.abs(similarity('kitten', 'sitting') - (1 - 3 / 7)) < 1e-9);
});

// ---------------------------------------------------------------------------
// Tier 1: unanswered → definitively incorrect.
// ---------------------------------------------------------------------------

test('a blank answer is incorrect, not held for review', () => {
  for (const blank of [null, undefined, '', '   ']) {
    const v = matchIdentification(blank, 'mitochondria', null);
    assert.equal(v.outcome, 'incorrect');
    assert.equal(v.method, 'none');
    assert.equal(v.similarity, 0);
  }
});

// ---------------------------------------------------------------------------
// Tier 2/3: exact and approved-alias matches auto-score correct.
// ---------------------------------------------------------------------------

test('exact match after normalization → correct/exact', () => {
  const v = matchIdentification('  Golgi Apparatus. ', 'golgi apparatus', null);
  assert.equal(v.outcome, 'correct');
  assert.equal(v.method, 'exact');
  assert.equal(v.similarity, 1);
  assert.equal(v.candidate, 'golgi apparatus');
});

test('approved alias match → correct/alias, candidate is the alias', () => {
  const v = matchIdentification('ser', 'smooth endoplasmic reticulum', ['SER', 'sER']);
  assert.equal(v.outcome, 'correct');
  assert.equal(v.method, 'alias');
  assert.equal(v.similarity, 1);
  assert.equal(v.candidate, 'SER');
});

test('accepted answers are matched with the same normalization as the key', () => {
  const v = matchIdentification('Powerhouse of the cell!', 'mitochondrion',
    ['Powerhouse of the Cell']);
  assert.equal(v.outcome, 'correct');
  assert.equal(v.method, 'alias');
});

// ---------------------------------------------------------------------------
// Tier 4: fuzzy bands.
// ---------------------------------------------------------------------------

test(`fuzzy similarity >= ${FUZZY_AUTO_ACCEPT} auto-scores correct with evidence`, () => {
  // 'golgi appratus' vs 'golgi apparatus': 1 insertion → 1 - 1/15 = 0.933
  const v = matchIdentification('golgi appratus', 'golgi apparatus', null);
  assert.equal(v.outcome, 'correct');
  assert.equal(v.method, 'fuzzy');
  assert.ok(v.similarity >= FUZZY_AUTO_ACCEPT, `similarity ${v.similarity} >= auto-accept`);
  assert.equal(v.candidate, 'golgi apparatus');
});

test(`fuzzy similarity in [${FUZZY_REVIEW_FLOOR}, ${FUZZY_AUTO_ACCEPT}) is held for faculty`, () => {
  // 'nucelus' vs 'nucleus': transposition → distance 2 → 1 - 2/7 = 0.714
  const v = matchIdentification('nucelus', 'nucleus', null);
  assert.equal(v.outcome, 'manual_review');
  assert.equal(v.method, 'fuzzy');
  assert.ok(v.similarity >= FUZZY_REVIEW_FLOOR && v.similarity < FUZZY_AUTO_ACCEPT,
    `similarity ${v.similarity} inside review band`);
  assert.equal(v.candidate, 'nucleus');
});

test(`fuzzy similarity below ${FUZZY_REVIEW_FLOOR} scores incorrect but keeps the evidence`, () => {
  // 'golgi' vs 'mitochondria': far apart → well below the floor.
  const v = matchIdentification('golgi', 'mitochondria', null);
  assert.equal(v.outcome, 'incorrect');
  assert.equal(v.method, 'fuzzy');
  assert.ok(v.similarity < FUZZY_REVIEW_FLOOR, `similarity ${v.similarity} < review floor`);
});

test('fuzzy picks the best reference as candidate (alias can beat canonical)', () => {
  // vs canonical 'golgi apparatus': ~0.53; vs 'golgi bodies': 1 - 3/12 = 0.75
  const v = matchIdentification('golgi body', 'golgi apparatus', ['golgi bodies']);
  assert.equal(v.outcome, 'manual_review');
  assert.equal(v.candidate, 'golgi bodies');
  assert.ok(v.similarity >= FUZZY_REVIEW_FLOOR);
});

test('a punctuation-only answer cannot fuzzy-match a real key', () => {
  const v = matchIdentification('!!!', 'mitochondria', null);
  assert.equal(v.outcome, 'incorrect');
});

// ---------------------------------------------------------------------------
// Tier 5: no reference answer → the machine must not judge.
// ---------------------------------------------------------------------------

test('no canonical and no accepted answers → held for faculty, never scored wrong', () => {
  const v = matchIdentification('anything the student wrote', null, []);
  assert.equal(v.outcome, 'manual_review');
  assert.equal(v.method, 'none');
  assert.equal(v.candidate, null);
});

test('empty accepted answers entries are ignored as references', () => {
  const v = matchIdentification('nucleus', null, ['', '   ']);
  assert.equal(v.outcome, 'manual_review');
  assert.equal(v.method, 'none');
});

// ---------------------------------------------------------------------------
// Guards on fuzzy eligibility.
// ---------------------------------------------------------------------------

test('short answers are exact-only: near-misses score incorrect, not review', () => {
  // 3-char strings fall below FUZZY_MIN_LENGTH → no fuzzy, no false holds.
  const v = matchIdentification('car', 'cat', null);
  assert.equal(v.outcome, 'incorrect');
  assert.equal(v.method, 'none');
});

test('a plural of a 4+ letter word lands in the review band', () => {
  // 'cells' vs 'cell': distance 1 → 1 - 1/5 = 0.8 → held.
  const v = matchIdentification('cells', 'cell', null);
  assert.equal(v.outcome, 'manual_review');
  assert.ok(v.similarity >= FUZZY_REVIEW_FLOOR);
});

test('answers longer than FUZZY_MAX_LENGTH are never fuzzy-judged → held for review', () => {
  const longKey = 'a'.repeat(FUZZY_MAX_LENGTH + 1);
  const v = matchIdentification('b'.repeat(FUZZY_MAX_LENGTH + 1), longKey, null);
  assert.equal(v.outcome, 'manual_review');
  assert.equal(v.method, 'none');
});

// ---------------------------------------------------------------------------
// Odd inputs must not throw.
// ---------------------------------------------------------------------------

test('matcher tolerates empty references mixed with valid ones', () => {
  const v = matchIdentification('nucleus', 'nucleus', ['', null].filter(Boolean));
  assert.equal(v.outcome, 'correct');
  assert.equal(v.method, 'exact');
});

test('a canonical answer that normalizes to empty never matches a real answer', () => {
  const v = matchIdentification('real answer', '...', null);
  assert.notEqual(v.outcome, 'correct');
});
