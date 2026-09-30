import test from 'node:test';
import assert from 'node:assert/strict';

import { buildQuestionIdOrder } from '../src/lib/exam-order.ts';

const questions = [
  { id: 'q3', position: 3 },
  { id: 'q1', position: 1 },
  { id: 'q2', position: 2 },
];

test('keeps strict document order when not shuffling', () => {
  assert.deepEqual(buildQuestionIdOrder(questions), ['q1', 'q2', 'q3']);
  assert.deepEqual(buildQuestionIdOrder(questions, { shuffle: false }), ['q1', 'q2', 'q3']);
});

test('a null position is treated as the first question', () => {
  const withNull = [
    { id: 'a', position: null },
    { id: 'b', position: 1 },
    { id: 'c', position: 2 },
  ];
  assert.deepEqual(buildQuestionIdOrder(withNull), ['a', 'b', 'c']);
});

test('shuffling keeps the same questions, just in a different order', () => {
  const shuffled = buildQuestionIdOrder(questions, { shuffle: true });
  assert.equal(shuffled.length, questions.length);
  assert.deepEqual([...shuffled].sort(), ['q1', 'q2', 'q3']);
});

test('never mutates the caller array', () => {
  const input = [...questions];
  buildQuestionIdOrder(input, { shuffle: true });
  assert.deepEqual(input, questions);
});

test('an empty manifest yields an empty order', () => {
  assert.deepEqual(buildQuestionIdOrder([]), []);
  assert.deepEqual(buildQuestionIdOrder([], { shuffle: true }), []);
});
