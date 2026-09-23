'use client';

import { useState, type JSX } from 'react';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import QuestionNavigator from './QuestionNavigator';
import QuestionEditor from './QuestionEditor';
import type { DraftQuestion, Topic } from '@/lib/types';

interface Props {
  questions: DraftQuestion[];
  onChange: (next: DraftQuestion[]) => void;
  topics: Topic[];
  onCreateTopic?: (title: string) => Promise<Topic | null>;
}

function blankDraft(pos: number, topics: Topic[]): DraftQuestion {
  const id = `manual-${Date.now()}-${pos}`;
  const fallbackTopic = topics[0]?.id ?? null;
  return {
    id,
    assessment_version_id: '',
    question_type: 'multiple_choice',
    question_text: '',
    difficulty: 'moderate',
    bloom_level: 'remember',
    points: 1,
    position: pos,
    status: 'active',
    created_by: '',
    is_ai_generated: false,
    generation_metadata: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    topic_id: fallbackTopic,
    topic_title: topics.find(t => t.id === fallbackTopic)?.title,
    question_choices: ['A','B','C','D'].map((key, idx) => ({
      id: `${id}-${key}`, question_id: id, choice_key: key, choice_text: '', position: idx, created_at: '', updated_at: '',
    })),
    canonical_answer: '',
  };
}

export default function StepManualEntry({ questions, onChange, topics, onCreateTopic }: Props): JSX.Element {
  const [selected, setSelected] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [newTopicTitle, setNewTopicTitle] = useState('');

  const current = questions[selected];

  const updateAt = (idx: number, patch: Partial<DraftQuestion>) => {
    const next = questions.map((q, i) => i === idx ? { ...q, ...patch } : q);
    onChange(next);
  };

  const add = () => {
    const nextQ = blankDraft(questions.length + 1, topics);
    onChange([...questions, nextQ]);
    setSelected(questions.length);
  };

  const removeAt = (idx: number) => {
    const next = questions.filter((_, i) => i !== idx);
    const reindexed = next.map((q, i) => ({ ...q, position: i + 1 }));
    onChange(reindexed);
    setSelected(Math.max(0, Math.min(selected, reindexed.length - 1)));
  };

  const status = (q: DraftQuestion): 'complete' | 'incomplete' => {
    if (!q.question_text.trim()) return 'incomplete';
    if (q.question_type === 'multiple_choice') {
      const filled = q.question_choices.filter(c => c.choice_text.trim());
      if (filled.length < 2) return 'incomplete';
      if (!filled.some(c => c.is_correct)) return 'incomplete';
    } else if (!(q.canonical_answer ?? '').trim()) return 'incomplete';
    return 'complete';
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[var(--color-foreground)]">Manually Encode Questions</h2>
          <p className="text-sm text-[var(--color-muted)]">{questions.length} questions · each item is categorized by topic</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="success">{questions.filter(q => status(q) === 'complete').length} complete</Badge>
          <Badge variant="warning">{questions.filter(q => status(q) === 'incomplete').length} incomplete</Badge>
          <Button variant="outline" size="sm" className="lg:hidden" onClick={() => setDrawerOpen(true)}>Questions</Button>
        </div>
      </div>

      {topics.length === 0 && (
        <div className="p-4 rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface)]">
          <p className="text-sm font-medium text-[var(--color-foreground)]">No topics yet for this subject</p>
          <p className="text-xs text-[var(--color-muted)] mt-1">Create a topic first so questions are grouped correctly in the bank and reports.</p>
          {onCreateTopic && (
            <div className="mt-3 flex gap-2">
              <input
                value={newTopicTitle}
                onChange={e => setNewTopicTitle(e.target.value)}
                placeholder="e.g. Normalization, SQL Joins"
                className="flex-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm"
              />
              <Button
                size="sm"
                disabled={!newTopicTitle.trim()}
                onClick={async () => {
                  const t = await onCreateTopic(newTopicTitle.trim());
                  if (t) setNewTopicTitle('');
                }}
              >Create topic</Button>
            </div>
          )}
        </div>
      )}

      <div className="flex gap-6">
        <div className="hidden lg:block w-64 shrink-0">
          <QuestionNavigator
            questions={questions}
            selectedIndex={selected}
            onSelect={setSelected}
            onAdd={add}
            getQuestionStatus={status}
          />
          {questions.length === 0 && (
            <div className="mt-4">
              <Button variant="primary" size="sm" className="w-full" onClick={add}>Add first question</Button>
            </div>
          )}
        </div>

        {drawerOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-black/50" onClick={() => setDrawerOpen(false)} />
            <div className="absolute left-0 top-0 bottom-0 w-72 bg-[var(--color-surface)] border-r border-[var(--color-border)] p-4 overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold">Questions</h3>
                <button onClick={() => setDrawerOpen(false)} className="p-1 rounded text-[var(--color-muted)] hover:text-[var(--color-foreground)]">✕</button>
              </div>
              <QuestionNavigator
                questions={questions}
                selectedIndex={selected}
                onSelect={(i) => { setSelected(i); setDrawerOpen(false); }}
                onAdd={() => { add(); setDrawerOpen(false); }}
                getQuestionStatus={status}
              />
            </div>
          </div>
        )}

        <div className="flex-1 min-w-0">
          {questions.length === 0 ? (
            <div className="p-8 text-center rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-hover)]">
              <p className="text-sm font-medium text-[var(--color-foreground)]">No questions yet</p>
              <p className="text-xs text-[var(--color-muted)] mt-1">Add a question to start encoding. You can also import from the Question Bank in the next step.</p>
              <div className="mt-4 flex justify-center gap-2">
                <Button variant="primary" size="sm" onClick={add}>Add question</Button>
              </div>
            </div>
          ) : current ? (
            <div className="space-y-4">
              {/* Per-question topic selector */}
              {topics.length > 0 && (
                <div className="flex items-center gap-3 p-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-hover)]">
                  <label className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)] whitespace-nowrap">Topic</label>
                  <select
                    value={current.topic_id ?? ''}
                    onChange={e => {
                      const tid = e.target.value || null;
                      const tTitle = topics.find(t => t.id === tid)?.title;
                      updateAt(selected, { topic_id: tid, topic_title: tTitle });
                    }}
                    className="flex-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-sm"
                  >
                    <option value="">— Uncategorized —</option>
                    {topics.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
                  </select>
                </div>
              )}
              <QuestionEditor
                question={current}
                index={selected}
                total={questions.length}
                onUpdate={p => updateAt(selected, p)}
                onDelete={() => removeAt(selected)}
                onNavigate={dir => {
                  const nxt = selected + dir;
                  if (nxt >= 0 && nxt < questions.length) setSelected(nxt);
                }}
              />
            </div>
          ) : null}
        </div>
      </div>

      {questions.length > 0 && (
        <div className="flex justify-center">
          <Button variant="ghost" size="sm" onClick={add}>+ Add another question</Button>
        </div>
      )}
    </div>
  );
}
