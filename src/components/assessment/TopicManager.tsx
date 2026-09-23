'use client';

import { useState, type JSX } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Badge from '@/components/ui/Badge';
import { notifySuccess, notifyError, confirmAction } from '@/components/ui/alerts';
import { createTopic, deleteTopic, updateTopic } from '@/app/(dashboard)/faculty/subjects/[offeringId]/topics/actions';
import type { Topic } from '@/lib/types';

interface Props {
  offeringId: string;
  topics: Topic[];
  onChange: (next: Topic[]) => void;
  compact?: boolean;
}

export default function TopicManager({ offeringId, topics, onChange, compact }: Props): JSX.Element {
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');

  const handleCreate = async () => {
    const title = newTitle.trim();
    if (!title) {
      notifyError('Title required');
      return;
    }
    setCreating(true);
    try {
      const t = await createTopic(offeringId, { title, description: newDesc });
      onChange([...topics, t].sort((a, b) => a.title.localeCompare(b.title)));
      setNewTitle('');
      setNewDesc('');
      notifySuccess('Topic created', `"${t.title}" added.`);
    } catch (e) {
      notifyError('Could not create topic', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (topic: Topic) => {
    const ok = await confirmAction({
      title: `Delete topic "${topic.title}"?`,
      text: 'Questions already using this topic will become Uncategorized. The bank items linked to it will also become Uncategorized.',
      confirmText: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteTopic(topic.id);
      onChange(topics.filter((t) => t.id !== topic.id));
      notifySuccess('Topic deleted');
    } catch (e) {
      notifyError('Delete failed', e instanceof Error ? e.message : 'Unknown error');
    }
  };

  const startEdit = (t: Topic) => {
    setEditingId(t.id);
    setEditTitle(t.title);
    setEditDesc(t.description ?? '');
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    try {
      const updated = await updateTopic(editingId, { title: editTitle, description: editDesc });
      onChange(topics.map((t) => (t.id === editingId ? updated : t)));
      setEditingId(null);
      notifySuccess('Topic updated');
    } catch (e) {
      notifyError('Update failed', e instanceof Error ? e.message : 'Unknown error');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-[var(--color-foreground)]">Topics</h3>
          <p className="text-xs text-[var(--color-muted)]">Group source materials and questions by topic. Used to categorize the question bank and filter during creation.</p>
        </div>
        <Badge variant="default">{topics.length} {topics.length === 1 ? 'topic' : 'topics'}</Badge>
      </div>

      <div className={`p-4 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] space-y-3 ${compact ? 'shadow-none' : ''}`}>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <Input label={compact ? undefined : 'New topic title'} placeholder="e.g. Normalization, Network Layer" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} maxLength={120} />
          {!compact && <Input label="Description (optional)" placeholder="Short description" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />}
          <div className="flex items-end gap-2">
            <Button size="sm" variant="primary" onClick={handleCreate} loading={creating} disabled={!newTitle.trim()}>Add topic</Button>
          </div>
        </div>
        {compact && (
          <Input placeholder="Description (optional)" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
        )}
      </div>

      {topics.length === 0 ? (
        <p className="text-sm text-[var(--color-muted)] text-center py-3">No topics yet — create one to start categorizing your bank.</p>
      ) : (
        <div className="space-y-2">
          {topics.map((t) => (
            <div key={t.id} className="flex items-start justify-between gap-3 p-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-hover)]">
              {editingId === t.id ? (
                <div className="flex-1 grid gap-2">
                  <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
                  <Input value={editDesc} onChange={(e) => setEditDesc(e.target.value)} placeholder="Description" />
                  <div className="flex gap-2">
                    <Button size="sm" variant="primary" onClick={handleSaveEdit}>Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--color-foreground)]">{t.title}</p>
                    {t.description && <p className="text-xs text-[var(--color-muted)] mt-0.5 line-clamp-2">{t.description}</p>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => startEdit(t)} className="px-2 py-1 text-xs font-medium text-[var(--color-primary)] hover:underline">Edit</button>
                    <button onClick={() => handleDelete(t)} className="px-2 py-1 text-xs font-medium text-[var(--color-danger)] hover:underline">Delete</button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
