import { redirect, notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getAttemptBreakdown } from '@/app/(dashboard)/student/assessments/[assessmentId]/exam/actions';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table';
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
        assessment:assessments!assessment_versions_assessment_id_fkey(id, title)
      )
    `)
    .eq('id', attempt.deployment_id)
    .single();

  const d = deployment as Record<string, unknown> & {
    show_raw_score?: boolean;
    show_percentage?: boolean;
    show_item_correctness?: boolean;
    show_correct_answers?: boolean;
    show_explanations?: boolean;
    assessment_version?: {
      id?: string;
      total_items?: number;
      total_points?: number;
      assessment?: { id?: string; title?: string };
    };
  };
  const showRawScore = d.show_raw_score !== false;
  const showPercentage = d.show_percentage !== false;
  // Review always shows after submit so students can study their attempt.
  // Green/red reflects their own answers (not the answer key).
  const showCorrectAnswers = d.show_correct_answers === true;
  const assessment = d?.assessment_version?.assessment;
  const version = d?.assessment_version;

  // Scores are only visible when released (immediate mode releases on submit).
  const scoreVisible = !!result && result.status === 'released';

  // Breakdown (questions + answer keys) is fetched via a server action using
  // the service-role client; students have no direct SELECT on questions.
  let responses: Awaited<ReturnType<typeof getAttemptBreakdown>>['data'] = [];
  const canReview =
    attempt.status === 'submitted' ||
    attempt.status === 'auto_submitted' ||
    attempt.status === 'expired';
  if (canReview) {
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
            {showRawScore && (
              <Card>
                <CardContent>
                  <p className="text-sm font-medium text-[var(--color-muted)]">Score</p>
                  <p className="mt-1 text-2xl font-bold text-[var(--color-foreground)]">
                    {scoreVisible ? `${result.raw_score}/${result.possible_score}` : 'Pending'}
                  </p>
                </CardContent>
              </Card>
            )}
            {showPercentage && (
              <Card>
                <CardContent>
                  <p className="text-sm font-medium text-[var(--color-muted)]">Percentage</p>
                  <p className="mt-1 text-2xl font-bold text-[var(--color-foreground)]">
                    {scoreVisible ? `${percentage}%` : 'Pending'}
                  </p>
                </CardContent>
              </Card>
            )}
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
                <h2 className="text-lg font-semibold">Question Review</h2>
                <p className="text-sm text-[var(--color-muted)]">
                  Your answers for this attempt. Correct items are green; incorrect are red.
                </p>
              </CardHeader>
              <CardContent className="p-0">
                <Table caption="Your answers, item by item">
                  <THead>
                    <TR>
                      <TH align="right">#</TH>
                      <TH>Question</TH>
                      <TH>Your answer</TH>
                      {showCorrectAnswers && <TH>Correct answer</TH>}
                      <TH>Result</TH>
                      <TH align="right">Points</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {responses.map((r, i) => {
                      const scored = r.earnedPoints !== null;
                      const isCorrect = scored && r.earnedPoints === r.points;
                      const isIncorrect = scored && (r.earnedPoints ?? 0) < r.points;
                      const isChoiceBased =
                        r.questionType === 'multiple_choice' || r.questionType === 'true_false';
                      const selectedChoice = r.choices.find((c) => c.id === r.selectedChoiceId);
                      const correctChoice = r.choices.find((c) => c.id === r.correctChoiceId);
                      const givenAnswer = isChoiceBased
                        ? selectedChoice
                          ? `${selectedChoice.choice_key}. ${selectedChoice.choice_text}`
                          : null
                        : r.textAnswer;
                      const correctAnswer = isChoiceBased
                        ? correctChoice
                          ? `${correctChoice.choice_key}. ${correctChoice.choice_text}`
                          : null
                        : r.canonicalAnswer;
                      const rowTint = isCorrect
                        ? 'bg-[var(--color-success-light)]'
                        : isIncorrect
                          ? 'bg-[var(--color-danger-light)]'
                          : '';

                      return (
                        <TR key={r.questionId} className={`align-top ${rowTint}`.trim()}>
                          <TD numeric className="text-[var(--color-muted)]">
                            {r.position ?? i + 1}
                          </TD>
                          <TD className="text-[var(--color-foreground)]">
                            <span className="whitespace-pre-wrap">{r.questionText}</span>
                            {r.imageUrl && (
                              <img
                                src={r.imageUrl}
                                alt=""
                                className="mt-2 h-20 w-auto rounded border object-cover"
                                loading="lazy"
                              />
                            )}
                          </TD>
                          <TD
                            className={
                              isCorrect
                                ? 'font-medium text-[var(--color-success)]'
                                : isIncorrect
                                  ? 'font-medium text-[var(--color-danger)]'
                                  : 'text-[var(--color-foreground)]'
                            }
                          >
                            {givenAnswer || <span className="text-[var(--color-muted)]">No answer</span>}
                          </TD>
                          {showCorrectAnswers && (
                            <TD className="text-[var(--color-muted)]">
                              {correctAnswer ?? '—'}
                            </TD>
                          )}
                          <TD>
                            {!scored ? (
                              <Badge variant="default">—</Badge>
                            ) : (
                              <Badge variant={isCorrect ? 'success' : 'danger'}>
                                {isCorrect ? 'Correct' : 'Incorrect'}
                              </Badge>
                            )}
                          </TD>
                          <TD numeric className="font-medium text-[var(--color-foreground)]">
                            {r.earnedPoints ?? 0}/{r.points}
                          </TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {responses.length === 0 && canReview && (
            <Card>
              <CardContent>
                <p className="text-sm text-[var(--color-muted)] text-center py-4">
                  No answers recorded for this attempt.
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
                <span className="font-medium tabular-nums">{version?.total_items ?? 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--color-muted)]">Total Points</span>
                <span className="font-medium tabular-nums">{version?.total_points ?? 0}</span>
              </div>
              {showRawScore && (
                <div className="flex justify-between">
                  <span className="text-[var(--color-muted)]">Your Score</span>
                  <span className="font-medium tabular-nums">
                    {scoreVisible ? `${result.raw_score}/${result.possible_score}` : 'Pending'}
                  </span>
                </div>
              )}
              {showPercentage && (
                <div className="flex justify-between">
                  <span className="text-[var(--color-muted)]">Percentage</span>
                  <span className="font-medium tabular-nums">
                    {scoreVisible ? `${percentage}%` : 'Pending'}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-[var(--color-muted)]">Attempt</span>
                <span className="font-medium tabular-nums">#{attempt.attempt_number}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--color-muted)]">Submitted</span>
                <span className="font-medium tabular-nums">
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