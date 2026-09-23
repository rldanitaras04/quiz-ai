'use client';

import { useEffect, useMemo, useState, type JSX } from 'react';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Spinner from '@/components/ui/Spinner';
import { notifyError, notifySuccess } from '@/components/ui/alerts';
import { getQuestionBank } from '@/app/(dashboard)/faculty/subjects/[offeringId]/question-bank/actions';
import type { QuestionBankItem, Topic, DraftQuestion, QuestionType, Difficulty } from '@/lib/types';

interface Props {
  offeringId: string;
  topics: Topic[];
  onImport: (drafts: DraftQuestion[]) => void;
  existingCount: number;
}

type Filters = {
  topicId: string; // '' = all, '__none' = uncategorized, else id
  type: '' | QuestionType;
  difficulty: '' | Difficulty;
  search: string;
};

function mapBankToDraft(bank: QuestionBankItem, position: number): DraftQuestion {
  const id = `bank-${bank.id}-${Date.now()}-${position}`;
  const isMcq = bank.question_type === 'multiple_choice';
  const choices = (bank.question_bank_choices ?? bank.choices ?? []) as Array<{ id: string; choice_key: string; choice_text: string; position: number }>;
  const ak = bank.question_bank_answer_keys as any;
  const correctId = ak?.correct_choice_id ?? bank.correct_choice_id ?? null;

  const draftChoices = choices
    .slice()
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((c, i) => ({
      id: `${id}-c${i}`,
      question_id: id,
      choice_key: c.choice_key,
      choice_text: c.choice_text,
      position: i,
      created_at: '',
      updated_at: '',
      is_correct: c.id === correctId,
    }));

  return {
    id,
    assessment_version_id: '',
    question_type: bank.question_type,
    question_text: bank.question_text,
    difficulty: bank.difficulty,
    bloom_level: bank.bloom_level,
    points: bank.points,
    position,
    status: 'active',
    created_by: '',
    is_ai_generated: false,
    generation_metadata: { from_bank_id: bank.id, topic_id: bank.topic_id },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    topic_id: bank.topic_id,
    topic_title: (bank as any).topic?.title ?? undefined,
    image_url: (bank as any).image_url ?? null,
    image_storage_path: (bank as any).image_storage_path ?? null,
    question_choices: isMcq ? draftChoices : [],
    canonical_answer: bank.canonical_answer ?? ak?.canonical_answer ?? '',
    sourceChunkIds: [],
  };
}

export default function StepQuestionBank({ offeringId, topics, onImport, existingCount }: Props): JSX.Element {
  const [filters, setFilters] = useState<Filters>({ topicId: '', type: '', difficulty: '', search: '' });
  const [items, setItems] = useState<QuestionBankItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const fetchItems = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getQuestionBank(offeringId, {
        topicId: filters.topicId && filters.topicId !== '__none' ? filters.topicId : undefined,
        questionType: (filters.type || undefined) as QuestionType | undefined,
        difficulty: (filters.difficulty || undefined) as Difficulty | undefined,
        search: filters.search || undefined,
      });
      // client-side filter for uncategorized
      let filtered = data;
      if (filters.topicId === '__none') filtered = data.filter(i => !i.topic_id);
      setItems(filtered);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load question bank');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offeringId]);

  //Grouped by topic for display
  const grouped = useMemo(() => {
    const map = new Map<string, { label: string; items: QuestionBankItem[] }>();
    for (const it of items) {
      const key = it.topic_id ?? '__none';
      const label = it.topic_id ? (topics.find(t => t.id === it.topic_id)?.title ?? 'Unknown topic') : 'Uncategorized';
      if (!map.has(key)) map.set(key, { label, items: [] });
      map.get(key)!.items.push(it);
    }
    // sort groups by label
    return Array.from(map.entries())
      .sort((a, b) => a[1].label.localeCompare(b[1].label))
      .map(([key, v]) => ({ key, ...v }));
  }, [items, topics]);

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleGroup = (groupKey: string) => {
    const group = grouped.find(g => g.key === groupKey);
    if (!group) return;
    const allSelected = group.items.every(i => selected.has(i.id));
    setSelected(prev => {
      const next = new Set(prev);
      for (const it of group.items) {
        if (allSelected) next.delete(it.id);
        else next.add(it.id);
      }
      return next;
    });
  };

  const handleImport = () => {
    const chosen = items.filter(i => selected.has(i.id));
    if (chosen.length === 0) {
      notifyError('Nothing selected', 'Pick at least one item to import.');
      return;
    }
    const drafts = chosen.map((b, idx) => mapBankToDraft(b, existingCount + idx + 1));
    onImport(drafts);
    notifySuccess('Imported from bank', `${drafts.length} question${drafts.length === 1 ? '' : 's'} added to your draft.`);
    setSelected(new Set());
  };

  const topicCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const it of items) {
      const k = it.topic_id ?? '__none';
      c[k] = (c[k] ?? 0) + 1;
    }
    return c;
  }, [items]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-[var(--color-foreground)]">Question Bank</h2>
        <p className="text-sm text-[var(--color-muted)]">Browse your subject&apos;s reusable pool, grouped by topic. Select items to add to this assessment — counts and points remain editable in Review.</p>
      </div>

      {/* Filters */}
      <div className="p-4 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] space-y-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <div>
            <label className="text-xs font-medium text-[var(--color-muted)] block mb-1">Topic</label>
            <select
              value={filters.topicId}
              onChange={e => setFilters(f => ({ ...f, topicId: e.target.value }))}
              className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-sm"
            >
              <option value="">All topics ({items.length})</option>
              {topics.map(t => (
                <option key={t.id} value={t.id}>{t.title} ({topicCounts[t.id] ?? 0})</option>
              ))}
              <option value="__none">Uncategorized ({topicCounts['__none'] ?? 0})</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--color-muted)] block mb-1">Type</label>
            <select
              value={filters.type}
              onChange={e => setFilters(f => ({ ...f, type: e.target.value as Filters['type'] }))}
              className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-sm"
            >
              <option value="">Any type</option>
              <option value="multiple_choice">Multiple Choice</option>
              <option value="identification">Identification</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--color-muted)] block mb-1">Difficulty</label>
            <select
              value={filters.difficulty}
              onChange={e => setFilters(f => ({ ...f, difficulty: e.target.value as Filters['difficulty'] }))}
              className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-sm"
            >
              <option value="">Any difficulty</option>
              <option value="easy">Easy</option>
              <option value="moderate">Moderate</option>
              <option value="difficult">Difficult</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--color-muted)] block mb-1">Search</label>
            <input
              value={filters.search}
              onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
              placeholder="Filter by question text…"
              className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-sm"
            />
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={fetchItems}>Apply filters</Button>
          <Button size="sm" variant="ghost" onClick={() => { setFilters({ topicId: '', type: '', difficulty: '', search: '' }); setTimeout(fetchItems, 0); }}>Clear</Button>
          <span className="ml-auto text-xs text-[var(--color-muted)] self-center">{selected.size} selected · {items.length} shown</span>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center py-10 gap-2"><Spinner size="md" /><p className="text-sm text-[var(--color-muted)]">Loading question bank…</p></div>
      ) : error ? (
        <div className="p-4 rounded-[var(--radius-md)] bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/20 text-sm text-[var(--color-danger)]">{error}</div>
      ) : items.length === 0 ? (
        <div className="text-center py-8 rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-hover)]">
          <p className="text-sm font-medium text-[var(--color-foreground)]">No questions in the bank for these filters</p>
          <p className="text-xs text-[var(--color-muted)] mt-1">Try a different topic, or approve questions from past assessments to grow the bank. Manual items can also be saved to the bank from the assessment detail page.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(group => (
            <div key={group.key} className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 bg-[var(--color-surface-hover)] border-b border-[var(--color-border)]">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={group.items.every(i => selected.has(i.id))}
                    onChange={() => toggleGroup(group.key)}
                    className="h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-primary)]"
                  />
                  <h3 className="text-sm font-semibold text-[var(--color-foreground)]">{group.label}</h3>
                  <Badge variant="default">{group.items.length} items</Badge>
                </div>
                <span className="text-xs text-[var(--color-muted)] hidden sm:inline">Topic group</span>
              </div>
              <div className="divide-y divide-[var(--color-border)]">
                {group.items.map(item => {
                  const isSelected = selected.has(item.id);
                  const ak = (item as any).question_bank_answer_keys ?? null;
                  const answer = item.question_type === 'multiple_choice'
                    ? (() => {
                        const choices = (item as any).question_bank_choices as Array<{ id: string; choice_key: string; choice_text: string }> | undefined;
                        const cid = ak?.correct_choice_id ?? (item as any).correct_choice_id;
                        const c = choices?.find(x => x.id === cid);
                        return c ? `${c.choice_key}. ${c.choice_text}` : '—';
                      })()
                    : (ak?.canonical_answer ?? (item as any).canonical_answer ?? '—');
                  const itemImage = (item as any).image_url as string | null;
                  return (
                    <label key={item.id} className={`flex gap-3 p-4 cursor-pointer transition-colors ${isSelected ? 'bg-[var(--color-primary)]/5' : 'hover:bg-[var(--color-surface-hover)]'}`}>
                      <input type="checkbox" checked={isSelected} onChange={() => toggle(item.id)} className="mt-1 h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-primary)]" />
                      {itemImage && (
                        <img src={itemImage} alt="" className="h-16 w-16 rounded object-cover border border-[var(--color-border)] shrink-0" loading="lazy" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-[var(--color-foreground)] line-clamp-2">{item.question_text}</p>
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          <Badge variant={item.question_type === 'multiple_choice' ? 'info' : 'default'}>{item.question_type === 'multiple_choice' ? 'MCQ' : 'ID'}</Badge>
                          <Badge variant={item.difficulty === 'easy' ? 'success' : item.difficulty === 'difficult' ? 'danger' : 'warning'}>{item.difficulty}</Badge>
                          <Badge variant="outline">{item.bloom_level}</Badge>
                          <Badge variant="default">{item.points} pt{item.points === 1 ? '' : 's'}</Badge>
                          {item.usage_count > 0 && <Badge variant="outline">Used {item.usage_count}×</Badge>}
                          {itemImage && <Badge variant="info">Image</Badge>}
                        </div>
                        <p className="text-xs text-[var(--color-muted)] mt-1 truncate">Answer: <span className="text-[var(--color-foreground)]">{answer}</span></p>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between pt-2 border-t border-[var(--color-border)]">
        <p className="text-xs text-[var(--color-muted)]">{selected.size} item{selected.size === 1 ? '' : 's'} selected · they will be added to the Review list where you can edit topic, difficulty,Bloom and points before saving.</p>
        <Button variant="primary" size="sm" disabled={selected.size === 0} onClick={handleImport}>Add selected to draft ({selected.size})</Button>
      </div>
    </div>
  );
}
