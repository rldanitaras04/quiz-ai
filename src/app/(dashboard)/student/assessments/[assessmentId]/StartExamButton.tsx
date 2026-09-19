'use client';

import { useState, type JSX } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import { startExamAttemptAction } from './exam/actions';

interface StartExamButtonProps {
  assessmentId: string;
  deploymentId: string;
  className?: string;
}

/**
 * Starts an exam attempt through the `startExamAttemptAction` server action and
 * navigates to the real attempt id it returns. Previously the "Start Exam"
 * button linked to `/exam/new`, a route that only ever produced "Attempt not
 * found" — no attempt was ever created, so exams could not be taken at all.
 */
export default function StartExamButton({
  assessmentId,
  deploymentId,
  className,
}: StartExamButtonProps): JSX.Element {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleStart = async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await startExamAttemptAction(deploymentId);
      if (result.error || !result.attemptId) {
        setError(result.error ?? 'Could not start the exam');
        setLoading(false);
        return;
      }
      router.push(`/student/assessments/${assessmentId}/exam/${result.attemptId}`);
    } catch {
      setError('Could not start the exam. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className={`flex flex-col items-end gap-1 ${className ?? ''}`}>
      <Button variant="primary" onClick={handleStart} loading={loading}>
        Start Exam
      </Button>
      {error && (
        <span className="text-xs text-[var(--color-danger)] text-right">{error}</span>
      )}
    </div>
  );
}
