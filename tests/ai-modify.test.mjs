import test from 'node:test';
import assert from 'node:assert/strict';

import { buildModifyPrompt, parseModifyProposals } from '../src/lib/ai/modify.ts';

// ---------------------------------------------------------------------------
// Prompt (scope §16: assessment-scoped assistant over the current questions)
// ---------------------------------------------------------------------------

const QUESTIONS = [
  {
    id: 'q1',
    position: 1,
    question_type: 'multiple_choice',
    question_text: 'Which organelle produces ATP? '.repeat(30),
    difficulty: 'easy',
    bloom_level: 'remember',
    points: 2,
    choices: [
      { choice_key: 'A', choice_text: 'Mitochondrion', correct: true },
      { choice_key: 'B', choice_text: 'Ribosome' },
    ],
  },
  {
    id: 'q2',
    position: 2,
    question_type: 'identification',
    question_text: 'Name the process of cell division.',
    difficulty: 'moderate',
    bloom_level: 'understand',
    points: 5,
    canonical_answer: 'mitosis',
  },
];

test('prompt carries the instruction and every question field the model needs', () => {
  const { system, user } = buildModifyPrompt({
    questions: QUESTIONS,
    instruction: 'Make items 1-2 more difficult.',
  });

  assert.match(system, /ONLY one JSON object/);
  assert.match(system, /"proposals"/);
  assert.match(system, /Never change question_type/);
  assert.match(system, /correct_choice_key/);

  assert.match(user, /Instruction: Make items 1-2 more difficult\./);
  assert.match(user, /#1 id=q1 \[multiple_choice\] difficulty=easy bloom=remember points=2/);
  assert.match(user, /A\) Mitochondrion \(correct\)/);
  assert.match(user, /B\) Ribosome/);
  assert.match(user, /#2 id=q2 \[identification\]/);
  assert.match(user, /answer: mitosis/);
});

test('prompt truncates runaway question text', () => {
  const { user } = buildModifyPrompt({ questions: QUESTIONS, instruction: 'x' });
  assert.ok(user.length < 3000, `prompt too long: ${user.length}`);
});

// ---------------------------------------------------------------------------
// Parsing (proposal validation — never touch unknown questions, never emit
// fields updateQuestion/addQuestion cannot apply safely)
// ---------------------------------------------------------------------------

const IDS = ['q1', 'q2'];
const TYPES = { q1: 'multiple_choice', q2: 'identification' };

function update(overrides = {}) {
  return {
    op: 'update',
    question_id: 'q1',
    fields: { difficulty: 'difficult' },
    rationale: 'Instruction asked for it.',
    ...overrides,
  };
}

test('parses valid update/add/delete proposals', () => {
  const { proposals, dropped } = parseModifyProposals(
    JSON.stringify({
      proposals: [
        update(),
        {
          op: 'add',
          question_id: null,
          fields: {
            question_type: 'identification',
            question_text: 'Define osmosis.',
            canonical_answer: 'diffusion of water',
          },
          rationale: 'New item.',
        },
        { op: 'delete', question_id: 'q2', fields: {}, rationale: 'Duplicate.' },
      ],
    }),
    IDS,
    TYPES
  );

  assert.deepEqual(dropped, []);
  assert.equal(proposals.length, 3);
  assert.equal(proposals[0].op, 'update');
  assert.equal(proposals[1].fields.question_type, 'identification');
  assert.equal(proposals[2].question_id, 'q2');
  assert.deepEqual(proposals[2].fields, {});
});

test('parses fenced and prose-wrapped replies', () => {
  const fenced = '```json\n' + JSON.stringify({ proposals: [update()] }) + '\n```';
  const prose = 'Sure! Here it is: ' + JSON.stringify({ proposals: [update()] }) + ' Let me know.';
  assert.equal(parseModifyProposals(fenced, IDS, TYPES).proposals.length, 1);
  assert.equal(parseModifyProposals(prose, IDS, TYPES).proposals.length, 1);
});

test('drops proposals that reference unknown questions or ops', () => {
  const { proposals, dropped } = parseModifyProposals(
    JSON.stringify({
      proposals: [
        update({ question_id: 'q999' }),
        { op: 'rewrite', question_id: 'q1', fields: { difficulty: 'hard' } },
        'not an object',
      ],
    }),
    IDS,
    TYPES
  );
  assert.equal(proposals.length, 0);
  assert.equal(dropped.length, 3);
  assert.match(dropped[0].reason, /does not exist/);
  assert.match(dropped[1].reason, /unknown op/);
  assert.match(dropped[2].reason, /not an object/);
});

test('updates cannot change question_type (and unconfirmed types are dropped)', () => {
  const changed = parseModifyProposals(
    JSON.stringify({ proposals: [update({ fields: { question_type: 'identification' } })] }),
    IDS,
    TYPES
  );
  assert.equal(changed.proposals.length, 0);
  assert.match(changed.dropped[0].reason, /question_type changes/);

  const unknownCurrent = parseModifyProposals(
    JSON.stringify({ proposals: [update({ fields: { question_type: 'identification' } })] }),
    IDS,
    {} // no current-type knowledge → safe-by-default drop
  );
  assert.equal(unknownCurrent.proposals.length, 0);
  assert.match(unknownCurrent.dropped[0].reason, /cannot confirm question_type/);

  const sameType = parseModifyProposals(
    JSON.stringify({ proposals: [update({ fields: { question_type: 'multiple_choice' } })] }),
    IDS,
    TYPES
  );
  assert.equal(sameType.proposals.length, 1);
});

test('points must be whole numbers in 1..100; junk fields are dropped', () => {
  const ok = parseModifyProposals(
    JSON.stringify({ proposals: [update({ fields: { points: 2.6, question_text: ' New text ' } })] }),
    IDS,
    TYPES
  );
  assert.equal(ok.proposals[0].fields.points, 3);
  assert.equal(ok.proposals[0].fields.question_text, 'New text');

  for (const points of [0, -1, 101, 'lots']) {
    const r = parseModifyProposals(
      JSON.stringify({ proposals: [update({ fields: { points } })] }),
      IDS,
      TYPES
    );
    assert.equal(r.proposals.length, 0, `points ${points} should drop`);
    assert.match(r.dropped[0].reason, /points out of range/);
  }

  const empty = parseModifyProposals(
    JSON.stringify({ proposals: [update({ fields: {} })] }),
    IDS,
    TYPES
  );
  assert.equal(empty.proposals.length, 0);
  assert.match(empty.dropped[0].reason, /no usable fields/);
});

test('choice updates need 2+ unique choices AND a matching correct key', () => {
  const goodChoices = [
    { choice_key: 'A', choice_text: 'Nucleus' },
    { choice_key: 'B', choice_text: 'Cytoplasm' },
  ];
  const ok = parseModifyProposals(
    JSON.stringify({
      proposals: [update({ fields: { choices: goodChoices, correct_choice_key: 'B' } })],
    }),
    IDS,
    TYPES
  );
  assert.equal(ok.proposals.length, 1);
  assert.equal(ok.proposals[0].fields.correct_choice_key, 'B');

  const variants = [
    [{ choices: goodChoices }, /correct_choice_key/], // no key at all
    [{ choices: goodChoices, correct_choice_key: 'Z' }, /correct_choice_key/], // key not among choices
    [{ choices: [goodChoices[0]], correct_choice_key: 'A' }, /2\+ unique/], // only one choice
    [{ choices: [{ choice_key: 'A', choice_text: 'x' }, { choice_key: 'A', choice_text: 'y' }], correct_choice_key: 'A' }, /2\+ unique/], // dup keys
    [{ correct_choice_key: 'A' }, /correct_choice_key without choices/], // key with no list
  ];
  for (const [fields, pattern] of variants) {
    const r = parseModifyProposals(JSON.stringify({ proposals: [update({ fields })] }), IDS, TYPES);
    assert.equal(r.proposals.length, 0, `should drop: ${JSON.stringify(fields)}`);
    assert.match(r.dropped[0].reason, pattern);
  }
});

test('adds enforce type-appropriate answer keys and default question_type', () => {
  const add = (fields) => ({ op: 'add', question_id: null, fields, rationale: 'x' });

  // MCQ add without choices → dropped
  const mcqNoChoices = parseModifyProposals(
    JSON.stringify({ proposals: [add({ question_text: 'Pick one.' })] }),
    IDS,
    TYPES
  );
  assert.equal(mcqNoChoices.proposals.length, 0);
  assert.match(mcqNoChoices.dropped[0].reason, /multiple_choice adds need choices/);

  // identification add without canonical → dropped
  const idNoAnswer = parseModifyProposals(
    JSON.stringify({
      proposals: [add({ question_type: 'identification', question_text: 'Name it.' })],
    }),
    IDS,
    TYPES
  );
  assert.equal(idNoAnswer.proposals.length, 0);
  assert.match(idNoAnswer.dropped[0].reason, /canonical_answer/);

  // valid MCQ add (explicit type) passes
  const mcq = parseModifyProposals(
    JSON.stringify({
      proposals: [
        add({
          question_type: 'multiple_choice',
          question_text: 'Pick one.',
          choices: [
            { choice_key: 'A', choice_text: 'Yes' },
            { choice_key: 'B', choice_text: 'No' },
          ],
          correct_choice_key: 'A',
        }),
      ],
    }),
    IDS,
    TYPES
  );
  assert.equal(mcq.proposals.length, 1);

  // missing type defaults to multiple_choice → so it still needs choices
  const defaulted = parseModifyProposals(
    JSON.stringify({ proposals: [add({ question_text: 'Bare add.' })] }),
    IDS,
    TYPES
  );
  assert.equal(defaulted.proposals.length, 0);
});

test('identification updates keep canonical/accepted answers', () => {
  const { proposals } = parseModifyProposals(
    JSON.stringify({
      proposals: [
        update({
          question_id: 'q2',
          fields: { canonical_answer: 'mitosis', accepted_answers: ['cell division'] },
        }),
      ],
    }),
    IDS,
    TYPES
  );
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].fields.canonical_answer, 'mitosis');
  assert.deepEqual(proposals[0].fields.accepted_answers, ['cell division']);

  const emptyCanonical = parseModifyProposals(
    JSON.stringify({ proposals: [update({ question_id: 'q2', fields: { canonical_answer: '  ' } })] }),
    IDS,
    TYPES
  );
  assert.equal(emptyCanonical.proposals.length, 0);
});

test('duplicates collapse to one proposal; rationales are sanitized', () => {
  const dup = parseModifyProposals(
    JSON.stringify({ proposals: [update(), update()] }),
    IDS,
    TYPES
  );
  assert.equal(dup.proposals.length, 1);
  assert.match(dup.dropped[0].reason, /duplicate/);

  const numRationale = parseModifyProposals(
    JSON.stringify({ proposals: [update({ rationale: 42, fields: { difficulty: 'moderate' } })] }),
    IDS,
    TYPES
  );
  assert.equal(numRationale.proposals.length, 1);
  assert.equal(numRationale.proposals[0].rationale, '');
});

test('unreadable replies throw; an empty proposals array is legal', () => {
  assert.throws(() => parseModifyProposals('No changes needed.', IDS), /No JSON object/);
  assert.throws(() => parseModifyProposals('{oops', IDS), /not valid JSON/);
  assert.throws(() => parseModifyProposals('{"changes":[]}', IDS), /proposals array/);

  const empty = parseModifyProposals('{"proposals":[]}', IDS, TYPES);
  assert.deepEqual(empty.proposals, []);
  assert.deepEqual(empty.dropped, []);
});
