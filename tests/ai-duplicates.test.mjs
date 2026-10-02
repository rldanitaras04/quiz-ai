import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cosineSimilarity,
  normalizeQuestionText,
  parseEmbedding,
  scoreAgainstExisting,
} from '../src/lib/ai/duplicate-check.ts';
import { buildQuestionPrompt } from '../src/lib/ai/prompt.ts';

// ---------------------------------------------------------------------------
// Normalization (the exact-match step of scope §13)
// ---------------------------------------------------------------------------

test('normalization is case-, punctuation- and whitespace-insensitive', () => {
  assert.equal(
    normalizeQuestionText('  What IS the, powerhouse?  '),
    'what is the powerhouse'
  );
  assert.equal(
    normalizeQuestionText('What is the powerhouse?'),
    normalizeQuestionText('what  is the powerhouse')
  );
});

test('different wording stays different after normalization', () => {
  assert.notEqual(
    normalizeQuestionText('What is osmosis?'),
    normalizeQuestionText('Define osmosis')
  );
});

test('punctuation-only input normalizes to empty', () => {
  assert.equal(normalizeQuestionText('...'), '');
});

// ---------------------------------------------------------------------------
// Embedding parsing (PostgREST may return a vector as array or string)
// ---------------------------------------------------------------------------

test('parseEmbedding accepts arrays and "[1,2,3]" strings', () => {
  assert.deepEqual(parseEmbedding([0.1, 0.2]), [0.1, 0.2]);
  assert.deepEqual(parseEmbedding('[0.1,0.2]'), [0.1, 0.2]);
});

test('parseEmbedding rejects null, garbage and non-numeric arrays', () => {
  assert.equal(parseEmbedding(null), null);
  assert.equal(parseEmbedding(undefined), null);
  assert.equal(parseEmbedding('not json'), null);
  assert.equal(parseEmbedding('[1,"two"]'), null);
  assert.equal(parseEmbedding(['1', '2']), null);
});

// ---------------------------------------------------------------------------
// Cosine similarity
// ---------------------------------------------------------------------------

test('identical vectors score 1, orthogonal vectors score 0', () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
});

test('a length mismatch scores 0 instead of throwing', () => {
  // Legacy-dimension rows must not crash the duplicate gate.
  assert.equal(cosineSimilarity([1, 0], [1, 0, 0]), 0);
});

test('a zero vector scores 0', () => {
  assert.equal(cosineSimilarity([0, 0], [1, 0]), 0);
});

// ---------------------------------------------------------------------------
// scoreAgainstExisting — the gate the generate route runs per candidate
// ---------------------------------------------------------------------------

const existing = [
  {
    id: 'q1',
    question_text: 'What is the powerhouse of the cell?',
    embedding: [1, 0],
    origin: 'assessment',
  },
  { id: 'q2', question_text: 'Define osmosis.', embedding: null, origin: 'bank' },
];

test('exact match wins regardless of the candidate embedding', () => {
  const score = scoreAgainstExisting('what is the powerhouse of the cell', [0, 1], existing, 0.9);
  // The matched EXISTING text is what gets reported, so faculty can see the item.
  assert.equal(score.exactDuplicateOf, 'What is the powerhouse of the cell?');
  assert.equal(score.maxSimilarity, 1);
  assert.equal(score.similarQuestionId, 'q1');
  assert.equal(score.similarQuestionSource, 'assessment');
});

test('semantic match fires at or above the threshold', () => {
  // cosine([0.9, 0.1], [1, 0]) is well above 0.9.
  const score = scoreAgainstExisting('A brand new question', [0.9, 0.1], existing, 0.9);
  assert.equal(score.exactDuplicateOf, undefined);
  assert.ok((score.maxSimilarity ?? 0) >= 0.9, `score ${score.maxSimilarity} should clear 0.9`);
  assert.equal(score.similarQuestionId, 'q1');
});

test('semantic similarity below the threshold is ignored', () => {
  // cosine([0, 1], [1, 0]) = 0.
  const score = scoreAgainstExisting('Another new question', [0, 1], existing, 0.9);
  assert.deepEqual(score, {});
});

test('without a candidate embedding only the exact step runs', () => {
  const score = scoreAgainstExisting('Define Osmosis', null, existing, 0.5);
  assert.equal(score.exactDuplicateOf, 'Define osmosis.');
  assert.equal(score.similarQuestionId, 'q2');
  assert.equal(score.similarQuestionSource, 'bank');
});

test('embedding-less existing rows only participate in exact matching', () => {
  // Candidate embedding is orthogonal to q1's, so the semantic step finds
  // nothing — q2 has no embedding to join in, and no crash occurs.
  const score = scoreAgainstExisting('Something about diffusion', [0, 1], existing, 0.5);
  assert.deepEqual(score, {});
});

test('a dimension mismatch between sides is skipped, not fatal', () => {
  const score = scoreAgainstExisting(
    'Something new',
    [1, 0, 0],
    [{ question_text: 'legacy row', embedding: [1, 0], origin: 'assessment' }],
    0.5
  );
  assert.deepEqual(score, {});
});

test('an empty candidate never exact-matches', () => {
  const score = scoreAgainstExisting('', null, [{ question_text: '', embedding: null }], 0.9);
  assert.deepEqual(score, {});
});

test('batch-origin hits are attributed to the same run', () => {
  const score = scoreAgainstExisting(
    'Accepted a moment ago',
    null,
    [{ question_text: 'Accepted a moment ago', embedding: null, origin: 'batch' }],
    0.9
  );
  assert.equal(score.similarQuestionSource, 'batch');
});

// ---------------------------------------------------------------------------
// Prompt builder (shared by both providers)
// ---------------------------------------------------------------------------

const baseParams = {
  sourceTexts: ['unused when chunks are present'],
  topic: 'Cell biology',
  questionType: 'multiple_choice',
  count: 2,
  difficulty: 'moderate',
  bloomLevel: 'understand',
};

test('chunk labels and citation instructions appear when chunks are given', () => {
  const prompt = buildQuestionPrompt({
    ...baseParams,
    sourceChunks: [{ id: 'chunk-1', content: 'Photosynthesis converts light into chemical energy.' }],
  });
  assert.match(prompt, /\[chunk:chunk-1\]\nPhotosynthesis/);
  assert.match(prompt, /copy the ids exactly as shown/);
  assert.doesNotMatch(prompt, /leave as empty array \[\]/);
});

test('without chunks the prompt falls back to plain source text', () => {
  const prompt = buildQuestionPrompt({ ...baseParams, sourceTexts: ['Plain source text.'] });
  assert.match(prompt, /Plain source text\./);
  assert.match(prompt, /leave as empty array \[\]/);
  assert.doesNotMatch(prompt, /DUPLICATE AVOIDANCE/);
});

test('avoid-list section carries rejected questions verbatim', () => {
  const prompt = buildQuestionPrompt({
    ...baseParams,
    sourceChunks: [{ id: 'c1', content: 'text' }],
    avoidQuestionTexts: ['What is photosynthesis?'],
  });
  assert.match(prompt, /DUPLICATE AVOIDANCE/);
  assert.match(prompt, /- What is photosynthesis\?/);
  assert.match(prompt, /test a different fact or angle/);
});
