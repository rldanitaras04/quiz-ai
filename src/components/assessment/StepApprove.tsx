'use client';

import { useState, type JSX } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Input from '@/components/ui/Input';
import { notifyError, notifySuccess } from '@/components/ui/alerts';
import { approveAssessment, createAssessment, saveGeneratedQuestions } from '@/app/(dashboard)/faculty/subjects/[offeringId]/assessments/actions';
import type { WizardState } from '@/app/(dashboard)/faculty/subjects/[offeringId]/assessments/new/page';
import type { Topic } from '@/lib/types';

interface StepApproveProps {
  state: WizardState;
  onUpdate: (updates: Partial<WizardState>) => void;
  offeringId: string;
  errors: Record<string, string>;
  topics?: Topic[];
  allTopics?: Topic[];
}

export default function StepApprove({
  state,
  onUpdate,
  offeringId,
  topics,
}: StepApproveProps): JSX.Element {
  const router = useRouter();
  const [approving, setApproving] = useState(false);
  const [approved, setApproved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const questions = state.generatedQuestions;
  const mcqCount = questions.filter((q) => q.question_type === 'multiple_choice').length;
  const idCount = questions.filter((q) => q.question_type === 'identification').length;
  const tfCount = questions.filter((q) => q.question_type === 'true_false').length;
  const totalPoints = questions.reduce((sum, q) => sum + q.points, 0);

  const difficultyCounts = {
    easy: questions.filter((q) => q.difficulty === 'easy').length,
    moderate: questions.filter((q) => q.difficulty === 'moderate').length,
    difficult: questions.filter((q) => q.difficulty === 'difficult').length,
  };
  const topicCounts = (() => {
    const map = new Map<string, number>();
    for (const q of questions) {
      const tid = (q as any).topic_id as string | null | undefined;
      const label = tid ? (topics?.find((t) => t.id === tid)?.title ?? tid.slice(0, 8)) : 'Uncategorized';
      map.set(label, (map.get(label) ?? 0) + 1);
    }
    return Array.from(map.entries());
  })();
  const creationModeLabel = (state as any).creationMode === 'manual' ? 'Manual' : (state as any).creationMode === 'bank' ? 'Question Bank' : (state as any).creationMode === 'mixed' ? 'Mixed' : 'AI';
  const isDraft = state.draftStatus === 'draft';

  const handleApprove = async () => {
    if (questions.length === 0) {
      setError('No questions to save. Add some via AI, manual encoding, or the question bank first.');
      return;
    }
    if (!state.title.trim()) {
      setError('Assessment title is missing. Go back to Basic Info.');
      return;
    }

    setApproving(true);
    setError(null);

    try {
      // Ensure assessment exists — manual/bank flows defer creation until now.
      let assessmentId = state.assessmentId;
      if (!assessmentId) {
        const created = await createAssessment(offeringId, {
          title: state.title,
          instructions: state.instructions,
          assessment_category: state.assessmentCategory,
        });
        assessmentId = created.id as string;
        onUpdate({ assessmentId });
      }

      // 1. Persist the reviewed questions (questions + choices + answer keys), including topic and image.
      const saveResult = await saveGeneratedQuestions(assessmentId,
        questions.map((q) => ({
          question_type: q.question_type,
          question_text: q.question_text,
          difficulty: q.difficulty,
          bloom_level: q.bloom_level,
          points: q.points,
          is_ai_generated: q.is_ai_generated ?? false,
          topic_id: (q as any).topic_id ?? null,
          image_url: (q as any).image_url ?? null,
          image_storage_path: (q as any).image_storage_path ?? null,
          question_choices: q.question_choices?.map((c) => ({
            choice_key: c.choice_key,
            choice_text: c.choice_text,
            is_correct: c.is_correct ?? false,
          })),
          canonical_answer: q.canonical_answer,
          sourceChunkIds: q.sourceChunkIds ?? [],
        }))
      );
      if (!saveResult.success) {
        const message = saveResult.error ?? 'Failed to save questions';
        setError(message);
        notifyError('Could not save the questions', message);
        return;
      }

      // 2. Approve assessment + version.
      await approveAssessment(assessmentId);
      setApproved(true);
      notifySuccess('Assessment approved', 'Review it, then deploy when you are ready.');
      setTimeout(() => {
        // The review surface: questions can be edited and published from there.
        router.push(
          `/faculty/subjects/${offeringId}/assessments/${assessmentId}`
        );
      }, 2000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to approve assessment';
      setError(message);
      notifyError('Could not approve the assessment', message);
    } finally {
      setApproving(false);
    }
  };

  if (approved) {
    return (
      <div className="text-center py-12">
        <svg className="w-16 h-16 mx-auto text-[var(--color-success)] mb-4" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
        </svg>
        <h2 className="text-xl font-bold text-[var(--color-foreground)] mb-2">
          Assessment Approved!
        </h2>
        <p className="text-sm text-[var(--color-muted)]">
          Redirecting to the assessment...
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-[var(--color-foreground)] mb-1">
          {isDraft ? 'Approve Assessment' : 'Approve & Schedule'}
        </h2>
        <p className="text-sm text-[var(--color-muted)]">
          {isDraft
            ? 'Review the assessment summary and approve. Schedule later from the deploy page.'
            : 'Review the assessment summary, approve, and schedule when it opens.'}
        </p>
      </div>

      <div className="p-5 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-hover)]">
        <h3 className="text-base font-semibold text-[var(--color-foreground)] mb-4">
          Assessment Summary
        </h3>

        <dl className="space-y-3">
          <div className="flex justify-between">
            <dt className="text-sm text-[var(--color-muted)]">Title</dt>
            <dd className="text-sm font-medium text-[var(--color-foreground)]">{state.title}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-sm text-[var(--color-muted)]">Type</dt>
            <dd className="text-sm font-medium text-[var(--color-foreground)] capitalize">
              {state.assessmentCategory}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-sm text-[var(--color-muted)]">Status</dt>
            <dd>
              <Badge variant={state.draftStatus === 'final' ? 'success' : 'warning'}>
                {state.draftStatus === 'final' ? 'Final' : 'Draft'}
              </Badge>
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-sm text-[var(--color-muted)]">Total Questions</dt>
            <dd className="text-sm font-semibold text-[var(--color-foreground)]">{questions.length}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-sm text-[var(--color-muted)]">Total Points</dt>
            <dd className="text-sm font-semibold text-[var(--color-foreground)]">{totalPoints}</dd>
          </div>
        </dl>

        <div className="mt-4 pt-4 border-t border-[var(--color-border)]">
          <h4 className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wide mb-2">
            Question Types
          </h4>
          <div className="flex flex-wrap gap-3">
            <Badge variant="info">{mcqCount} Multiple Choice</Badge>
            <Badge variant="info">{idCount} Identification</Badge>
            <Badge variant="info">{tfCount} True or False</Badge>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-[var(--color-border)]">
          <h4 className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wide mb-2">
            Difficulty Distribution
          </h4>
          <div className="flex gap-3">
            <Badge variant="success">{difficultyCounts.easy} Easy</Badge>
            <Badge variant="warning">{difficultyCounts.moderate} Moderate</Badge>
            <Badge variant="danger">{difficultyCounts.difficult} Difficult</Badge>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-[var(--color-border)]">
          <h4 className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wide mb-2">
            Topics & Creation Mode
          </h4>
          <div className="flex flex-wrap gap-2">
            <Badge variant="info">Mode: {creationModeLabel}</Badge>
            {topicCounts.map(([label, count]) => (
              <Badge key={label} variant="default">{label}: {count}</Badge>
            ))}
            {topicCounts.length === 0 && <span className="text-xs text-[var(--color-muted)]">No topic categorization</span>}
          </div>
        </div>
      </div>

      {/* Scheduling — skipped for draft saves; schedule later on Deploy */}
      {!isDraft && (
        <div className="p-5 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-hover)]">
          <h3 className="text-base font-semibold text-[var(--color-foreground)] mb-4">
            Schedule
          </h3>
          <p className="text-sm text-[var(--color-muted)] mb-4">
            Set when the assessment opens and closes for students.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Opens at"
              type="datetime-local"
              value={state.opensAt ?? ''}
              onChange={(e) => onUpdate({ opensAt: e.target.value })}
              required
            />
            <Input
              label="Closes at"
              type="datetime-local"
              value={state.closesAt ?? ''}
              onChange={(e) => onUpdate({ closesAt: e.target.value })}
              required
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 mt-4">
            <Input
              label="Duration (minutes)"
              type="number"
              min={1}
              value={state.durationMinutes ?? 60}
              onChange={(e) => onUpdate({ durationMinutes: parseInt(e.target.value) || 60 })}
              required
            />
            <Input
              label="Attempt limit"
              type="number"
              min={1}
              max={10}
              value={state.attemptLimit ?? 1}
              onChange={(e) => onUpdate({ attemptLimit: parseInt(e.target.value) || 1 })}
              required
            />
          </div>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-[var(--radius-md)] bg-[var(--color-danger-light)] border border-[var(--color-danger)]/20">
          <p className="text-sm text-[var(--color-danger)]">{error}</p>
        </div>
      )}

      <div className="flex gap-3">
        <Button
          variant="primary"
          onClick={handleApprove}
          disabled={approving || (!isDraft && (!state.opensAt || !state.closesAt))}
          loading={approving}
        >
          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
          </svg>
          {isDraft ? 'Approve' : 'Approve & Schedule'}
        </Button>
      </div>
    </div>
  );
}
