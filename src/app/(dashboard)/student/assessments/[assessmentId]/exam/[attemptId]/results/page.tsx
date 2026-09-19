import { redirect, notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getAttemptBreakdown } from './actions';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Link from 'next/link';

interface Props {
  params: Promise<{ assessmentId: string; attemptId: string }>;
}

export default async function ExamResultsPage({ params }: Props) {
  const { assessmentId, attemptId } = await params;
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect('/login');

  const { data: attempt } = await supabase
    .from('exam_attempts')
    .select('*')
    .eq('id', attemptId)
    .single();

  if (!attempt || attempt.student_id !== user.id) notFound();

  const { data: result } = await supabase
    .from('assessment_results')
    .select('*')
    .eq('attempt_id', attemptId)
    .single();

  const { data: deployment } = await supabase
    .from('assessment_deployments')
    .select(`
      id,
      show_raw_score,
      show_percentage,
      show_item_correctness,
      show_correct_answers,
      show_explanations,
      assessment_version:assessment_versions(
        id,
        total_items,
        total_points,
        assessment:assessments(id, title)
      )
    `)
    .eq('id', attempt.deployment_id)
    .single();

  const d = deployment as Record<string, unknown> & {
    show_item_correctness?: boolean;
    show_correct_answers?: boolean;
    assessment_version?: {
      id?: string;
      total_items?: number;
      total_points?: number;
      assessment?: { id?: string; title?: string };
    };
  };
  const assessment = d?.assessment_version?.assessment;
  const version = d?.assessment_version;

  // Breakdown (questions + answer keys) is fetched via a server action using
  // the service-role client; students have no direct SELECT on questions.
  let responses: Awaited<ReturnType<typeof getAttemptBreakdown>>['data'] = [];
  if (d?.show_item_correctness) {
    const breakdown = await getAttemptBreakdown(attemptId);
    responses = breakdown.data ?? [];
  }

  const startTime = new Date(attempt.started_at);
  const endTime = attempt.submitted_at ? new Date(attempt.submitted_at) : new Date();
  const timeTakenMs = endTime.getTime() - startTime.getTime();
  const timeTakenMinutes = Math.floor(timeTakenMs / 60000);
  const timeTakenSeconds = Math.floor((timeTakenMs % 60000) / 1000);

  const percentage = result ? Math.round(result.percentage) : 0;

  return (
    <div>
      <PageHeader
        breadcrumbs={[
          { label: 'Student', href: '/student' },
          { label: 'Assessments', href: '/student/assessments' },
          { label: assessment?.title ?? 'Assessment', href: `/student/assessments/${assessmentId}` },
          { label: 'Results' },
        ]}
        title="Exam Results"
        description={assessment?.title ?? ''}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardContent>
                <p className="text-sm font-medium text-[var(--color-muted)]">Score</p>
                <p className="mt-1 text-2xl font-bold text-[var(--color-foreground)]">
                  {result ? `${result.raw_score}/${result.possible_score}` : 'N/A'}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent>
                <p className="text-sm font-medium text-[var(--color-muted)]">Percentage</p>
                <p className="mt-1 text-2xl font-bold text-[var(--color-foreground)]">
                  {result ? `${percentage}%` : 'N/A'}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent>
                <p className="text-sm font-medium text-[var(--color-muted)]">Time Taken</p>
                <p className="mt-1 text-2xl font-bold text-[var(--color-foreground)]">
                  {timeTakenMinutes}m {timeTakenSeconds}s
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent>
                <p className="text-sm font-medium text-[var(--color-muted)]">Status</p>
                <p className="mt-1">
                  <Badge variant={attempt.status === 'submitted' ? 'success' : 'warning'}>
                    {attempt.status === 'submitted' ? 'Submitted' : attempt.status === 'auto_submitted' ? 'Auto-Submitted' : attempt.status}
                  </Badge>
                </p>
              </CardContent>
            </Card>
          </div>

          {responses.length > 0 && (
            <Card>
              <CardHeader>
                <h2 className="text-lg font-semibold">Question Breakdown</h2>
              </CardHeader>
              <CardContent className="space-y-3">
                {responses.map((r, i) => {
                  const isCorrect = r.earnedPoints !== null && r.earnedPoints === r.points;
                  const selectedChoice = r.choices.find((c) => c.id === r.selectedChoiceId);
                  const correctChoice = r.choices.find((c) => c.id === r.correctChoiceId);

                  return (
                    <div
                      key={r.questionId}
                      className={`p-3 rounded-lg border ${
                        isCorrect
                          ? 'border-[var(--color-success)]/30 bg-[var(--color-success-light)]'
                          : 'border-[var(--color-danger)]/30 bg-[var(--color-danger-light)]'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">
                            {(r.position ?? i + 1)}. {r.questionText}
                          </p>
                          {r.questionType === 'multiple_choice' && (
                            <div className="mt-1 text-sm space-y-0.5">
                              <p>
                                Your answer: <span className={isCorrect ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}>
                                  {selectedChoice?.choice_text ?? 'No answer'}
                                </span>
                              </p>
                              {!isCorrect && d?.show_correct_answers && correctChoice && (
                                <p>
                                  Correct answer: <span className="text-[var(--color-success)]">{correctChoice.choice_text}</span>
                                </p>
                              )}
                            </div>
                          )}
                          {r.questionType === 'identification' && (
                            <p className="mt-1 text-sm">
                              Your answer: <span className={isCorrect ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}>
                                {r.textAnswer || 'No answer'}
                              </span>
                            </p>
                          )}
                        </div>
                        <span className="text-sm font-medium whitespace-nowrap">
                          {r.earnedPoints ?? 0}/{r.points} pts
                        </span>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {responses.length === 0 && d?.show_item_correctness && (
            <Card>
              <CardContent>
                <p className="text-sm text-[var(--color-muted)] text-center py-4">
                  Detailed breakdown is not available for this exam.
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card className="sticky top-6">
            <CardHeader>
              <h2 className="text-lg font-semibold">Summary</h2>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-[var(--color-muted)]">Total Items</span>
                <span className="font-medium">{version?.total_items ?? 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--color-muted)]">Total Points</span>
                <span className="font-medium">{version?.total_points ?? 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--color-muted)]">Your Score</span>
                <span className="font-medium">{result ? `${result.raw_score}/${result.possible_score}` : 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--color-muted)]">Percentage</span>
                <span className="font-medium">{percentage}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--color-muted)]">Attempt</span>
                <span className="font-medium">#{attempt.attempt_number}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--color-muted)]">Submitted</span>
                <span className="font-medium">
                  {attempt.submitted_at
                    ? new Date(attempt.submitted_at).toLocaleString()
                    : 'N/A'}
                </span>
              </div>

              <div className="pt-3 border-t border-[var(--color-border)]">
                <Link href="/student/assessments">
                  <Button variant="secondary" className="w-full">Back to Assessments</Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
