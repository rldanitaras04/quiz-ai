'use client';

/**
 * Durable examination response storage + synchronization queue (IndexedDB).
 *
 * Rules this module exists to enforce:
 *   - an answer is NEVER kept only in React state: it is written to IndexedDB
 *     synchronously-ish (before any network attempt) so power/browser loss can
 *     never lose it;
 *   - every local save creates an operation with a unique `operationId`; the
 *     server stores it so a lost acknowledgement can be retried idempotently;
 *   - "saved locally" and "synced" are different states — a record is only
 *     `synced` after the server has acknowledged THIS operation;
 *   - the examination session token also lives here (per attempt) so a reload
 *     or device restart resumes the same server-side session instead of
 *     tripping the concurrent-session policy.
 *
 * Statuses surfaced to the student (see the exam page):
 *   saving → saved locally → syncing → synced
 *   offline — saved on this device / sync pending / sync error
 */

const DB_NAME = 'quiz-ai-exam';
const DB_VERSION = 2;
const ANSWERS_STORE = 'answers';
const SESSIONS_STORE = 'sessions';

export type SyncStatus = 'pending' | 'synced' | 'error';

export interface StoredAnswer {
  attemptId: string;
  questionId: string;
  selectedChoiceId: string | null;
  textAnswer: string | null;
  clientRevision: number;
  /** Unique identity of the latest local operation (idempotency key). */
  operationId: string;
  syncStatus: SyncStatus;
  savedAt: string;
  syncedAt: string | null;
  syncAttempts: number;
  lastError: string | null;
}

export interface StoredExamSession {
  attemptId: string;
  sessionId: string;
  sessionToken: string;
  savedAt: string;
  /** False while a session is live; cleared on clean submit. */
  open: boolean;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(ANSWERS_STORE)) {
        const store = db.createObjectStore(ANSWERS_STORE, { keyPath: ['attemptId', 'questionId'] });
        store.createIndex('attemptId', 'attemptId', { unique: false });
      }
      if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
        db.createObjectStore(SESSIONS_STORE, { keyPath: 'attemptId' });
      }
    };
  });
}

function newOperationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for very old browsers: still unique enough for idempotency.
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random()
    .toString(16)
    .slice(2)}`;
}

/**
 * Durably persist one answer and enqueue its operation. Always resolves only
 * after the IndexedDB transaction completes — the caller may then show
 * "Saved Locally" truthfully.
 */
export async function saveAnswerLocally(
  attemptId: string,
  questionId: string,
  selectedChoiceId: string | null,
  textAnswer: string | null
): Promise<StoredAnswer> {
  const db = await openDB();
  const tx = db.transaction(ANSWERS_STORE, 'readwrite');
  const store = tx.objectStore(ANSWERS_STORE);

  const existing = await new Promise<StoredAnswer | undefined>((resolve, reject) => {
    const req = store.get([attemptId, questionId]);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  const record: StoredAnswer = {
    attemptId,
    questionId,
    selectedChoiceId,
    textAnswer,
    clientRevision: (existing?.clientRevision ?? 0) + 1,
    operationId: newOperationId(),
    syncStatus: 'pending',
    savedAt: new Date().toISOString(),
    syncedAt: null,
    syncAttempts: existing?.syncAttempts ?? 0,
    lastError: null,
  };

  store.put(record);

  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

  return record;
}

export async function getLocalAnswers(attemptId: string): Promise<StoredAnswer[]> {
  const db = await openDB();
  const tx = db.transaction(ANSWERS_STORE, 'readonly');
  const store = tx.objectStore(ANSWERS_STORE);
  const index = store.index('attemptId');

  return new Promise((resolve, reject) => {
    const req = index.getAll(attemptId);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Records that the server has not acknowledged yet (or that failed). */
export async function getPendingOperations(attemptId: string): Promise<StoredAnswer[]> {
  const answers = await getLocalAnswers(attemptId);
  return answers.filter((a) => a.syncStatus !== 'synced');
}

export async function countPendingSync(attemptId: string): Promise<number> {
  return (await getPendingOperations(attemptId)).length;
}

export interface SyncOperationPayload {
  operationId: string;
  questionId: string;
  selectedChoiceId: string | null;
  textAnswer: string | null;
  clientRevision: number;
}

export function toSyncPayload(records: StoredAnswer[]): SyncOperationPayload[] {
  return records.map((r) => ({
    operationId: r.operationId,
    questionId: r.questionId,
    selectedChoiceId: r.selectedChoiceId,
    textAnswer: r.textAnswer,
    clientRevision: r.clientRevision,
  }));
}

export interface SyncResponse {
  success: boolean;
  serverRevisions: Record<string, number>;
  applied?: string[];
  duplicates?: string[];
  rejected?: string[];
  syncedAt?: string;
}

export async function syncOperationsToServer(
  attemptId: string,
  sessionId: string,
  sessionToken: string,
  operations: SyncOperationPayload[]
): Promise<SyncResponse> {
  const response = await fetch('/api/exam/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attemptId, sessionId, sessionToken, operations }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) {
    throw new Error(payload?.error ?? `Sync failed (${response.status})`);
  }
  return payload as SyncResponse;
}

/**
 * Mark records as synchronized — only when the acknowledged operationId is
 * still the latest one for that question (a save made during the request
 * keeps the record pending) and the server revision covers the local one.
 * Returns the authoritative server revisions for reconciliation.
 */
export async function markAnswersSynced(
  attemptId: string,
  ack: { questionId: string; operationId?: string | null; serverRevision: number }[]
): Promise<Record<string, number>> {
  const byQuestion = new Map(ack.map((a) => [a.questionId, a]));
  const db = await openDB();
  const tx = db.transaction(ANSWERS_STORE, 'readwrite');
  const store = tx.objectStore(ANSWERS_STORE);
  const index = store.index('attemptId');
  const serverRevisions: Record<string, number> = {};

  const rows = await new Promise<StoredAnswer[]>((resolve, reject) => {
    const req = index.getAll(attemptId);
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });

  for (const row of rows) {
    const confirmation = byQuestion.get(row.questionId);
    if (!confirmation) continue;
    serverRevisions[row.questionId] = confirmation.serverRevision;

    if (
      confirmation.operationId &&
      row.operationId === confirmation.operationId &&
      confirmation.serverRevision >= row.clientRevision
    ) {
      store.put({
        ...row,
        syncStatus: 'synced' satisfies SyncStatus,
        syncedAt: new Date().toISOString(),
        syncAttempts: row.syncAttempts + 1,
        lastError: null,
      });
    }
  }

  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

  return serverRevisions;
}

export async function markAnswersSyncFailed(
  attemptId: string,
  questionIds: string[],
  error: string
): Promise<void> {
  const target = new Set(questionIds);
  const db = await openDB();
  const tx = db.transaction(ANSWERS_STORE, 'readwrite');
  const store = tx.objectStore(ANSWERS_STORE);
  const index = store.index('attemptId');

  const rows = await new Promise<StoredAnswer[]>((resolve, reject) => {
    const req = index.getAll(attemptId);
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });

  for (const row of rows) {
    if (!target.has(row.questionId)) continue;
    store.put({
      ...row,
      syncStatus: 'error' satisfies SyncStatus,
      syncAttempts: row.syncAttempts + 1,
      lastError: error.slice(0, 200),
    });
  }

  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function clearLocalAnswers(attemptId: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(ANSWERS_STORE, 'readwrite');
  const store = tx.objectStore(ANSWERS_STORE);
  const index = store.index('attemptId');

  const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
    const req = index.getAllKeys(attemptId);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  for (const key of keys) {
    store.delete(key);
  }

  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// ---------------------------------------------------------------------------
// Examination session token store (per attempt, durable across restarts)
// ---------------------------------------------------------------------------

export async function saveExamSession(session: StoredExamSession): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(SESSIONS_STORE, 'readwrite');
  tx.objectStore(SESSIONS_STORE).put({ ...session, savedAt: new Date().toISOString() });
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function loadExamSession(attemptId: string): Promise<StoredExamSession | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(SESSIONS_STORE, 'readonly');
    const store = tx.objectStore(SESSIONS_STORE);
    const record = await new Promise<StoredExamSession | undefined>((resolve, reject) => {
      const req = store.get(attemptId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return record ?? null;
  } catch {
    return null;
  }
}

export async function clearExamSession(attemptId: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(SESSIONS_STORE, 'readwrite');
    tx.objectStore(SESSIONS_STORE).delete(attemptId);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    // Best effort — a stale token only triggers the recovery path later.
  }
}
