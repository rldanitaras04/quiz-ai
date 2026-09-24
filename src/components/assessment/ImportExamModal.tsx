'use client';

import { useCallback, useRef, useState, type JSX } from 'react';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Badge from '@/components/ui/Badge';
import { notifySuccess } from '@/components/ui/alerts';
import {
  extractExamFile,
  importExamToBank,
} from '@/app/(dashboard)/faculty/subjects/[offeringId]/question-bank/actions';
import { importExamIntoVersion } from '@/app/(dashboard)/faculty/subjects/[offeringId]/assessments/actions';
import { parseExamText, type ParsedExamItem } from '@/lib/import/exam-parse';
import type { Topic } from '@/lib/types';

type ImportMode = 'paste' | 'file';
type ImportTarget =
  | { kind: 'bank' }
  | { kind: 'version'; assessmentId: string };

const ACCEPT = '.docx,.txt,.md,.csv,.pdf';
const MAX_BYTES = 10 * 1024 * 1024;

interface Props {
  offeringId: string;
  topics: Topic[];
  onImported: () => void;
  /** When set, items go into this assessment's current draft version instead of the question bank. */
  assessmentId?: string;
  /** Label for the trigger button. */
  buttonLabel?: string;
}

export default function ImportExamModal({
  offeringId,
  topics,
  onImported,
  assessmentId,
  buttonLabel = 'Import exam',
}: Props): JSX.Element {
  const target: ImportTarget = assessmentId
    ? { kind: 'version', assessmentId }
    : { kind: 'bank' };
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ImportMode>('paste');
  const [pasteText, setPasteText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [topicId, setTopicId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ParsedExamItem[] | null>(null);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setPasteText('');
    setFile(null);
    setTopicId('');
    setPreview(null);
    setParseErrors([]);
    setError(null);
    setBusy(false);
    setMode('paste');
  };

  const close = () => {
    setOpen(false);
    reset();
  };

  const getText = async (): Promise<string> => {
    if (mode === 'paste') {
      if (!pasteText.trim()) throw new Error('Paste the exam text first');
      return pasteText;
    }
    if (!file) throw new Error('Choose a file first');
    if (file.size > MAX_BYTES) throw new Error('File is too large (max 10MB)');
    // Fast path for plain text / CSV; DOCX/PDF extract on the server.
    if (/\.(txt|md|csv)$/i.test(file.name)) {
      return file.text();
    }
    const buf = await file.arrayBuffer();
    const { text } = await extractExamFile(file.name, buf);
    return text;
  };

  const handlePreview = async () => {
    setBusy(true);
    setError(null);
    setParseErrors([]);
    try {
      const text = await getText();
      const result = parseExamText(text);
      setPreview(result.items);
      setParseErrors(result.errors);
      if (result.items.length === 0) {
        setError(result.errors[0] ?? 'No questions found');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to read exam');
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };

  const handleImport = async () => {
    if (!preview || preview.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const opts = {
        topic_id: topicId || null,
        source_filename: file?.name ?? 'pasted-text',
      };
      const result =
        target.kind === 'version'
          ? await importExamIntoVersion(target.assessmentId, preview, opts)
          : await importExamToBank(offeringId, preview, opts);
      notifySuccess(
        `Imported ${result.imported} question${result.imported === 1 ? '' : 's'}`,
        result.errors.length > 0 ? `${result.errors.length} skipped` : undefined
      );
      onImported();
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) setFile(f);
  }, []);

  const typeLabel = (t: ParsedExamItem['question_type']) =>
    t === 'multiple_choice' ? 'MCQ' : t === 'true_false' ? 'TF' : 'ID';

  const answerLabel = (item: ParsedExamItem) => {
    if (item.question_type === 'identification') return item.canonical_answer ?? '—';
    if (item.question_type === 'true_false') return item.correct_choice_key === 'F' ? 'False' : 'True';
    const correct = item.choices?.find((c) => c.choice_key === item.correct_choice_key);
    return correct ? `${correct.choice_key}. ${correct.choice_text}` : '—';
  };

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        {buttonLabel}
      </Button>

      <Modal
        open={open}
        onClose={close}
        title={target.kind === 'version' ? 'Upload ready-made questions' : 'Import ready-made exam'}
        actions={
          <>
            <Button variant="ghost" onClick={close} disabled={busy}>
              Cancel
            </Button>
            {preview && preview.length > 0 ? (
              <Button variant="primary" onClick={handleImport} loading={busy}>
                Import {preview.length} question{preview.length === 1 ? '' : 's'}
              </Button>
            ) : (
              <Button variant="primary" onClick={handlePreview} loading={busy}>
                Parse preview
              </Button>
            )}
          </>
        }
      >
        <div className="space-y-4 text-sm">
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={mode === 'paste' ? 'primary' : 'secondary'}
              onClick={() => {
                setMode('paste');
                setPreview(null);
                setError(null);
              }}
            >
              Paste text
            </Button>
            <Button
              size="sm"
              variant={mode === 'file' ? 'primary' : 'secondary'}
              onClick={() => {
                setMode('file');
                setPreview(null);
                setError(null);
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
                onChange={(e) => setPasteText(e.target.value)}
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
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <Button size="sm" variant="secondary" onClick={() => inputRef.current?.click()}>
                Choose file
              </Button>
              {file && <p className="text-xs text-[var(--color-foreground)]">{file.name}</p>}
            </div>
          )}

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
              </p>
              <div className="max-h-56 space-y-2 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--color-border)] p-2">
                {preview.map((item, i) => (
                  <div key={i} className="rounded-[var(--radius-sm)] bg-[var(--color-surface-hover)] p-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="info">{typeLabel(item.question_type)}</Badge>
                      <span className="text-xs text-[var(--color-muted)]">{item.points} pt</span>
                    </div>
                    <p className="mt-1 text-xs text-[var(--color-foreground)]">
                      {i + 1}. {item.question_text}
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--color-muted)]">
                      Answer: {answerLabel(item)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
