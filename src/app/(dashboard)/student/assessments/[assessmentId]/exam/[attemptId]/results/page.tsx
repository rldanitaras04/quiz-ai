import { redirect, notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getAttemptBreakdown } from './actions';
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
              <CardContent className="p-0">
                <Table caption="Your answers, item by item">
                  <THead>
                    <TR>
                      <TH align="right">#</TH>
                      <TH>Question</TH>
                      <TH>Your answer</TH>
                      <TH>Correct answer</TH>
                      <TH>Result</TH>
                      <TH align="right">Points</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {responses.map((r, i) => {
                      const isCorrect = r.earnedPoints !== null && r.earnedPoints === r.points;
                      const selectedChoice = r.choices.find((c) => c.id === r.selectedChoiceId);
                      const correctChoice = r.choices.find((c) => c.id === r.correctChoiceId);
                      const givenAnswer =
                        r.questionType === 'multiple_choice'
                          ? selectedChoice?.choice_text
                          : r.textAnswer;

                      return (
                        <TR key={r.questionId} className="align-top">
                          <TD numeric className="text-[var(--color-muted)]">
                            {r.position ?? i + 1}
                          </TD>
                          <TD className="text-[var(--color-foreground)]">{r.questionText}</TD>
                          <TD
                            className={
                              isCorrect
                                ? 'text-[var(--color-success)]'
                                : 'text-[var(--color-danger)]'
                            }
                          >
                            {givenAnswer || 'No answer'}
                          </TD>
                          <TD className="text-[var(--color-muted)]">
                            {d?.show_correct_answers && correctChoice
                              ? correctChoice.choice_text
                              : '—'}
                          </TD>
                          <TD>
                            <Badge variant={isCorrect ? 'success' : 'danger'}>
                              {isCorrect ? 'Correct' : 'Incorrect'}
                            </Badge>
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
                <span className="font-medium tabular-nums">{version?.total_items ?? 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--color-muted)]">Total Points</span>
                <span className="font-medium tabular-nums">{version?.total_points ?? 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--color-muted)]">Your Score</span>
                <span className="font-medium tabular-nums">{result ? `${result.raw_score}/${result.possible_score}` : 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--color-muted)]">Percentage</span>
                <span className="font-medium tabular-nums">{percentage}%</span>
              </div>
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
