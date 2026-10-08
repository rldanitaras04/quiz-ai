'use client';

import { useState, type JSX } from 'react';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Modal from '@/components/ui/Modal';
import { notifyError, notifySuccess } from '@/components/ui/alerts';
import { DIFFICULTY_LABELS, BLOOM_LABELS } from '@/lib/constants';
import { applyAssessmentModifications, proposeAssessmentModifications } from '@/app/(dashboard)/faculty/subjects/[offeringId]/assessments/actions/ai'
import { type AssessmentDetail } from '@/app/(dashboard)/faculty/subjects/[offeringId]/assessments/actions/assessments';
import type { DroppedProposal, ModifyProposal } from '@/lib/ai/modify';

interface AiModifyModalProps {
  open: boolean;
  onClose: () => void;
  assessmentId: string;
  detail: AssessmentDetail;
  /** Called after a successful (or partial) apply — refreshes the page data. */
  onApplied: () => void;
}

const EXAMPLES = [
  'Make items 10-15 more difficult (Bloom: analyze or higher).',
  'Rewrite question 3 so it is clearer, without changing its answer.',
  'Improve the distractors for the multiple-choice questions.',
  'Add two application-level identification questions on the main topic.',
];

const OP_LABELS: Record<ModifyProposal['op'], { label: string; variant: 'info' | 'success' | 'danger' }> = {
  update: { label: 'Update', variant: 'info' },
  add: { label: 'Add', variant: 'success' },
  delete: { label: 'Delete', variant: 'danger' },
};

const FIELD_LABELS: Record<string, string> = {
  question_text: 'Question',
  difficulty: 'Difficulty',
  bloom_level: "Bloom's level",
  points: 'Points',
  canonical_answer: 'Answer',
};

/**
 * AI Modification Assistant (scope §16): prompt → proposed changes rendered
 * as reviewable diffs → faculty accept/reject each → Apply runs ONLY the
 * accepted subset through updateQuestion/addQuestion/deleteQuestion.
 * Proposals are never persisted; nothing touches the assessment until Apply.
 */
export default function AiModifyModal({
  open,
  onClose,
  assessmentId,
  detail,
  onApplied,
}: AiModifyModalProps): JSX.Element {
  const [instruction, setInstruction] = useState('');
  const [proposing, setProposing] = useState(false);
  const [proposals, setProposals] = useState<ModifyProposal[] | null>(null);
  const [dropped, setDropped] = useState<DroppedProposal[]>([]);
  const [accepted, setAccepted] = useState<Set<number>>(new Set());
  const [applying, setApplying] = useState(false);

  const handlePropose = async () => {
    if (proposing) return;
    const trimmed = instruction.trim();
    if (!trimmed) {
      notifyError('Instruction required', 'Describe what you want changed first.');
      return;
    }
    setProposing(true);
    const result = await proposeAssessmentModifications(assessmentId, trimmed);
    setProposing(false);
    if (!result.success || !result.proposals) {
      notifyError('Could not propose changes', result.error ?? 'The AI returned nothing usable.');
      return;
    }
    setProposals(result.proposals);
    setDropped(result.dropped ?? []);
    // Default: everything pre-accepted — the faculty unchecks what they reject.
    setAccepted(new Set(result.proposals.map((_, i) => i)));
  };

  const handleToggle = (index: number) => {
    setAccepted((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const handleApply = async () => {
    if (applying || !proposals) return;
    const subset = proposals.filter((_, i) => accepted.has(i));
    if (subset.length === 0) return;

    setApplying(true);
    const result = await applyAssessmentModifications(assessmentId, subset);
    setApplying(false);

    const failed = result.failed ?? [];
    if (result.error && !result.appliedCount) {
      notifyError('Could not apply changes', result.error);
      return;
    }
    if (failed.length > 0) {
      notifyError(
        `${result.appliedCount ?? 0} applied, ${failed.length} failed`,
        failed[0].error
      );
    } else {
      notifySuccess(
        'Changes applied',
        result.createdVersion
          ? `${result.appliedCount} change(s) applied — a new version was created first; the published version is untouched.`
          : `${result.appliedCount} change(s) applied to version ${detail.version?.versionNumber ?? ''}.`
      );
    }
    onApplied();
    onClose();
  };

  const acceptedCount = proposals ? proposals.filter((_, i) => accepted.has(i)).length : 0;

  const renderDiff = (p: ModifyProposal): JSX.Element => {
    const question = p.question_id ? detail.questions.find((q) => q.id === p.question_id) : null;
    const lines: JSX.Element[] = [];

    if (p.op === 'delete' && question) {
      lines.push(
        <p key="del" className="text-sm text-[var(--color-danger)] line-through">
          {question.question_text}
        </p>
      );
      return <div className="space-y-1">{lines}</div>;
    }

    if (p.op === 'add') {
      lines.push(
        <p key="add-text" className="text-sm text-[var(--color-foreground)]">
          {p.fields.question_text ?? '(no text)'}
        </p>
      );
      const meta: string[] = [];
      if (p.fields.question_type) meta.push(p.fields.question_type);
      if (p.fields.difficulty) meta.push(DIFFICULTY_LABELS[p.fields.difficulty]);
      if (p.fields.bloom_level) meta.push(BLOOM_LABELS[p.fields.bloom_level]);
      if (p.fields.points) meta.push(`${p.fields.points} pt`);
      if (meta.length > 0) {
        lines.push(
          <p key="add-meta" className="text-xs text-[var(--color-muted)]">
            {meta.join(' · ')}
          </p>
        );
      }
      if (p.fields.choices) {
        lines.push(
          <ul key="add-choices" className="text-xs text-[var(--color-muted)] list-disc pl-4">
            {p.fields.choices.map((c) => (
              <li key={c.choice_key} className={c.choice_key === p.fields.correct_choice_key ? 'font-medium' : ''}>
                {c.choice_key}) {c.choice_text}
                {c.choice_key === p.fields.correct_choice_key ? ' ✓' : ''}
              </li>
            ))}
          </ul>
        );
      }
      return <div className="space-y-1">{lines}</div>;
    }

    // update — before → after per changed field.
    if (!question) {
      lines.push(
        <p key="missing" className="text-sm text-[var(--color-warning)]">
          This question is no longer on the assessment — the proposal will be skipped.
        </p>
      );
      return <div className="space-y-1">{lines}</div>;
    }

    const changed = (key: keyof typeof FIELD_LABELS, before: string, after: string): void => {
      if (before === after) return;
      lines.push(
        <p key={key} className="text-sm">
          <span className="text-[var(--color-muted)]">{FIELD_LABELS[key]}:</span>{' '}
          <span className="text-[var(--color-danger)] line-through">{before}</span>{' '}
          <span className="text-[var(--color-foreground)]">→ {after}</span>
        </p>
      );
    };

    if (p.fields.question_text !== undefined) {
      changed('question_text', question.question_text, p.fields.question_text);
    }
    if (p.fields.difficulty !== undefined) {
      changed(
        'difficulty',
        DIFFICULTY_LABELS[question.difficulty],
        DIFFICULTY_LABELS[p.fields.difficulty]
      );
    }
    if (p.fields.bloom_level !== undefined) {
      changed(
        'bloom_level',
        BLOOM_LABELS[question.bloom_level],
        BLOOM_LABELS[p.fields.bloom_level]
      );
    }
    if (p.fields.points !== undefined) {
      changed('points', String(question.points), String(p.fields.points));
    }
    if (p.fields.canonical_answer !== undefined) {
      changed('canonical_answer', question.canonicalAnswer ?? '(none)', p.fields.canonical_answer);
    }
    if (p.fields.choices) {
      lines.push(
        <div key="choices" className="text-xs space-y-0.5">
          <p className="text-[var(--color-muted)]">Choices replaced with:</p>
          <ul className="list-disc pl-4">
            {p.fields.choices.map((c) => (
              <li key={c.choice_key} className={c.choice_key === p.fields.correct_choice_key ? 'font-medium text-[var(--color-foreground)]' : 'text-[var(--color-muted)]'}>
                {c.choice_key}) {c.choice_text}
                {c.choice_key === p.fields.correct_choice_key ? ' ✓' : ''}
              </li>
            ))}
          </ul>
        </div>
      );
    }
    if (lines.length === 0) {
      lines.push(
        <p key="noop" className="text-sm text-[var(--color-muted)]">
          No field changes (metadata-only proposal).
        </p>
      );
    }
    return <div className="space-y-1">{lines}</div>;
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="AI assistant"
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={applying}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleApply}
            loading={applying}
            disabled={!proposals || acceptedCount === 0}
          >
            {acceptedCount > 0 ? `Apply ${acceptedCount} change${acceptedCount === 1 ? '' : 's'}` : 'Apply changes'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {detail.questionsLocked && (
          <div
            className="p-3 rounded-[var(--radius-md)] border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 text-sm text-[var(--color-foreground)]"
            role="note"
          >
            This version is published or deployed. Applying accepted changes will create a{' '}
            <strong>new version</strong> first — the current one stays untouched.
          </div>
        )}

        <div className="space-y-2">
          <label className="text-sm font-medium text-[var(--color-foreground)]" htmlFor="ai-modify-instruction">
            What should change?
          </label>
          <textarea
            id="ai-modify-instruction"
            rows={3}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder='e.g. "Make items 21-30 more difficult" or "Improve the distractors for question 18"'
            className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-foreground)]"
          />
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => setInstruction(example)}
                className="text-xs rounded-full border border-[var(--color-border)] px-2.5 py-1 text-[var(--color-muted)] hover:bg-[var(--color-surface-hover)] transition-colors"
              >
                {example}
              </button>
            ))}
          </div>
          <Button variant="secondary" onClick={handlePropose} loading={proposing}>
            Propose changes
          </Button>
        </div>

        {proposals && proposals.length > 0 && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="info">
                {proposals.length} proposal{proposals.length === 1 ? '' : 's'}
              </Badge>
              <Badge variant="default">{acceptedCount} accepted</Badge>
              <span className="text-xs text-[var(--color-muted)]">
                Review each diff — uncheck what you reject.
              </span>
            </div>

            {proposals.map((p, i) => {
              const question = p.question_id ? detail.questions.find((q) => q.id === p.question_id) : null;
              const opMeta = OP_LABELS[p.op];
              return (
                <div
                  key={`${p.op}-${p.question_id ?? 'new'}-${i}`}
                  className="p-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-hover)] space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge variant={opMeta.variant}>{opMeta.label}</Badge>
                      <span className="text-xs text-[var(--color-muted)]">
                        {question ? `#${question.position}` : p.op === 'add' ? 'new question' : '—'}
                      </span>
                    </div>
                    <label className="flex items-center gap-1.5 text-xs text-[var(--color-muted)]">
                      <input
                        type="checkbox"
                        checked={accepted.has(i)}
                        onChange={() => handleToggle(i)}
                        aria-label={`Accept proposal ${i + 1}`}
                      />
                      Accept
                    </label>
                  </div>
                  {renderDiff(p)}
                  {p.rationale && (
                    <p className="text-xs italic text-[var(--color-muted)]">{p.rationale}</p>
                  )}
                </div>
              );
            })}

            {dropped.length > 0 && (
              <p className="text-xs text-[var(--color-warning)]">
                {dropped.length} proposal{dropped.length === 1 ? '' : 's'} skipped:{' '}
                {dropped
                  .slice(0, 3)
                  .map((d) => d.reason)
                  .join('; ')}
                {dropped.length > 3 ? ' …' : ''}
              </p>
            )}
          </div>
        )}

        {proposals && proposals.length === 0 && (
          <p className="text-sm text-[var(--color-muted)]">
            The assistant proposed no usable changes — rephrase the instruction and try again.
            {dropped.length > 0 ? ` (${dropped.length} skipped: ${dropped[0].reason})` : ''}
          </p>
        )}
      </div>
    </Modal>
  );
}
