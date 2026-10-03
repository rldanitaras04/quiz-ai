import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRecommendationPrompt,
  parseScoreRecommendation,
} from '../src/lib/ai/recommendation.ts';

// ---------------------------------------------------------------------------
// Prompt construction.
// ---------------------------------------------------------------------------

test('prompt carries the question, key, accepted answers and the student answer', () => {
  const { system, user } = buildRecommendationPrompt({
    questionText: 'Control center of the cell?',
    points: 2,
    canonicalAnswer: 'nucleus',
    acceptedAnswers: ['cell nucleus'],
    studentAnswer: 'nucelus',
  });

  // The reply contract must be explicit — the parser depends on it.
  assert.match(system, /ONLY one JSON object/);
  assert.match(system, /"verdict"/);
  assert.match(system, /"uncertain"/);

  assert.match(user, /Question: Control center of the cell\?/);
  assert.match(user, /Worth: 2 point\(s\)/);
  assert.match(user, /Expected answer: nucleus/);
  assert.match(user, /cell nucleus/);
  assert.match(user, /Student answer: nucelus/);
});

test('prompt degrades gracefully without a key or accepted answers', () => {
  const { user } = buildRecommendationPrompt({
    questionText: 'Open question?',
    points: 1,
    canonicalAnswer: null,
    acceptedAnswers: [],
    studentAnswer: 'their words',
  });
  assert.match(user, /no canonical answer on file/);
  assert.match(user, /Also accepted: \(none\)/);
  assert.match(user, /Student answer: their words/);
});

// ---------------------------------------------------------------------------
// Response parsing — scope §26: the recommendation is only useful if it can be
// read with confidence; anything ambiguous throws for a human retry.
// ---------------------------------------------------------------------------

test('parses a plain JSON object', () => {
  const r = parseScoreRecommendation(
    '{"verdict":"incorrect","confidence":0.8,"rationale":"Different organelle."}'
  );
  assert.equal(r.verdict, 'incorrect');
  assert.equal(r.confidence, 0.8);
  assert.equal(r.rationale, 'Different organelle.');
});

test('parses a markdown-fenced JSON object', () => {
  const r = parseScoreRecommendation(
    '```json\n{"verdict":"correct","confidence":1,"rationale":"Same thing."}\n```'
  );
  assert.equal(r.verdict, 'correct');
  assert.equal(r.confidence, 1);
});

test('parses JSON wrapped in prose', () => {
  const r = parseScoreRecommendation(
    'Here is my evaluation: {"verdict":"uncertain","confidence":0.5,"rationale":"Could go either way."} — hope that helps.'
  );
  assert.equal(r.verdict, 'uncertain');
  assert.equal(r.confidence, 0.5);
  assert.equal(r.rationale, 'Could go either way.');
});

test('verdict synonyms map onto the canonical three', () => {
  const cases = [
    ['right', 'correct'],
    ['match', 'correct'],
    ['wrong', 'incorrect'],
    ['needs_review', 'uncertain'],
    ['NEEDS REVIEW', 'uncertain'],
    ['Unsure', 'uncertain'],
    ['manual_review', 'uncertain'],
  ];
  for (const [raw, expected] of cases) {
    const r = parseScoreRecommendation(
      JSON.stringify({ verdict: raw, confidence: 0.7, rationale: 'x' })
    );
    assert.equal(r.verdict, expected, `verdict "${raw}" → ${expected}`);
  }
});

test('an unrecognized verdict throws instead of guessing', () => {
  assert.throws(
    () => parseScoreRecommendation('{"verdict":"maybe","confidence":0.5,"rationale":"x"}'),
    /Unrecognized verdict/
  );
  assert.throws(
    () => parseScoreRecommendation('{"confidence":0.5}'),
    /Unrecognized verdict/
  );
});

test('confidence is accepted as 0..1 or 0..100 and clamped into range', () => {
  assert.equal(parseScoreRecommendation(S({ confidence: 0.42 })).confidence, 0.42);
  assert.equal(parseScoreRecommendation(S({ confidence: 85 })).confidence, 0.85);
  assert.equal(parseScoreRecommendation(S({ confidence: 150 })).confidence, 1);
  assert.equal(parseScoreRecommendation(S({ confidence: -20 })).confidence, 0);
});

test('missing or non-numeric confidence throws', () => {
  assert.throws(() => parseScoreRecommendation(S({ confidence: 'high' })), /confidence/);
  assert.throws(() => parseScoreRecommendation('{"verdict":"correct"}'), /confidence/);
});

test('non-JSON and JSON-array replies throw', () => {
  assert.throws(() => parseScoreRecommendation('the student is right'), /No JSON object/);
  assert.throws(() => parseScoreRecommendation('{verdict: correct}'), /not valid JSON/);
  assert.throws(() => parseScoreRecommendation('[]'), /No JSON object/);
});

test('a missing rationale defaults to empty rather than throwing', () => {
  const r = parseScoreRecommendation('{"verdict":"correct","confidence":0.9}');
  assert.equal(r.rationale, '');
});

/** Build a full valid payload around a partial override. */
function S(overrides) {
  return JSON.stringify({
    verdict: 'correct',
    confidence: 0.9,
    rationale: 'matches the key',
    ...overrides,
  });
}
