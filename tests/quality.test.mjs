import test from 'node:test';
import assert from 'node:assert/strict';

import {
  dimensionCounts,
  exactDuplicates,
  groundingCoverage,
  semanticSimilarityFlags,
  tosAlignment,
  validateQualityQuestions,
} from '../src/lib/quality.ts';

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

function q(overrides = {}) {
  return {
    id: 'q1',
    position: 1,
    question_type: 'multiple_choice',
    question_text: 'Which organelle produces ATP in the cell?',
    difficulty: 'easy',
    bloom_level: 'remember',
    points: 1,
    topic_title: 'Cell Biology',
    choice_count: 4,
    has_correct_choice: true,
    has_canonical_answer: false,
    grounded: false,
    embedding: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Validation issues (§31 pre-exam)
// ---------------------------------------------------------------------------

test('validation flags unanswerable questions and passes sound ones', () => {
  const issues = validateQualityQuestions([q()]);
  assert.deepEqual(issues, []);

  const broken = validateQualityQuestions([
    q({ id: 'a', has_correct_choice: false, choice_count: 1 }),
    q({ id: 'b', question_type: 'identification', has_canonical_answer: false }),
    q({ id: 'c', question_text: 'Too short', points: 0 }),
    q({ id: 'd', question_text: '   ' }),
  ]);
  assert.equal(broken.length, 4); // every fixture above is broken on purpose
  const byId = Object.fromEntries(broken.map(i => [i.question_id, i.issues]));
  assert.match(byId.a.join(' '), /at least two choices/);
  assert.match(byId.a.join(' '), /No correct choice/);
  assert.match(byId.b.join(' '), /canonical answer/);
  assert.match(byId.c.join(' '), /at least 1/);
  assert.match(byId.d.join(' '), /too short/);
});

test('validation carries position for display', () => {
  const [issue] = validateQualityQuestions([q({ position: 7, points: 0 })]);
  assert.equal(issue.position, 7);
  assert.ok(issue.issues.length > 0);
});

// ---------------------------------------------------------------------------
// Distributions (§31 difficulty/Bloom distributions)
// ---------------------------------------------------------------------------

test('dimensionCounts groups, labels untagged topics, and sorts', () => {
  const questions = [
    q({ id: '1', difficulty: 'easy' }),
    q({ id: '2', difficulty: 'difficult' }),
    q({ id: '3', difficulty: 'easy' }),
  ];
  assert.deepEqual(dimensionCounts(questions, 'difficulty'), [
    { key: 'difficult', count: 1 },
    { key: 'easy', count: 2 },
  ]);

  const withTopics = [q({ topic_title: null }), q({ topic_title: null }), q({ topic_title: 'DNA' })];
  assert.deepEqual(dimensionCounts(withTopics, 'topic_title'), [
    { key: '(untagged)', count: 2 },
    { key: 'DNA', count: 1 },
  ]);
});

// ---------------------------------------------------------------------------
// Duplicates and similarity (§31 exact duplicate count + semantic flags)
// ---------------------------------------------------------------------------

test('exactDuplicates groups questions whose normalized text matches', () => {
  const questions = [
    q({ id: 'a', position: 1, question_text: 'What is DNA?' }),
    q({ id: 'b', position: 4, question_text: '  what is dna!! ' }),
    q({ id: 'c', position: 2, question_text: 'A completely different question about RNA.' }),
  ];
  const groups = exactDuplicates(questions);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].question_ids, ['a', 'b']);
  assert.deepEqual(groups[0].positions, [1, 4]);

  assert.deepEqual(exactDuplicates([q(), q({ id: 'x', question_text: 'Another unique one?' })]), []);
});

test('semanticSimilarityFlags only pairs at/above the threshold, skipping unembedded', () => {
  const questions = [
    q({ id: 'a', position: 1, embedding: [1, 0] }),
    q({ id: 'b', position: 2, embedding: [1, 0] }), // identical → 1.0
    q({ id: 'c', position: 3, embedding: [0, 1] }), // orthogonal → 0
    q({ id: 'd', position: 4, embedding: null }), // skipped
    q({ id: 'e', position: 5, embedding: [0.9, 0.1] }), // ~0.99 with a/b
  ];
  const flags = semanticSimilarityFlags(questions, 0.9);
  assert.ok(flags.length >= 2);
  assert.ok(flags.every(f => f.score >= 0.9));
  assert.ok(flags.every(f => ![f.a_id, f.b_id].includes('d')));
  // Sorted by score, descending.
  for (let i = 1; i < flags.length; i += 1) {
    assert.ok(flags[i - 1].score >= flags[i].score);
  }

  // A stricter threshold drops the sub-threshold pair.
  const strict = semanticSimilarityFlags(questions, 0.999);
  assert.ok(strict.length < flags.length);
  assert.ok(strict.every(f => f.score >= 0.999));
});

// ---------------------------------------------------------------------------
// Source grounding (§31)
// ---------------------------------------------------------------------------

test('groundingCoverage reports grounded share to one decimal', () => {
  const questions = [
    q({ id: '1', grounded: true }),
    q({ id: '2', grounded: true }),
    q({ id: '3', grounded: false }),
    q({ id: '4', grounded: false }),
  ];
  assert.deepEqual(groundingCoverage(questions), { grounded: 2, total: 4, percentage: 50 });
  assert.deepEqual(groundingCoverage([]), { grounded: 0, total: 0, percentage: 0 });
  assert.equal(groundingCoverage([q({ grounded: true })]).percentage, 100);
});

// ---------------------------------------------------------------------------
// TOS alignment (§31)
// ---------------------------------------------------------------------------

const TOS_ROWS = [
  { topic: 'Cell Biology', question_type: 'multiple_choice', difficulty: 'easy', bloom_level: 'remember', count: 2 },
  { topic: 'Genetics', question_type: 'identification', difficulty: 'difficult', bloom_level: 'analyze', count: 1 },
];

test('a matching assessment aligns perfectly with its approved TOS', () => {
  const questions = [
    q({ id: '1', topic_title: 'Cell Biology', question_type: 'multiple_choice', difficulty: 'easy', bloom_level: 'remember' }),
    q({ id: '2', topic_title: 'Cell Biology', question_type: 'multiple_choice', difficulty: 'easy', bloom_level: 'remember' }),
    q({ id: '3', topic_title: 'Genetics', question_type: 'identification', difficulty: 'difficult', bloom_level: 'analyze' }),
  ];
  const alignment = tosAlignment({ rows: TOS_ROWS }, questions);
  assert.equal(alignment.approved, true);
  assert.equal(alignment.expected_items, 3);
  assert.equal(alignment.actual_items, 3);
  assert.deepEqual(alignment.mismatches, []);
});

test('mismatches are reported per dimension with expected vs actual', () => {
  const questions = [
    // Only one question; wrong type, untagged topic.
    q({ id: '1', topic_title: null, question_type: 'identification', difficulty: 'easy', bloom_level: 'remember' }),
  ];
  const alignment = tosAlignment({ rows: TOS_ROWS }, questions);
  assert.equal(alignment.approved, true);
  const dims = new Set(alignment.mismatches.map(m => m.dimension));
  assert.ok(dims.has('total'));
  assert.ok(dims.has('type'));
  assert.ok(dims.has('topic'));
  const total = alignment.mismatches.find(m => m.dimension === 'total');
  assert.equal(total.expected, 3);
  assert.equal(total.actual, 1);
  const topic = alignment.mismatches.find(m => m.dimension === 'topic');
  assert.equal(topic.key, 'Cell Biology');
  assert.equal(topic.expected, 2);
  assert.equal(topic.actual, 0);
});

test('without an approved TOS there is nothing to align', () => {
  const alignment = tosAlignment(null, [q()]);
  assert.equal(alignment.approved, false);
  assert.deepEqual(alignment.mismatches, []);
  assert.equal(alignment.actual_items, 1);

  const empty = tosAlignment({ rows: [] }, []);
  assert.equal(empty.approved, true); // rows present, trivially aligned
  assert.deepEqual(empty.mismatches, []);
});
