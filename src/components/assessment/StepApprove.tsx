'use client';

import { useState, type JSX } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import { approveAssessment, saveGeneratedQuestions } from '@/app/(dashboard)/faculty/subjects/[offeringId]/assessments/actions';
import type { WizardState } from '@/app/(dashboard)/faculty/subjects/[offeringId]/assessments/new/page';

interface StepApproveProps {
  state: WizardState;
  onUpdate: (updates: Partial<WizardState>) => void;
  offeringId: string;
  errors: Record<string, string>;
}

export default function StepApprove({
  state,
  offeringId,
}: StepApproveProps): JSX.Element {
  const router = useRouter();
  const [approving, setApproving] = useState(false);
  const [approved, setApproved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const questions = state.generatedQuestions;
  const mcqCount = questions.filter((q) => q.question_type === 'multiple_choice').length;
  const idCount = questions.filter((q) => q.question_type === 'identification').length;
  const totalPoints = questions.reduce((sum, q) => sum + q.points, 0);

  const difficultyCounts = {
    easy: questions.filter((q) => q.difficulty === 'easy').length,
    moderate: questions.filter((q) => q.difficulty === 'moderate').length,
    difficult: questions.filter((q) => q.difficulty === 'difficult').length,
  };

  const handleApprove = async () => {
    if (!state.assessmentId) {
      setError('No assessment ID found. Please go back and create the assessment first.');
      return;
    }
    if (questions.length === 0) {
      setError('No questions to save. Go back and generate questions first.');
      return;
    }

    setApproving(true);
    setError(null);

    try {
      // 1. Persist the reviewed questions (questions + choices + answer keys).
      const saveResult = await saveGeneratedQuestions(state.assessmentId,
        questions.map((q) => ({
          question_type: q.question_type,
          question_text: q.question_text,
          difficulty: q.difficulty,
          bloom_level: q.bloom_level,
          points: q.points,
          is_ai_generated: q.is_ai_generated ?? false,
          question_choices: q.question_choices?.map((c) => ({
            choice_key: c.choice_key,
            choice_text: c.choice_text,
            is_correct: c.is_correct ?? false,
          })),
          canonical_answer: q.canonical_answer,
        }))
      );
      if (!saveResult.success) {
        setError(saveResult.error ?? 'Failed to save questions');
        return;
      }

      // 2. Approve assessment + version.
      await approveAssessment(state.assessmentId);
      setApproved(true);
      setTimeout(() => {
        router.push(`/faculty/subjects/${offeringId}/assessments/${state.assessmentId}`);
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve assessment');
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
          Redirecting to assessment details...
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-[var(--color-foreground)] mb-1">
          Review & Approve
        </h2>
        <p className="text-sm text-[var(--color-muted)]">
          Review the assessment summary and approve to finalize.
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
          <div className="flex gap-3">
            <Badge variant="info">{mcqCount} Multiple Choice</Badge>
            <Badge variant="info">{idCount} Identification</Badge>
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
      </div>

      {error && (
        <div className="p-4 rounded-[var(--radius-md)] bg-[var(--color-danger-light)] border border-[var(--color-danger)]/20">
          <p className="text-sm text-[var(--color-danger)]">{error}</p>
        </div>
      )}

      <div className="flex gap-3">
        <Button
          variant="primary"
          onClick={handleApprove}
          disabled={approving}
          loading={approving}
        >
          Approve Assessment
        </Button>
      </div>
    </div>
  );
}
