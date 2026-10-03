import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTosPrompt,
  parseTosProposal,
  tosMarginals,
  tosPercent,
  validateTos,
} from '../src/lib/ai/tos.ts';

// ---------------------------------------------------------------------------
// Prompt construction (scope §10 inputs: topics, item counts, question types,
// difficulty distribution, Bloom's distribution).
// ---------------------------------------------------------------------------

const TARGETS = {
  topics: [
    { title: 'Cell Structure', description: 'organelles and functions' },
    { title: 'Genetics' },
  ],
  totalItems: 6,
  countPerType: { multiple_choice: 4, identification: 2, true_false: 0 },
  difficulty: { easy: 2, moderate: 3, difficult: 1 },
  bloom: {
    remember: 1,
    understand: 2,
    apply: 1,
    analyze: 1,
    evaluate: 1,
    create: 0,
  },
  assessmentCategory: 'quiz',
  sourceTitles: ['Chapter 1 notes'],
};

test('prompt carries every §10 input and the strict JSON contract', () => {
  const { system, user } = buildTosPrompt(TARGETS);

  assert.match(system, /ONLY one JSON object/);
  assert.match(system, /exactly/);
  assert.match(system, /"rows"/);

  assert.match(user, /Cell Structure; Genetics/);
  assert.match(user, /Cell Structure — organelles and functions/);
  assert.match(user, /Grand total: 6 items/);
  assert.match(user, /multiple_choice=4, identification=2, true_false=0/);
  assert.match(user, /easy=2, moderate=3, difficult=1/);
  assert.match(user, /remember=1.*create=0/);
  assert.match(user, /Assessment type: quiz/);
  assert.match(user, /Source material covered: Chapter 1 notes/);
});

test('prompt omits absent optional inputs', () => {
  const { user } = buildTosPrompt({
    topics: [{ title: 'T' }],
    totalItems: 1,
    countPerType: { multiple_choice: 1, identification: 0, true_false: 0 },
    difficulty: { easy: 1, moderate: 0, difficult: 0 },
    bloom: {
      remember: 1,
      understand: 0,
      apply: 0,
      analyze: 0,
      evaluate: 0,
      create: 0,
    },
  });
  assert.doesNotMatch(user, /Assessment type/);
  assert.doesNotMatch(user, /Source material/);
});

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const TOPICS = ['Cell Structure', 'Genetics'];

function row(overrides = {}) {
  return {
    topic: 'Cell Structure',
    question_type: 'multiple_choice',
    difficulty: 'moderate',
    bloom_level: 'understand',
    count: 2,
    ...overrides,
  };
}

test('parses a plain rows object', () => {
  const rows = parseTosProposal(JSON.stringify({ rows: [row()] }), TOPICS);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    topic: 'Cell Structure',
    question_type: 'multiple_choice',
    difficulty: 'moderate',
    bloom_level: 'understand',
    count: 2,
  });
});

test('parses a bare array and markdown-fenced JSON', () => {
  const rows = parseTosProposal('```json\n' + JSON.stringify([row()]) + '\n```', TOPICS);
  assert.equal(rows.length, 1);
});

test('parses JSON wrapped in prose', () => {
  const raw = 'Here you go: ' + JSON.stringify({ rows: [row()] }) + ' — enjoy!';
  const rows = parseTosProposal(raw, TOPICS);
  assert.equal(rows.length, 1);
});

test('drops rows with invented topics, bad enums or non-positive counts', () => {
  const rows = parseTosProposal(
    JSON.stringify({
      rows: [
        row({ topic: 'Quantum Chromodynamics' }), // not an allowed topic
        row({ question_type: 'essay' }), // bad type
        row({ difficulty: 'nightmarish' }), // bad difficulty
        row({ bloom_level: 'transcend' }), // bad bloom
        row({ count: 0 }), // no items
        row({ count: 'three' }), // not a number
        row(), // the one good row
      ],
    }),
    TOPICS
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].topic, 'Cell Structure');
});

test('topic matching is case-insensitive but resolves to the canonical title', () => {
  const rows = parseTosProposal(JSON.stringify({ rows: [row({ topic: '  genetics ' })] }), TOPICS);
  assert.equal(rows[0].topic, 'Genetics');
});

test('synonyms normalize onto the canonical enums', () => {
  const rows = parseTosProposal(
    JSON.stringify({
      rows: [
        row({ question_type: 'MCQ', difficulty: 'medium', bloom_level: 'Comprehension' }),
        row({ question_type: 'true_false', difficulty: 'hard', bloom_level: 'synthesis', count: 1 }),
      ],
    }),
    TOPICS
  );
  assert.equal(rows[0].question_type, 'multiple_choice');
  assert.equal(rows[0].difficulty, 'moderate');
  assert.equal(rows[0].bloom_level, 'understand');
  assert.equal(rows[1].question_type, 'true_false');
  assert.equal(rows[1].difficulty, 'difficult');
  assert.equal(rows[1].bloom_level, 'create');
});

test('duplicate combinations merge by summing counts', () => {
  const rows = parseTosProposal(
    JSON.stringify({ rows: [row({ count: 2 }), row({ count: 3 })] }),
    TOPICS
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].count, 5);
});

test('a proposal with no usable rows throws', () => {
  assert.throws(() => parseTosProposal('{"rows":[]}', TOPICS), /no usable rows/);
  assert.throws(
    () => parseTosProposal('{"rows":[{"topic":"Nope","count":1}]}', TOPICS),
    /no usable rows/
  );
});

test('garbage replies throw instead of returning an empty plan', () => {
  assert.throws(() => parseTosProposal('I could not produce a TOS.', TOPICS), /No JSON object/);
  assert.throws(() => parseTosProposal('{"rows": "not an array"}', TOPICS), /rows array/);
  assert.throws(() => parseTosProposal('{rows: broken', TOPICS), /not valid JSON/);
});

// ---------------------------------------------------------------------------
// Marginals, percentages, validation (scope §10: "validate totals and
// percentages")
// ---------------------------------------------------------------------------

test('marginals aggregate every dimension', () => {
  const m = tosMarginals([
    row({ count: 3 }),
    row({ topic: 'Genetics', difficulty: 'difficult', bloom_level: 'analyze', count: 2 }),
    row({ question_type: 'identification', count: 1 }),
  ]);
  assert.equal(m.totalItems, 6);
  assert.deepEqual(m.byType, { multiple_choice: 5, identification: 1 });
  assert.deepEqual(m.byDifficulty, { moderate: 4, difficult: 2 });
  assert.deepEqual(m.byTopic, { 'Cell Structure': 4, Genetics: 2 });
  assert.equal(m.byBloom.understand, 4);
  assert.equal(m.byBloom.analyze, 2);
});

test('percentages round to one decimal and guard a zero total', () => {
  assert.equal(tosPercent(1, 3), 33.3);
  assert.equal(tosPercent(2, 3), 66.7);
  assert.equal(tosPercent(1, 0), 0);
});

test('an empty TOS is a blocking problem', () => {
  const v = validateTos([]);
  assert.ok(v.problems.some((p) => /no rows/.test(p)));
  assert.equal(v.totalItems, 0);
});

test('a zero total or empty rows block approval', () => {
  const v = validateTos([row({ count: 0 })]);
  assert.ok(v.problems.length > 0);
});

test('a valid TOS has no problems', () => {
  const v = validateTos([row({ count: 6 })], {
    countPerType: { multiple_choice: 6, identification: 0, true_false: 0 },
    difficulty: { easy: 0, moderate: 6, difficult: 0 },
    bloom: { understand: 6 },
  });
  assert.deepEqual(v.problems, []);
  assert.deepEqual(v.warnings, []);
  assert.equal(v.totalItems, 6);
});

test('divergence from the generation config warns without blocking', () => {
  const v = validateTos([row({ count: 8 })], {
    countPerType: { multiple_choice: 10, identification: 0, true_false: 0 },
    difficulty: { easy: 4, moderate: 4, difficult: 2 },
    bloom: { understand: 10 },
  });
  assert.deepEqual(v.problems, []);
  assert.equal(v.warnings.length, 3); // types + difficulty + bloom
  assert.ok(v.warnings.every((w) => /approving will update the generation config/.test(w)));
});
