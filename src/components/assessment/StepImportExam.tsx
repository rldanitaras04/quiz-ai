'use client';

import { useCallback, useRef, useState, type JSX } from 'react';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import {
  itemMissingAnswer,
  mergeAnswerKeyFile,
  parseExamText,
  type ParsedExamItem,
} from '@/lib/import/exam-parse';
import { extractExamFile } from '@/app/(dashboard)/faculty/subjects/[offeringId]/question-bank/actions';
import type { DraftQuestion, Topic } from '@/lib/types';

type ImportMode = 'paste' | 'file';
type KeyMode = 'none' | 'paste' | 'file';

const ACCEPT = '.docx,.txt,.md,.csv,.pdf';
const MAX_BYTES = 10 * 1024 * 1024;

interface Props {
  questions: DraftQuestion[];
  onChange: (next: DraftQuestion[]) => void;
  topics: Topic[];
}

async function fileToText(file: File): Promise<string> {
  if (file.size > MAX_BYTES) throw new Error('File is too large (max 10MB)');
  if (/\.(txt|md|csv)$/i.test(file.name)) return file.text();
  const buf = await file.arrayBuffer();
  const { text } = await extractExamFile(file.name, buf);
  return text;
}

function toDrafts(items: ParsedExamItem[], startPos: number, topicId: string | null): DraftQuestion[] {
  return items.map((item, i) => {
    const id = `import-${Date.now()}-${startPos + i}`;
    const position = startPos + i;
    const choices = item.choices ?? [];
    return {
      id,
      assessment_version_id: '',
      question_type: item.question_type,
      question_text: item.question_text,
      difficulty: item.difficulty,
      bloom_level: item.bloom_level,
      points: item.points,
      position,
      status: 'active',
      created_by: '',
      is_ai_generated: false,
      generation_metadata: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      topic_id: topicId,
      topic_title: undefined,
      question_choices: choices.map((c, idx) => ({
        id: `${id}-${c.choice_key}`,
        question_id: id,
        choice_key: c.choice_key,
        choice_text: c.choice_text,
        position: idx,
        created_at: '',
        updated_at: '',
        is_correct:
          item.question_type !== 'identification' && c.choice_key === item.correct_choice_key,
      })),
      canonical_answer: item.canonical_answer ?? '',
    } satisfies DraftQuestion;
  });
}

export default function StepImportExam({
  questions,
  onChange,
  topics,
}: Props): JSX.Element {
  const [mode, setMode] = useState<ImportMode>('paste');
  const [pasteText, setPasteText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [keyMode, setKeyMode] = useState<KeyMode>('none');
  const [keyPaste, setKeyPaste] = useState('');
  const [keyFile, setKeyFile] = useState<File | null>(null);
  const [topicId, setTopicId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ParsedExamItem[] | null>(null);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const keyInputRef = useRef<HTMLInputElement>(null);

  const missingCount = preview ? preview.filter(itemMissingAnswer).length : 0;

  const resetPreview = () => {
    setPreview(null);
    setParseErrors([]);
    setError(null);
  };

  const getExamText = async (): Promise<string> => {
    if (mode === 'paste') {
      if (!pasteText.trim()) throw new Error('Paste the exam text first');
      return pasteText;
    }
    if (!file) throw new Error('Choose a file first');
    return fileToText(file);
  };

  const getKeyText = async (): Promise<string> => {
    if (keyMode === 'paste') return keyPaste;
    if (keyMode === 'file') {
      if (!keyFile) return '';
      return fileToText(keyFile);
    }
    return '';
  };

  const handlePreview = async () => {
    setBusy(true);
    setError(null);
    setParseErrors([]);
    try {
      const text = await getExamText();
      const result = parseExamText(text, { allowMissingAnswers: true });
      if (result.items.length === 0) {
        setError(result.errors[0] ?? 'No questions found');
        setPreview(null);
        setParseErrors(result.errors);
        return;
      }

      let items = result.items;
      let notes = [...result.errors];
      const keyText = (await getKeyText()).trim();
      if (keyText) {
        const merged = mergeAnswerKeyFile(items, keyText);
        items = merged.items;
        if (merged.applied > 0 || merged.stillMissing.length > 0) {
          notes = [
            ...notes,
            `Answer key filled ${merged.applied} item(s)` +
              (merged.stillMissing.length
                ? `; ${merged.stillMissing.length} still missing.`
                : '.'),
          ];
        }
      }

      if (items.filter(itemMissingAnswer).length > 0) {
        notes = [...notes, 'Some items are missing an answer key — fill them below to continue.'];
      }

      setPreview(items);
      setParseErrors(notes);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to read exam');
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };

  const setAnswer = (index: number, value: string) => {
    if (!preview) return;
    setPreview(
      preview.map((item, i) => {
        if (i !== index) return item;
        const next: ParsedExamItem = { ...item };
        if (next.question_type === 'identification') {
          next.canonical_answer = value;
        } else if (next.question_type === 'true_false') {
          next.correct_choice_key =
            value === 'T' || value === 'true'
              ? 'T'
              : value === 'F' || value === 'false'
                ? 'F'
                : value || undefined;
        } else {
          next.correct_choice_key = value || undefined;
        }
        return next;
      })
    );
    if (error && error.includes('missing')) setError(null);
  };

  const handleImport = () => {
    if (!preview || preview.length === 0) return;
    if (preview.some(itemMissingAnswer)) {
      setError('Fill in every missing answer before importing.');
      return;
    }
    const drafts = toDrafts(preview, questions.length + 1, topicId || null);
    onChange([...questions, ...drafts]);
    setPreview(null);
    setPasteText('');
    setFile(null);
    setKeyPaste('');
    setKeyFile(null);
    setError(null);
    setParseErrors([]);
  };

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const f = e.dataTransfer.files?.[0];
      if (f) {
        setFile(f);
        resetPreview();
      }
    },
    []
  );

  const typeLabel = (t: ParsedExamItem['question_type']) =>
    t === 'multiple_choice' ? 'MCQ' : t === 'true_false' ? 'TF' : 'ID';

  const answerLabel = (item: ParsedExamItem) => {
    if (item.question_type === 'identification') return item.canonical_answer ?? '—';
    if (item.question_type === 'true_false') return item.correct_choice_key === 'F' ? 'False' : 'True';
    const correct = item.choices?.find((c) => c.choice_key === item.correct_choice_key);
    return correct ? `${correct.choice_key}. ${correct.choice_text}` : '—';
  };

  return (
    <div className="space-y-4 text-sm">
      <div>
        <h2 className="text-lg font-semibold text-[var(--color-foreground)] mb-1">Upload ready-made exam</h2>
        <p className="text-sm text-[var(--color-muted)]">
          Paste or upload an existing exam. Optionally supply a separate answer-key file.
        </p>
      </div>

      {questions.length > 0 && (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-hover)] px-3 py-2 text-xs text-[var(--color-muted)]">
          {questions.length} question{questions.length === 1 ? '' : 's'} already in this assessment. Importing again will append.
        </div>
      )}

      <div className="flex gap-2">
        <Button
          size="sm"
          variant={mode === 'paste' ? 'primary' : 'secondary'}
          onClick={() => {
            setMode('paste');
            resetPreview();
          }}
        >
          Paste text
        </Button>
        <Button
          size="sm"
          variant={mode === 'file' ? 'primary' : 'secondary'}
          onClick={() => {
            setMode('file');
            resetPreview();
          }}
        >
          Upload file
        </Button>
      </div>

      <div>
        <label className="text-xs font-medium text-[var(--color-muted)]">Topic (optional)</label>
        <select
          value={topicId}
          onChange={(e) => setTopicId(e.target.value)}
          className="mt-1 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-sm"
        >
          <option value="">— Uncategorized —</option>
          {topics.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
      </div>

      {mode === 'paste' ? (
        <div>
          <label className="text-xs font-medium text-[var(--color-muted)]">
            Exam text with answer keys
          </label>
          <textarea
            rows={12}
            value={pasteText}
            onChange={(e) => {
              setPasteText(e.target.value);
              resetPreview();
            }}
            placeholder={
              '1. What is 2 + 2?\nA. 3\nB. 4\nC. 5\nD. 6\nAnswer: B\n\n2. The sky is blue. True or False?\nAnswer: True\n\nAnswer Key:\n1. B\n2. True'
            }
            className="mt-1 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-xs"
          />
          <p className="mt-1 text-xs text-[var(--color-muted)]">
            Numbered questions, A–F choices, “Answer: …”, optional trailing answer key, or CSV rows.
          </p>
        </div>
      ) : (
        <div
          onDrop={onDrop}
          onDragOver={(e) => e.preventDefault()}
          className="flex flex-col items-center justify-center gap-2 rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] py-8 px-4 text-center"
        >
          <p className="text-sm text-[var(--color-muted)]">
            Drop a .docx / .pdf / .txt / .md / .csv file here
          </p>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              resetPreview();
            }}
          />
          <Button size="sm" variant="secondary" onClick={() => inputRef.current?.click()}>
            Choose file
          </Button>
          {file && <p className="text-xs text-[var(--color-foreground)]">{file.name}</p>}
        </div>
      )}

      <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-xs font-medium text-[var(--color-foreground)]">Answer key file (optional)</p>
            <p className="text-xs text-[var(--color-muted)]">Separate paste or file — “1. B”, “2. Paris”, …</p>
          </div>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant={keyMode === 'none' ? 'primary' : 'ghost'}
              onClick={() => {
                setKeyMode('none');
                setKeyFile(null);
                setKeyPaste('');
                resetPreview();
              }}
            >
              None
            </Button>
            <Button
              size="sm"
              variant={keyMode === 'paste' ? 'primary' : 'ghost'}
              onClick={() => {
                setKeyMode('paste');
                setKeyFile(null);
                resetPreview();
              }}
            >
              Paste
            </Button>
            <Button
              size="sm"
              variant={keyMode === 'file' ? 'primary' : 'ghost'}
              onClick={() => {
                setKeyMode('file');
                setKeyPaste('');
                resetPreview();
              }}
            >
              File
            </Button>
          </div>
        </div>
        {keyMode === 'paste' && (
          <textarea
            rows={4}
            value={keyPaste}
            onChange={(e) => {
              setKeyPaste(e.target.value);
              resetPreview();
            }}
            placeholder={'1. B\n2. True\n3. Paris'}
            className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-xs"
          />
        )}
        {keyMode === 'file' && (
          <div className="flex items-center gap-2">
            <input
              ref={keyInputRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => {
                setKeyFile(e.target.files?.[0] ?? null);
                resetPreview();
              }}
            />
            <Button size="sm" variant="secondary" onClick={() => keyInputRef.current?.click()}>
              Choose key file
            </Button>
            {keyFile && <p className="text-xs text-[var(--color-foreground)]">{keyFile.name}</p>}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        {preview && preview.length > 0 ? (
          <>
            <Button variant="primary" onClick={handleImport} loading={busy} disabled={missingCount > 0}>
              Import {preview.length} question{preview.length === 1 ? '' : 's'}
              {missingCount > 0 ? ` (${missingCount} missing)` : ''}
            </Button>
            <Button variant="secondary" onClick={handlePreview} loading={busy}>
              Re-parse
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={handlePreview} loading={busy}>
            Parse preview
          </Button>
        )}
      </div>

      {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
      {parseErrors.length > 0 && (
        <ul className="max-h-24 overflow-y-auto text-xs text-[var(--color-warning)] list-disc list-inside">
          {parseErrors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}

      {preview && preview.length > 0 && (
        <div className="space-y-2">
          <p className="font-medium">
            Preview — {preview.length} question{preview.length === 1 ? '' : 's'}
            {missingCount > 0 && (
              <span className="text-[var(--color-warning)]">
                {' '}
                · {missingCount} missing answer{missingCount === 1 ? '' : 's'}
              </span>
            )}
          </p>
          <div className="max-h-56 space-y-2 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--color-border)] p-2">
            {preview.map((item, i) => {
              const missing = itemMissingAnswer(item);
              return (
                <div
                  key={i}
                  className={`rounded-[var(--radius-sm)] p-2 ${
                    missing ? 'bg-[var(--color-warning-light)]' : 'bg-[var(--color-surface-hover)]'
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="info">{typeLabel(item.question_type)}</Badge>
                    <span className="text-xs text-[var(--color-muted)]">{item.points} pt</span>
                    {missing && <Badge variant="warning">Missing answer</Badge>}
                  </div>
                  <p className="mt-1 text-xs text-[var(--color-foreground)]">
                    {i + 1}. {item.question_text}
                  </p>

                  {missing ? (
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <label className="text-xs font-medium text-[var(--color-muted)]">Answer:</label>
                      {item.question_type === 'identification' ? (
                        <input
                          type="text"
                          value={item.canonical_answer ?? ''}
                          onChange={(e) => setAnswer(i, e.target.value)}
                          placeholder="Type the correct answer"
                          className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs"
                        />
                      ) : item.question_type === 'true_false' ? (
                        <select
                          value=""
                          onChange={(e) => setAnswer(i, e.target.value)}
                          className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs"
                        >
                          <option value="" disabled>
                            Select…
                          </option>
                          <option value="T">True</option>
                          <option value="F">False</option>
                        </select>
                      ) : (
                        <select
                          value=""
                          onChange={(e) => setAnswer(i, e.target.value)}
                          className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs"
                        >
                          <option value="" disabled>
                            Select correct choice…
                          </option>
                          {(item.choices ?? []).map((c) => (
                            <option key={c.choice_key} value={c.choice_key}>
                              {c.choice_key}. {c.choice_text}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  ) : (
                    <p className="mt-0.5 text-xs text-[var(--color-muted)]">Answer: {answerLabel(item)}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
