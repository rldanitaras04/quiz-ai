'use client';

import { useState, useEffect, useCallback, Fragment, type JSX } from 'react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import EmptyState from '@/components/ui/EmptyState';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table';
import { notifyError } from '@/components/ui/alerts';
import {
  getAttemptsForAnswerReview,
  getAttemptAnswersForReview,
  type ReviewableAttempt,
  type FacultyAnswerReview,
} from './actions';

const STATUS_LABELS: Record<string, string> = {
  submitted: 'Submitted',
  auto_submitted: 'Auto-submitted',
  expired: 'Expired',
};

/** "20/40 (50%)" — falls back to an em dash until a score exists. */
function formatScore(attempt: ReviewableAttempt): string {
  if (attempt.raw_score == null || attempt.possible_score == null) return '—';
  const base = `${attempt.raw_score}/${attempt.possible_score}`;
  return attempt.percentage == null ? base : `${base} (${Math.round(attempt.percentage)}%)`;
}

/**
 * Faculty-facing counterpart to the student's Question Review: pick a submitted
 * attempt and read every item with the student's answer beside the correct one.
 * The answer key and per-item scores come from the gated server action, so this
 * card never assumes the student-facing display flags are on.
 */
export default function StudentAnswersReview({
  deploymentId,
}: {
  deploymentId: string;
}): JSX.Element {
  const [attempts, setAttempts] = useState<ReviewableAttempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [review, setReview] = useState<FacultyAnswerReview | null>(null);
  const [loadingReview, setLoadingReview] = useState(false);

  const loadAttempts = useCallback(async () => {
    setLoading(true);
    const result = await getAttemptsForAnswerReview(deploymentId);
    if (result.error) {
      notifyError(result.error);
    } else {
      setAttempts(result.data ?? []);
    }
    setLoading(false);
  }, [deploymentId]);

  useEffect(() => {
    loadAttempts();
  }, [loadAttempts]);

  const toggleAttempt = async (attempt: ReviewableAttempt) => {
    if (expandedId === attempt.attempt_id) {
      setExpandedId(null);
      return;
    }

    setExpandedId(attempt.attempt_id);
    setReview(null);
    setLoadingReview(true);
    const result = await getAttemptAnswersForReview(attempt.attempt_id);
    setLoadingReview(false);

    if (result.error) {
      notifyError(result.error);
      return;
    }
    setReview(result.data ?? null);
  };

  return (
    <Card>
      <CardHeader>
        <h3 className="text-base font-semibold text-foreground">Student Answers</h3>
        <p className="text-sm text-muted">
          Open a submitted attempt to review each answer against the correct answer.
        </p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : attempts.length === 0 ? (
          <EmptyState
            title="No submitted attempts"
            description="Student answers appear here once attempts have been submitted."
          />
        ) : (
          <Table cards caption="Submitted attempts">
            <THead>
              <TR>
                <TH>Student</TH>
                <TH align="right">Attempt</TH>
                <TH>Score</TH>
                <TH>Status</TH>
                <TH align="right">Answers</TH>
              </TR>
            </THead>
            <TBody>
              {attempts.map((attempt) => {
                const expanded = expandedId === attempt.attempt_id;
                return (
                  <Fragment key={attempt.attempt_id}>
                    <TR>
                      <TD primary label="Student" className="text-foreground">
                        <span className="font-medium">{attempt.student_name}</span>
                        {attempt.student_email && (
                          <span className="block text-xs text-muted">{attempt.student_email}</span>
                        )}
                      </TD>
                      <TD numeric label="Attempt" className="text-muted">
                        #{attempt.attempt_number}
                      </TD>
                      <TD label="Score" className="text-foreground">
                        {formatScore(attempt)}
                        {attempt.raw_score != null && !attempt.released && (
                          <span className="ml-2 text-xs text-muted">not released</span>
                        )}
                      </TD>
                      <TD label="Status">
                        <Badge variant={attempt.status === 'submitted' ? 'success' : 'warning'}>
                          {STATUS_LABELS[attempt.status] ?? attempt.status}
                        </Badge>
                      </TD>
                      <TD numeric label="Answers">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => toggleAttempt(attempt)}
                        >
                          {expanded ? 'Hide answers' : 'View answers'}
                        </Button>
                      </TD>
                    </TR>
                    {expanded && (
                      <TR>
                        <TD colSpan={5} className="bg-[var(--color-surface-hover)] p-4 td-detail">
                          {loadingReview ? (
                            <div className="flex justify-center py-6">
                              <Spinner />
                            </div>
                          ) : review ? (
                            <Table cards caption="Item by item answers">
                              <THead>
                                <TR>
                                  <TH align="right">#</TH>
                                  <TH>Question</TH>
                                  <TH>Student answer</TH>
                                  <TH>Correct answer</TH>
                                  <TH>Result</TH>
                                  <TH align="right">Points</TH>
                                </TR>
                              </THead>
                              <TBody>
                                {review.items.map((item, i) => (
                                  <TR key={item.question_id} className="align-top">
                                    <TD numeric label="Item" className="text-muted">
                                      {item.position ?? i + 1}
                                    </TD>
                                    <TD primary label="Question" className="text-foreground">
                                      <span className="whitespace-pre-wrap">{item.question_text}</span>
                                      {item.image_url && (
                                        <img
                                          src={item.image_url}
                                          alt=""
                                          className="mt-2 h-20 w-auto rounded border object-cover"
                                          loading="lazy"
                                        />
                                      )}
                                    </TD>
                                    <TD
                                      label="Student answer"
                                      className={
                                        item.is_correct === true
                                          ? 'font-medium text-[var(--color-success)]'
                                          : item.is_correct === false
                                            ? 'font-medium text-[var(--color-danger)]'
                                            : 'text-[var(--color-foreground)]'
                                      }
                                    >
                                      {item.student_answer || (
                                        <span className="text-[var(--color-muted)]">No answer</span>
                                      )}
                                    </TD>
                                    <TD label="Correct answer" className="text-foreground">
                                      {item.correct_answer ?? '—'}
                                      {item.accepted_answers.length > 0 && (
                                        <span className="block text-xs text-muted">
                                          Also accepted: {item.accepted_answers.join(', ')}
                                        </span>
                                      )}
                                    </TD>
                                    <TD label="Result">
                                      {item.is_correct === null ? (
                                        <Badge variant="default">—</Badge>
                                      ) : (
                                        <Badge variant={item.is_correct ? 'success' : 'danger'}>
                                          {item.is_correct ? 'Correct' : 'Incorrect'}
                                        </Badge>
                                      )}
                                    </TD>
                                    <TD numeric label="Points" className="text-foreground">
                                      {item.earned_points ?? 0}/{item.points}
                                    </TD>
                                  </TR>
                                ))}
                              </TBody>
                            </Table>
                          ) : (
                            <p className="py-4 text-center text-sm text-muted">
                              No answers recorded for this attempt.
                            </p>
                          )}
                        </TD>
                      </TR>
                    )}
                  </Fragment>
                );
              })}
            </TBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
