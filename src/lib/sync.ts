'use client';

const DB_NAME = 'quiz-ai-exam';
const DB_VERSION = 1;
const ANSWERS_STORE = 'answers';

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
    };
  });
}

interface StoredAnswer {
  attemptId: string;
  questionId: string;
  selectedChoiceId: string | null;
  textAnswer: string | null;
  clientRevision: number;
  savedAt: string;
}

export async function saveAnswerLocally(
  attemptId: string,
  questionId: string,
  selectedChoiceId: string | null,
  textAnswer: string | null
): Promise<void> {
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
    savedAt: new Date().toISOString(),
  };

  store.put(record);

  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
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

export async function syncAnswersToServer(
  attemptId: string,
  answers: { questionId: string; selectedChoiceId: string | null; textAnswer: string | null; clientRevision: number }[]
): Promise<{ success: boolean; serverRevisions: Record<string, number> }> {
  const response = await fetch('/api/exam/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attemptId, answers }),
  });

  if (!response.ok) {
    throw new Error('Sync failed');
  }

  return response.json();
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
  });
}
