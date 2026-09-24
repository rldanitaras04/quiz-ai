'use client';

import { useEffect, useState, type JSX } from 'react';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Spinner from '@/components/ui/Spinner';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { notifySuccess, notifyError, confirmAction } from '@/components/ui/alerts';
import { getQuestionBank, deleteBankItem, createBankItem } from '@/app/(dashboard)/faculty/subjects/[offeringId]/question-bank/actions';
import ImportExamModal from '@/components/assessment/ImportExamModal';
import type { QuestionBankItem, Topic, QuestionType, Difficulty, BloomLevel } from '@/lib/types';

interface Props {
  offeringId: string;
  topics: Topic[];
}

export default function QuestionBankManager({ offeringId, topics }: Props): JSX.Element {
  const [items, setItems] = useState<QuestionBankItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterTopic, setFilterTopic] = useState('');
  const [filterType, setFilterType] = useState('' as '' | QuestionType);
  const [search, setSearch] = useState('');

  // Add form
  const [showAdd, setShowAdd] = useState(false);
  const [newTopic, setNewTopic] = useState('');
  const [newType, setNewType] = useState<QuestionType>('multiple_choice');
  const [newDifficulty, setNewDifficulty] = useState<Difficulty>('moderate');
  const [newBloom, setNewBloom] = useState<BloomLevel>('understand');
  const [newText, setNewText] = useState('');
  const [newPoints, setNewPoints] = useState(1);
  const [newChoices, setNewChoices] = useState<Array<{ key: string; text: string; isCorrect: boolean }>>([
    { key: 'A', text: '', isCorrect: true },
    { key: 'B', text: '', isCorrect: false },
    { key: 'C', text: '', isCorrect: false },
    { key: 'D', text: '', isCorrect: false },
  ]);
  const [newAnswer, setNewAnswer] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await getQuestionBank(offeringId, {
        topicId: filterTopic || undefined,
        questionType: (filterType || undefined) as QuestionType | undefined,
        search: search || undefined,
      });
      setItems(data);
    } catch (e) {
      notifyError('Failed to load bank', e instanceof Error ? e.message : 'Unknown');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offeringId]);

  const handleDelete = async (id: string) => {
    const ok = await confirmAction({ title: 'Delete bank item?', text: 'This removes it from the reusable pool but not from assessments that already use it.', destructive: true });
    if (!ok) return;
    try {
      await deleteBankItem(id);
      setItems((prev) => prev.filter((i) => i.id !== id));
      notifySuccess('Deleted from bank');
    } catch (e) {
      notifyError('Delete failed', e instanceof Error ? e.message : 'Unknown');
    }
  };

  const handleCreate = async () => {
    if (!newText.trim()) {
      notifyError('Question text is required');
      return;
    }
    if (newType === 'multiple_choice') {
      const filled = newChoices.filter((c) => c.text.trim());
      if (filled.length < 2) {
        notifyError('Add at least two choices');
        return;
      }
      if (!filled.some((c) => c.isCorrect)) {
        notifyError('Mark the correct choice');
        return;
      }
    } else if (newType === 'true_false') {
      if (!newChoices.some((c) => c.isCorrect && (c.key === 'T' || c.key === 'F'))) {
        notifyError('Mark True or False as the correct answer');
        return;
      }
    } else if (!newAnswer.trim()) {
      notifyError('Canonical answer required for identification');
      return;
    }
    setSaving(true);
    try {
      const tfChoices = [
        { choice_key: 'T', choice_text: 'True' },
        { choice_key: 'F', choice_text: 'False' },
      ];
      await createBankItem(offeringId, {
        topic_id: newTopic || null,
        question_type: newType,
        question_text: newText,
        difficulty: newDifficulty,
        bloom_level: newBloom,
        points: newPoints,
        choices:
          newType === 'multiple_choice'
            ? newChoices.filter((c) => c.text.trim()).map((c) => ({ choice_key: c.key, choice_text: c.text }))
            : newType === 'true_false'
              ? tfChoices
              : undefined,
        correct_choice_key:
          newType === 'multiple_choice'
            ? newChoices.find((c) => c.isCorrect)?.key
            : newType === 'true_false'
              ? (newChoices.find((c) => c.isCorrect && (c.key === 'T' || c.key === 'F'))?.key ?? 'T')
              : undefined,
        canonical_answer: newType === 'identification' ? newAnswer : undefined,
      });
      setShowAdd(false);
      setNewText('');
      setNewAnswer('');
      await load();
      notifySuccess('Added to question bank');
    } catch (e) {
      notifyError('Create failed', e instanceof Error ? e.message : 'Unknown');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--color-foreground)]">Question Bank — {items.length} items</h3>
          <p className="text-xs text-[var(--color-muted)]">Reusable items per subject, grouped by topic. Add manually, import a ready-made exam, or approve questions from assessments.</p>
        </div>
        <div className="flex items-center gap-2">
          <ImportExamModal offeringId={offeringId} topics={topics} onImported={() => void load()} />
          <Button size="sm" variant="primary" onClick={() => setShowAdd((v) => !v)}>{showAdd ? 'Close' : 'Add to bank'}</Button>
        </div>
      </div>

      {showAdd && (
        <div className="p-4 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="text-xs font-medium text-[var(--color-muted)]">Topic</label>
              <select value={newTopic} onChange={(e) => setNewTopic(e.target.value)} className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-sm mt-1">
                <option value="">— Uncategorized —</option>
                {topics.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
            </div>
            <Select label="Type" value={newType} onChange={(e) => setNewType(e.target.value as QuestionType)}>
              <option value="multiple_choice">Multiple Choice</option>
              <option value="identification">Identification</option>
              <option value="true_false">True or False</option>
            </Select>
            <Input label="Points" type="number" min={1} value={newPoints} onChange={(e) => setNewPoints(Number(e.target.value) || 1)} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Difficulty" value={newDifficulty} onChange={(e) => setNewDifficulty(e.target.value as Difficulty)}>
              <option value="easy">Easy</option>
              <option value="moderate">Moderate</option>
              <option value="difficult">Difficult</option>
            </Select>
            <Select label="Bloom's" value={newBloom} onChange={(e) => setNewBloom(e.target.value as BloomLevel)}>
              <option value="remember">Remember</option>
              <option value="understand">Understand</option>
              <option value="apply">Apply</option>
              <option value="analyze">Analyze</option>
              <option value="evaluate">Evaluate</option>
              <option value="create">Create</option>
            </Select>
          </div>

          <div>
            <label className="text-xs font-medium text-[var(--color-muted)]">Question text</label>
            <textarea rows={3} value={newText} onChange={(e) => setNewText(e.target.value)} placeholder="Enter question…" className="mt-1 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm" />
          </div>

          {newType === 'multiple_choice' ? (
            <div className="space-y-2">
              <p className="text-xs font-medium text-[var(--color-muted)]">Choices (tick correct)</p>
              {newChoices.map((c, idx) => (
                <div key={idx} className="flex gap-2 items-center">
                  <button
                    type="button"
                    onClick={() => setNewChoices((prev) => prev.map((x, i) => ({ ...x, isCorrect: i === idx })))}
                    className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${c.isCorrect ? 'bg-[var(--color-success)] border-[var(--color-success)] text-white' : 'border-[var(--color-border)]'}`}
                  >
                    {c.isCorrect ? '✓' : ''}
                  </button>
                  <span className="text-sm font-bold w-6">{c.key}.</span>
                  <input value={c.text} onChange={(e) => setNewChoices((prev) => prev.map((x, i) => (i === idx ? { ...x, text: e.target.value } : x)))} placeholder={`Choice ${c.key}`} className="flex-1 rounded-[var(--radius-md)] border border-[var(--color-border)] px-2 py-1.5 text-sm" />
                </div>
              ))}
            </div>
          ) : newType === 'true_false' ? (
            <div className="space-y-2">
              <p className="text-xs font-medium text-[var(--color-muted)]">Correct answer</p>
              <div className="grid grid-cols-2 gap-3">
                {(['T', 'F'] as const).map((key) => {
                  const selected = newChoices.find((c) => c.key === key)?.isCorrect;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() =>
                        setNewChoices((prev) =>
                          prev.map((x) => ({ ...x, isCorrect: x.key === key }))
                        )
                      }
                      className={`p-3 rounded-[var(--radius-md)] border-2 text-sm font-semibold ${
                        selected
                          ? 'border-[var(--color-success)] bg-[var(--color-success)]/10 text-[var(--color-success)]'
                          : 'border-[var(--color-border)] text-[var(--color-muted)]'
                      }`}
                    >
                      {key === 'T' ? 'True' : 'False'}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <Input label="Canonical answer" value={newAnswer} onChange={(e) => setNewAnswer(e.target.value)} placeholder="Expected answer" />
          )}

          <div className="flex gap-2">
            <Button size="sm" variant="primary" onClick={handleCreate} loading={saving}>Save to bank</Button>
            <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Button>
          </div>
        </div>
      )}

      <div className="p-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] flex flex-wrap gap-3">
        <select value={filterTopic} onChange={(e) => setFilterTopic(e.target.value)} className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-2 py-1 text-sm">
          <option value="">All topics</option>
          {topics.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
        </select>
        <select value={filterType} onChange={(e) => setFilterType(e.target.value as any)} className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-2 py-1 text-sm">
          <option value="">Any type</option>
          <option value="multiple_choice">Multiple Choice</option>
          <option value="identification">Identification</option>
          <option value="true_false">True or False</option>
        </select>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-2 py-1 text-sm flex-1 min-w-[180px]" />
        <Button size="sm" variant="secondary" onClick={load}>Search</Button>
      </div>

      {loading ? (
        <div className="flex flex-col items-center py-8 gap-2"><Spinner size="md" /><p className="text-sm text-[var(--color-muted)]">Loading bank…</p></div>
      ) : items.length === 0 ? (
        <div className="text-center py-8 rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)]">
          <p className="text-sm text-[var(--color-muted)]">No items match the filters. Add one above, import a ready-made exam, or approve questions from an assessment.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((it) => (
            <div key={it.id} className="p-4 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)]">
              <div className="flex gap-3">
                <div className="flex-1">
                  <p className="text-sm text-[var(--color-foreground)]">{it.question_text}</p>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    <Badge variant="info">
                      {it.question_type === 'multiple_choice'
                        ? 'MCQ'
                        : it.question_type === 'true_false'
                          ? 'TF'
                          : 'ID'}
                    </Badge>
                    <Badge variant={it.difficulty === 'easy' ? 'success' : it.difficulty === 'difficult' ? 'danger' : 'warning'}>{it.difficulty}</Badge>
                    <Badge variant="outline">{it.bloom_level}</Badge>
                    <Badge variant="default">{it.points} pt</Badge>
                    {it.topic_id ? <Badge variant="default">{topics.find((t) => t.id === it.topic_id)?.title ?? 'Topic'}</Badge> : <Badge variant="outline">Uncategorized</Badge>}
                    {it.usage_count > 0 && <Badge variant="outline">Used {it.usage_count}×</Badge>}
                  </div>
                  {(it.question_type === 'multiple_choice' || it.question_type === 'true_false') &&
                    (it as any).question_bank_choices && (
                    <ul className="mt-2 text-xs text-[var(--color-muted)] list-disc list-inside">
                      {(it as any).question_bank_choices.map((c: any) => (
                        <li key={c.id}>{c.choice_key}. {c.choice_text} {c.id === (it as any).question_bank_answer_keys?.correct_choice_id ? '✓' : ''}</li>
                      ))}
                    </ul>
                  )}
                  {it.question_type === 'identification' && (
                    <p className="mt-1 text-xs text-[var(--color-muted)]">Answer: <span className="text-[var(--color-foreground)]">{(it as any).question_bank_answer_keys?.canonical_answer ?? it.canonical_answer}</span></p>
                  )}
                </div>
                <Button size="sm" variant="danger" onClick={() => handleDelete(it.id)}>Delete</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
