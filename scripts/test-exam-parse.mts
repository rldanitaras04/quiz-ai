/**
 * Fixture tests for src/lib/import/exam-parse.ts.
 *
 * Run: node scripts/test-exam-parse.mts
 * (Node ≥ 22.6 strips types natively; exam-parse imports only type-only
 * symbols so no path aliases are resolved at runtime.)
 */
import assert from 'node:assert';

type ParsedItem = {
  question_type: string;
  question_text: string;
  choices?: { choice_key: string; choice_text: string }[];
  correct_choice_key?: string;
  canonical_answer?: string;
};

// Imported through a runtime URL so tsc accepts the .ts extension.
const examParse = (await import(
  new URL('../src/lib/import/exam-parse.ts', import.meta.url).href
)) as {
  parseExamText: (
    raw: string,
    opts?: { allowMissingAnswers?: boolean }
  ) => { items: ParsedItem[]; errors: string[] };
  mergeAnswerKeyFile: (
    items: ParsedItem[],
    keyText: string
  ) => { items: ParsedItem[]; applied: number; stillMissing: number[] };
  itemMissingAnswer: (item: ParsedItem) => boolean;
};
const { parseExamText, mergeAnswerKeyFile, itemMissingAnswer } = examParse;

type Test = { name: string; run: () => void };
const tests: Test[] = [];
const t = (name: string, run: () => void) => tests.push({ name, run });

// ---------------------------------------------------------------- fixtures

t('numbered choices + numeric answer -> multiple_choice', () => {
  const { items, errors } = parseExamText(
    [
      '1. What is the capital of France?',
      '1. Paris',
      '2. London',
      '3. Berlin',
      '4. Madrid',
      'Answer: 1',
    ].join('\n')
  );
  assert.strictEqual(errors.length, 0, errors.join(' | '));
  assert.strictEqual(items.length, 1);
  const q = items[0];
  assert.strictEqual(q.question_type, 'multiple_choice');
  assert.strictEqual(q.question_text, 'What is the capital of France?');
  assert.deepStrictEqual(
    q.choices?.map((c) => c.choice_key),
    ['A', 'B', 'C', 'D']
  );
  assert.deepStrictEqual(
    q.choices?.map((c) => c.choice_text),
    ['Paris', 'London', 'Berlin', 'Madrid']
  );
  assert.strictEqual(q.correct_choice_key, 'A');
});

t('lettered choices, two questions with inline answers', () => {
  const { items, errors } = parseExamText(
    [
      '1. What is 2+2?',
      'A. 3',
      'B. 4',
      'C. 5',
      'Answer: B',
      '2. Which one is a fruit?',
      'A. Carrot',
      'B. Banana',
      'Answer: B',
    ].join('\n')
  );
  assert.strictEqual(errors.length, 0, errors.join(' | '));
  assert.strictEqual(items.length, 2);
  assert.strictEqual(items[0].correct_choice_key, 'B');
  assert.strictEqual(items[1].question_type, 'multiple_choice');
  assert.strictEqual(items[1].correct_choice_key, 'B');
  assert.strictEqual(items[1].choices?.[1].choice_text, 'Banana');
});

t('sectioned numbered choices ("1." restarts) with blank-line boundaries', () => {
  const { items, errors } = parseExamText(
    [
      '1. What is X?',
      '1. aaa',
      '2. bbb',
      '',
      '1. What is Y?',
      '1. ccc',
      '2. ddd',
      'Answer: 2',
    ].join('\n'),
    { allowMissingAnswers: true }
  );
  assert.strictEqual(errors.length, 0, errors.join(' | '));
  assert.strictEqual(items.length, 2);
  assert.strictEqual(items[0].question_type, 'multiple_choice');
  assert.strictEqual(items[0].question_text, 'What is X?');
  assert.strictEqual(items[0].correct_choice_key, undefined);
  assert.strictEqual(items[1].correct_choice_key, 'B');
  assert.strictEqual(items[1].choices?.[1].choice_text, 'ddd');
});

t('headerless trailing answer-key run is stripped and applied', () => {
  const { items, errors } = parseExamText(
    [
      '1. What is X?',
      'A. one',
      'B. two',
      '2. What is Y?',
      'A. three',
      'B. four',
      '',
      '1. B',
      '2. A',
    ].join('\n')
  );
  assert.strictEqual(errors.length, 0, errors.join(' | '));
  assert.strictEqual(items.length, 2, 'key rows must not become questions');
  assert.strictEqual(items[0].correct_choice_key, 'B');
  assert.strictEqual(items[1].correct_choice_key, 'A');
});

t('dense single-line trailing key is stripped and applied', () => {
  const { items, errors } = parseExamText(
    [
      '1. What is X?',
      'A. one',
      'B. two',
      '2. What is Y?',
      'A. three',
      'B. four',
      '',
      '1. B 2. A',
    ].join('\n')
  );
  assert.strictEqual(errors.length, 0, errors.join(' | '));
  assert.strictEqual(items.length, 2);
  assert.strictEqual(items[0].correct_choice_key, 'B');
  assert.strictEqual(items[1].correct_choice_key, 'A');
});

t('inline "Answer Key: 1. B 2. A" header', () => {
  const { items, errors } = parseExamText(
    [
      '1. What is X?',
      'A. one',
      'B. two',
      '2. What is Y?',
      'A. three',
      'B. four',
      'Answer Key: 1. B 2. A',
    ].join('\n')
  );
  assert.strictEqual(errors.length, 0, errors.join(' | '));
  assert.strictEqual(items.length, 2);
  assert.strictEqual(items[0].correct_choice_key, 'B');
  assert.strictEqual(items[1].correct_choice_key, 'A');
});

t('own-line "Answer Key:" header section', () => {
  const { items, errors } = parseExamText(
    [
      '1. What is X?',
      'A. one',
      'B. two',
      'Answer Key:',
      '1. B',
    ].join('\n')
  );
  assert.strictEqual(errors.length, 0, errors.join(' | '));
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].correct_choice_key, 'B');
});

t('DOCX-style packed choices on the stem line', () => {
  const { items, errors } = parseExamText(
    [
      '1. What is the largest planet? A. Earth  B. Mars  C. Jupiter',
      'Answer: C',
    ].join('\n')
  );
  assert.strictEqual(errors.length, 0, errors.join(' | '));
  assert.strictEqual(items.length, 1);
  const q = items[0];
  assert.strictEqual(q.question_type, 'multiple_choice');
  assert.strictEqual(q.question_text, 'What is the largest planet?');
  assert.deepStrictEqual(
    q.choices?.map((c) => c.choice_text),
    ['Earth', 'Mars', 'Jupiter']
  );
  assert.strictEqual(q.correct_choice_key, 'C');
});

t('question stem with inline numbered choices ("? 1. 3 2. 4 3. 5")', () => {
  const { items, errors } = parseExamText(
    ['1. What is 2+2? 1. 3 2. 4 3. 5', 'Answer: 2'].join('\n')
  );
  assert.strictEqual(errors.length, 0, errors.join(' | '));
  assert.strictEqual(items.length, 1);
  const q = items[0];
  assert.strictEqual(q.question_type, 'multiple_choice');
  assert.strictEqual(q.question_text, 'What is 2+2?');
  assert.deepStrictEqual(
    q.choices?.map((c) => c.choice_text),
    ['3', '4', '5']
  );
  assert.strictEqual(q.correct_choice_key, 'B');
});

t('true/false inferred from trailing "True or False" + answer', () => {
  const { items, errors } = parseExamText(
    ['1. The earth revolves around the sun. True or False', 'Answer: True'].join(
      '\n'
    )
  );
  assert.strictEqual(errors.length, 0, errors.join(' | '));
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].question_type, 'true_false');
  assert.strictEqual(items[0].correct_choice_key, 'T');
});

t('bulleted choices re-keyed A/B/C, numeric answer', () => {
  const { items, errors } = parseExamText(
    [
      '1. Which of these is a fruit?',
      '• Apple',
      '• Orange',
      '• Mango',
      'Answer: 2',
    ].join('\n')
  );
  assert.strictEqual(errors.length, 0, errors.join(' | '));
  assert.strictEqual(items.length, 1);
  const q = items[0];
  assert.strictEqual(q.question_type, 'multiple_choice');
  assert.deepStrictEqual(
    q.choices?.map((c) => c.choice_text),
    ['Apple', 'Orange', 'Mango']
  );
  assert.strictEqual(q.correct_choice_key, 'B');
});

t('CSV rows: question,A,B,C,D,answer', () => {
  const { items, errors } = parseExamText(
    ['Question,A,B,C,D,Answer', 'What is 2+2?,3,4,5,6,B'].join('\n')
  );
  assert.strictEqual(errors.length, 0, errors.join(' | '));
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].question_type, 'multiple_choice');
  assert.strictEqual(items[0].correct_choice_key, 'B');
});

t('no blanks / no answers / no "?" — question numbers disambiguated by lookahead', () => {
  const { items, errors } = parseExamText(
    [
      '1. First question text here',
      '1. a1',
      '2. b1',
      '3. c1',
      '4. d1',
      '2. Second question text here',
      '1. a2',
      '2. b2',
      '3. c2',
      '4. d2',
    ].join('\n'),
    { allowMissingAnswers: true }
  );
  assert.strictEqual(errors.length, 0, errors.join(' | '));
  assert.strictEqual(items.length, 2, `got ${items.length}: ${items.map((i) => i.question_text).join(' / ')}`);
  assert.strictEqual(items[0].question_text, 'First question text here');
  assert.strictEqual(items[1].question_text, 'Second question text here');
  assert.strictEqual(items[0].choices?.length, 4);
  assert.strictEqual(items[1].choices?.length, 4);
  assert.strictEqual(items[1].choices?.[3].choice_text, 'd2');
});

t('EOF immediately after choice "2." (documented visible-error behavior)', () => {
  const { items, errors } = parseExamText(
    ['1. Some question here', '1. aaa', '2. bbb'].join('\n'),
    { allowMissingAnswers: true }
  );
  // End-of-doc defaults to question (visible in review) rather than silently
  // swallowing a final stem; the split shows up as extra/odd items, not a crash.
  assert.strictEqual(items.length, 2);
  assert.strictEqual(items[0].question_text, 'Some question here');
  assert.strictEqual(items[1].question_text, 'bbb');
  void errors;
});

t('final single-letter choice line is not eaten by the key strip', () => {
  const { items, errors } = parseExamText(
    ['1. Pick one', '1. q', '2. w', '3. e', '4. A'].join('\n'),
    { allowMissingAnswers: true }
  );
  assert.strictEqual(errors.length, 0, errors.join(' | '));
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].choices?.length, 4, 'choice "4. A" must survive');
  assert.strictEqual(items[0].choices?.[3].choice_text, 'A');
});

t('question text "1. 5 kingdoms …" never becomes an answer key', () => {
  const { items } = parseExamText(
    [
      '1. 5 kingdoms exist in biology.',
      'A. one',
      'B. two',
      '2. Second?',
      'A. three',
      'B. four',
      'Answer: B',
    ].join('\n'),
    { allowMissingAnswers: true }
  );
  assert.strictEqual(items.length, 2);
  assert.strictEqual(items[0].correct_choice_key, undefined, 'must not invent key "5"');
  assert.strictEqual(items[1].correct_choice_key, 'B');
});

t('strict mode: multiple-choice without an answer key reports an error', () => {
  const { items, errors } = parseExamText(
    ['1. What is X?', 'A. one', 'B. two'].join('\n')
  );
  assert.strictEqual(items.length, 0);
  assert.strictEqual(errors.length, 1);
  assert.match(errors[0], /no answer key/);
});

t('allowMissingAnswers keeps the item without a key', () => {
  const { items } = parseExamText(
    ['1. What is X?', 'A. one', 'B. two'].join('\n'),
    { allowMissingAnswers: true }
  );
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].question_type, 'multiple_choice');
  assert.strictEqual(itemMissingAnswer(items[0]), true);
});

t('mergeAnswerKeyFile resolves a numeric key value', () => {
  const { items } = parseExamText(
    ['1. What is X?', 'A. one', 'B. two'].join('\n'),
    { allowMissingAnswers: true }
  );
  const merged = mergeAnswerKeyFile(items, '1. 2');
  assert.strictEqual(merged.applied, 1);
  assert.strictEqual(merged.stillMissing.length, 0);
  assert.strictEqual(merged.items[0].correct_choice_key, 'B');
});

t('empty input reports a clear error', () => {
  const { items, errors } = parseExamText('hello world\nnothing here');
  assert.strictEqual(items.length, 0);
  assert.strictEqual(errors.length, 1);
  assert.match(errors[0], /No questions found/);
});

t('lettered one-line choices without a digit question number (fallback path)', () => {
  const { items, errors } = parseExamText(
    [
      'What is the capital of France?',
      'A. Paris',
      'B. London',
      'C. Berlin',
      'Answer: A',
    ].join('\n')
  );
  assert.strictEqual(errors.length, 0, errors.join(' | '));
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].question_type, 'multiple_choice');
  assert.strictEqual(items[0].correct_choice_key, 'A');
});

// ---------------------------------------------------------------- runner

let failed = 0;
for (const { name, run } of tests) {
  try {
    run();
    console.log(`ok   ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL ${name}`);
    console.error(err);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
if (failed > 0) process.exit(1);
