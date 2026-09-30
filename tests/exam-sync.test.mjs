import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeOperation, applyResponseOperations } from '../src/lib/exam-sync.ts';

const Q1 = '11111111-1111-4111-8111-111111111111';
const Q2 = '22222222-2222-4222-8222-222222222222';
const C1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const C2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const OP1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OP2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ATTEMPT = '99999999-9999-4999-8999-999999999999';

// ---------------------------------------------------------------------------
// normalizeOperation payload validation
// ---------------------------------------------------------------------------

test('normalizeOperation rejects malformed payloads', () => {
  assert.equal(normalizeOperation(null), null);
  assert.equal(normalizeOperation('nope'), null);
  assert.equal(normalizeOperation({ questionId: 'not-a-uuid' }), null);
  assert.equal(normalizeOperation({ questionId: Q1, clientRevision: -1 }), null);
  assert.equal(
    normalizeOperation({ questionId: Q1, selectedChoiceId: 'nope', clientRevision: 0 }),
    null
  );
  assert.equal(
    normalizeOperation({ questionId: Q1, textAnswer: 'x'.repeat(10_001), clientRevision: 0 }),
    null
  );
});

test('normalizeOperation accepts a well-formed operation', () => {
  const op = normalizeOperation({
    operationId: OP1,
    questionId: Q1,
    selectedChoiceId: C1,
    textAnswer: null,
    clientRevision: 3.7,
  });
  assert.ok(op);
  assert.equal(op.operationId, OP1);
  assert.equal(op.clientRevision, 3, 'fractional revisions are floored');
  assert.equal(op.selectedChoiceId, C1);
});

// ---------------------------------------------------------------------------
// Stateful Supabase mock for applyResponseOperations
// ---------------------------------------------------------------------------

function createAdmin({
  attemptStatus = 'in_progress',
  manifest = [Q1, Q2],
  choices = [
    { id: C1, question_id: Q1 },
    { id: C2, question_id: Q2 },
  ],
  responses = [],
  failNextUpdate = false,
} = {}) {
  const state = {
    responses: responses.map((r) => ({ ...r })),
    inserts: 0,
    updates: 0,
    failNextUpdate,
    admin: null,
  };

  const run = (q) => {
    const eqFilters = new Map();
    const inFilters = new Map();
    for (const [col, val, kind] of q.filters) {
      if (kind === 'in') inFilters.set(col, val);
      else eqFilters.set(col, val);
    }

    if (q.table === 'exam_attempts') {
      return { data: { id: ATTEMPT, status: attemptStatus }, error: null };
    }
    if (q.table === 'exam_manifests') {
      return { data: manifest ? { question_order: manifest } : null, error: null };
    }
    if (q.table === 'question_choices') {
      const wanted = inFilters.get('question_id') ?? [];
      return { data: choices.filter((c) => wanted.includes(c.question_id)), error: null };
    }
    if (q.table === 'student_responses') {
      if (q.op === 'select') {
        const wanted = inFilters.get('question_id');
        let rows = state.responses;
        if (eqFilters.has('attempt_id')) {
          rows = rows.filter((r) => r.attempt_id === eqFilters.get('attempt_id'));
        }
        if (wanted) rows = rows.filter((r) => wanted.includes(r.question_id));
        if (eqFilters.has('id')) rows = rows.filter((r) => r.id === eqFilters.get('id'));
        return { data: rows.map((r) => ({ ...r })), error: null };
      }
      if (q.op === 'update') {
        const id = eqFilters.get('id');
        const guard = eqFilters.has('server_revision')
          ? eqFilters.get('server_revision')
          : undefined;
        const row = state.responses.find((r) => r.id === id);
        if (state.failNextUpdate) {
          state.failNextUpdate = false;
          return { data: null, error: { message: 'conflict' } };
        }
        // Optimistic guard: the WHERE server_revision = ... clause.
        if (!row || (guard !== undefined && row.server_revision !== guard)) {
          return { data: null, error: { message: 'conflict' } };
        }
        Object.assign(row, q.values);
        state.updates += 1;
        return { data: { server_revision: row.server_revision }, error: null };
      }
      if (q.op === 'insert') {
        state.inserts += 1;
        const row = { id: `sr-${state.inserts}`, ...q.values };
        state.responses.push(row);
        return { data: { server_revision: row.server_revision }, error: null };
      }
    }
    return { data: null, error: { message: `unexpected table ${q.table}` } };
  };

  const admin = {
    state,
    from(table) {
      const q = {
        table,
        op: 'select',
        filters: [],
        values: null,
        select() {
          return q;
        },
        update(values) {
          q.op = 'update';
          q.values = values;
          return q;
        },
        insert(values) {
          q.op = 'insert';
          q.values = values;
          return q;
        },
        eq(col, val) {
          q.filters.push([col, val]);
          return q;
        },
        in(col, vals) {
          q.filters.push([col, vals, 'in']);
          return q;
        },
        maybeSingle() {
          return Promise.resolve(run(q));
        },
        single() {
          return Promise.resolve(run(q));
        },
        then(onFulfilled, onRejected) {
          return Promise.resolve(run(q)).then(onFulfilled, onRejected);
        },
      };
      return q;
    },
  };
  state.admin = admin;
  return admin;
}

function op(overrides) {
  return {
    operationId: OP1,
    questionId: Q1,
    selectedChoiceId: C1,
    textAnswer: null,
    clientRevision: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// applyResponseOperations
// ---------------------------------------------------------------------------

test('a new answer is inserted with server_revision 1', async () => {
  const admin = createAdmin();
  const result = await applyResponseOperations(admin, ATTEMPT, [op({})]);
  assert.deepEqual(result.applied, [Q1]);
  assert.deepEqual(result.rejected, []);
  assert.equal(result.serverRevisions[Q1], 1);
  assert.equal(admin.state.inserts, 1);
  assert.equal(admin.state.responses[0].last_operation_id, OP1);
});

test('replaying the same operationId is acknowledged without a second write', async () => {
  const admin = createAdmin();
  await applyResponseOperations(admin, ATTEMPT, [op({})]);
  const replay = await applyResponseOperations(admin, ATTEMPT, [op({})]);

  assert.deepEqual(replay.duplicates, [Q1]);
  assert.deepEqual(replay.applied, []);
  assert.equal(replay.serverRevisions[Q1], 1, 'revision unchanged by the retry');
  assert.equal(admin.state.inserts, 1, 'exactly one logical write');
});

test('a stale operation is refused and the server revision is returned', async () => {
  const admin = createAdmin({
    responses: [
      {
        id: 'sr-1',
        attempt_id: ATTEMPT,
        question_id: Q1,
        selected_choice_id: C1,
        server_revision: 5,
        last_operation_id: OP2,
      },
    ],
  });
  const result = await applyResponseOperations(admin, ATTEMPT, [op({ clientRevision: 4 })]);

  assert.deepEqual(result.rejected, [Q1]);
  assert.equal(result.serverRevisions[Q1], 5, 'the caller learns the authoritative revision');
  assert.equal(admin.state.updates, 0, 'stale data must never overwrite server state');
});

test('a concurrent writer wins the optimistic guard and the loser is rejected', async () => {
  const admin = createAdmin({
    responses: [
      {
        id: 'sr-1',
        attempt_id: ATTEMPT,
        question_id: Q1,
        selected_choice_id: C1,
        server_revision: 3,
        last_operation_id: OP2,
      },
    ],
    failNextUpdate: true,
  });
  const result = await applyResponseOperations(admin, ATTEMPT, [op({ clientRevision: 3 })]);

  assert.deepEqual(result.rejected, [Q1]);
  assert.ok(result.serverRevisions[Q1] >= 3, 'fresh revision is reported to the caller');
});

test('questions outside the attempt manifest are never written', async () => {
  const admin = createAdmin({ manifest: [Q1] });
  const result = await applyResponseOperations(admin, ATTEMPT, [
    op({ questionId: Q2, selectedChoiceId: C2, operationId: OP2 }),
  ]);

  assert.deepEqual(result.rejected, [Q2]);
  assert.equal(admin.state.inserts, 0);
  assert.equal(admin.state.updates, 0);
});

test('a choice from another question is refused', async () => {
  const admin = createAdmin();
  const result = await applyResponseOperations(admin, ATTEMPT, [
    op({ selectedChoiceId: C2 }),
  ]);

  assert.deepEqual(result.rejected, [Q1]);
  assert.equal(admin.state.inserts, 0);
});

test('nothing is applied once the attempt is no longer in_progress', async () => {
  for (const status of ['submitted', 'invalidated', 'timed_out']) {
    const admin = createAdmin({ attemptStatus: status });
    const result = await applyResponseOperations(admin, ATTEMPT, [op({})]);
    assert.deepEqual(result.rejected, [Q1], `${status} refuses writes`);
    assert.equal(admin.state.inserts, 0);
    assert.equal(admin.state.updates, 0);
  }
});

test('an update bumps server_revision and records the new operation id', async () => {
  const admin = createAdmin({
    responses: [
      {
        id: 'sr-1',
        attempt_id: ATTEMPT,
        question_id: Q1,
        selected_choice_id: null,
        server_revision: 2,
        last_operation_id: OP2,
      },
    ],
  });
  const result = await applyResponseOperations(admin, ATTEMPT, [
    op({ clientRevision: 2, operationId: OP1 }),
  ]);

  assert.deepEqual(result.applied, [Q1]);
  assert.equal(result.serverRevisions[Q1], 3);
  assert.equal(admin.state.responses[0].last_operation_id, OP1);
  assert.equal(admin.state.responses[0].selected_choice_id, C1);
});

test('an empty operation list is a no-op', async () => {
  const admin = createAdmin();
  const result = await applyResponseOperations(admin, ATTEMPT, []);
  assert.deepEqual(result.applied, []);
  assert.deepEqual(result.rejected, []);
  assert.equal(admin.state.inserts, 0);
});
