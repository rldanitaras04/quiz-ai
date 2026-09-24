'use client';

import { useState, useEffect, type JSX } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Input from '@/components/ui/Input';
import Modal from '@/components/ui/Modal';
import EmptyState from '@/components/ui/EmptyState';
import { Card, CardHeader, CardContent, CardFooter } from '@/components/ui/Card';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table';
import QuestionEditor from '@/components/assessment/QuestionEditor';
import { confirmAction, notifyError, notifySuccess } from '@/components/ui/alerts';
import {
  ASSESSMENT_STATUS_LABELS,
  BLOOM_LABELS,
  DIFFICULTY_LABELS,
  QUESTION_TYPE_LABELS,
} from '@/lib/constants';
import {
  addQuestion,
  createNewVersion,
  deleteQuestion,
  publishAssessment,
  updateAssessment,
  updateQuestion,
  getSourceForQuestion,
  type AssessmentDetail,
  type AssessmentDetailQuestion,
  type QuestionSourceInfo,
} from '@/app/(dashboard)/faculty/subjects/[offeringId]/assessments/actions';
import { getTopicsForOffering } from '@/app/(dashboard)/faculty/subjects/[offeringId]/topics/actions';
import { saveAssessmentQuestionToBank } from '@/app/(dashboard)/faculty/subjects/[offeringId]/question-bank/actions';
import DeleteAssessmentButton from '@/app/(dashboard)/faculty/subjects/[offeringId]/assessments/[assessmentId]/DeleteAssessmentButton';
import DownloadTosButton from '@/app/(dashboard)/faculty/subjects/[offeringId]/assessments/[assessmentId]/DownloadTosButton';
import type { DraftQuestion, DraftQuestionChoice, Topic } from '@/lib/types';

interface AssessmentDetailClientProps {
  detail: AssessmentDetail;
  /** "CS101 - Section A", used in confirm and toast copy. */
  subjectName: string;
}

/** A question the user has not saved yet, shaped like the wizard's drafts. */
function blankQuestion(versionId: string): DraftQuestion {
  const id = `nc-${Date.now()}`;
  return {
    id,
    assessment_version_id: versionId,
    question_type: 'multiple_choice',
    question_text: '',
    difficulty: 'moderate',
    bloom_level: 'understand',
    points: 1,
    position: 0,
    status: 'active',
    created_by: '',
    is_ai_generated: false,
    generation_metadata: null,
    created_at: '',
    updated_at: '',
    image_url: null,
    image_storage_path: null,
    question_choices: ['A', 'B', 'C', 'D'].map((key, index) => ({
      id: `${id}-${key}`,
      question_id: id,
      choice_key: key,
      choice_text: '',
      position: index,
      created_at: '',
      updated_at: '',
      is_correct: false,
    })),
    canonical_answer: '',
  };
}

/** Adapts a persisted question to the editor: correctness lives in answer_keys. */
function toDraft(question: AssessmentDetailQuestion, versionId: string): DraftQuestion {
  return {
    id: question.id,
    assessment_version_id: versionId,
    question_type: question.question_type,
    question_text: question.question_text,
    difficulty: question.difficulty,
    bloom_level: question.bloom_level,
    points: question.points,
    position: question.position ?? 0,
    status: 'active',
    created_by: '',
    is_ai_generated: question.is_ai_generated,
    generation_metadata: null,
    created_at: '',
    updated_at: '',
    topic_id: (question as any).topicId ?? null,
    topic_title: (question as any).topicTitle ?? undefined,
    image_url: (question as any).imageUrl ?? null,
    image_storage_path: (question as any).imageStoragePath ?? null,
    question_choices: question.choices.map((choice, index) => ({
      id: choice.id,
      question_id: question.id,
      choice_key: choice.choice_key,
      choice_text: choice.choice_text,
      position: index,
      created_at: '',
      updated_at: '',
      is_correct: choice.id === question.correctChoiceId,
    })),
    canonical_answer: question.canonicalAnswer ?? '',
  };
}

function isAnswered(question: AssessmentDetailQuestion): boolean {
  if (question.question_type === 'multiple_choice' || question.question_type === 'true_false') {
    return Boolean(question.correctChoiceId);
  }
  return Boolean(question.canonicalAnswer?.trim());
}

/** "B. Manila" for MCQ/TF, the canonical answer for identification. */
function answerSummary(question: AssessmentDetailQuestion): string | null {
  if (question.question_type === 'multiple_choice' || question.question_type === 'true_false') {
    const correct = question.choices.find((choice) => choice.id === question.correctChoiceId);
    return correct ? `${correct.choice_key}. ${correct.choice_text}` : null;
  }
  return question.canonicalAnswer?.trim() || null;
}

/** Local ids (never sent to the database) mark a choice as newly added. */
function choicePayload(choice: DraftQuestionChoice): {
  id?: string;
  choice_key: string;
  choice_text: string;
} {
  const base = { choice_key: choice.choice_key, choice_text: choice.choice_text.trim() };
  return choice.id.startsWith('nc-') ? base : { ...base, id: choice.id };
}

export default function AssessmentDetailClient({
  detail,
  subjectName,
}: AssessmentDetailClientProps): JSX.Element {
  const router = useRouter();

  const [draft, setDraft] = useState<DraftQuestion | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savingQuestion, setSavingQuestion] = useState(false);

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [title, setTitle] = useState(detail.title);
  const [instructions, setInstructions] = useState(detail.instructions ?? '');
  const [savingDetails, setSavingDetails] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [creatingVersion, setCreatingVersion] = useState(false);

  const [sourceModalOpen, setSourceModalOpen] = useState(false);
  const [sourceQuestionText, setSourceQuestionText] = useState('');
  const [sourceInfo, setSourceInfo] = useState<QuestionSourceInfo[]>([]);
  const [loadingSource, setLoadingSource] = useState(false);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [savingToBankId, setSavingToBankId] = useState<string | null>(null);

  // Load topics for picker and bank save
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const t = await getTopicsForOffering(detail.subjectOfferingId);
        if (!cancelled) setTopics(t);
      } catch { /* ignore if topics table missing */ }
    })();
    return () => { cancelled = true; };
  }, [detail.subjectOfferingId]);
  const versionId = detail.version?.id ?? '';
  const statusLabel =
    ASSESSMENT_STATUS_LABELS[detail.status as keyof typeof ASSESSMENT_STATUS_LABELS] ??
    detail.status;

  const openNewQuestion = () => {
    setEditingId(null);
    setDraft(blankQuestion(versionId));
  };

  const openQuestion = (question: AssessmentDetailQuestion) => {
    setEditingId(question.id);
    setDraft(toDraft(question, versionId));
  };

  const closeQuestion = () => {
    setDraft(null);
    setEditingId(null);
  };

  const handleSaveQuestion = async () => {
    if (!draft) return;

    const isMultipleChoice = draft.question_type === 'multiple_choice';
    const isTrueFalse = draft.question_type === 'true_false';
    const isChoiceBased = isMultipleChoice || isTrueFalse;
    const filledChoices = isTrueFalse
      ? draft.question_choices
      : draft.question_choices.filter((choice) => choice.choice_text.trim());

    if (!draft.question_text.trim()) {
      notifyError('Question text is required');
      return;
    }
    if (isMultipleChoice) {
      if (filledChoices.length < 2) {
        notifyError('Add at least two choices', 'A multiple choice question needs two answers or more.');
        return;
      }
      if (!filledChoices.some((choice) => choice.is_correct)) {
        notifyError('Mark the correct choice', 'Select which choice is the right answer.');
        return;
      }
    } else if (isTrueFalse) {
      if (!filledChoices.some((choice) => choice.is_correct)) {
        notifyError('Mark True or False as correct', 'Select which answer is correct for this statement.');
        return;
      }
    } else if (!(draft.canonical_answer ?? '').trim()) {
      notifyError('Add the expected answer', 'Identification questions need a canonical answer to grade against.');
      return;
    }

    const payload = {
      question_type: draft.question_type,
      question_text: draft.question_text.trim(),
      difficulty: draft.difficulty,
      bloom_level: draft.bloom_level,
      points: draft.points,
      topic_id: (draft as any).topic_id ?? null,
      image_url: (draft as any).image_url ?? null,
      image_storage_path: (draft as any).image_storage_path ?? null,
      // An empty list clears choices when a question switches to identification.
      choices: isChoiceBased ? filledChoices.map(choicePayload) : [],
      correct_choice_key: isChoiceBased
        ? filledChoices.find((choice) => choice.is_correct)?.choice_key
        : undefined,
      canonical_answer: isChoiceBased ? undefined : (draft.canonical_answer ?? '').trim(),
    };

    setSavingQuestion(true);
    try {
      if (editingId) {
        await updateQuestion(editingId, payload);
        notifySuccess('Question updated');
      } else {
        await addQuestion(detail.id, payload);
        notifySuccess('Question added');
      }
      closeQuestion();
      router.refresh();
    } catch (error) {
      notifyError(
        'Could not save the question',
        error instanceof Error ? error.message : 'Unknown error'
      );
    } finally {
      setSavingQuestion(false);
    }
  };

  const removeQuestion = async (question: AssessmentDetailQuestion) => {
    try {
      await deleteQuestion(question.id);
      notifySuccess('Question deleted');
      router.refresh();
    } catch (error) {
      notifyError(
        'Could not delete the question',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  };

  const handleEditorDelete = async () => {
    // The editor has already asked for confirmation.
    if (!editingId) {
      closeQuestion();
      return;
    }
    const deletedId = editingId;
    closeQuestion();
    try {
      await deleteQuestion(deletedId);
      notifySuccess('Question deleted');
      router.refresh();
    } catch (error) {
      notifyError(
        'Could not delete the question',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  };

  const handleSaveDetails = async () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      notifyError('A title is required');
      return;
    }

    setSavingDetails(true);
    try {
      await updateAssessment(detail.id, { title: trimmedTitle, instructions });
      notifySuccess('Assessment updated');
      setDetailsOpen(false);
      router.refresh();
    } catch (error) {
      notifyError(
        'Could not update the assessment',
        error instanceof Error ? error.message : 'Unknown error'
      );
    } finally {
      setSavingDetails(false);
    }
  };

  const handlePublish = async () => {
    const confirmed = await confirmAction({
      title: 'Publish this assessment?',
      text: `Students enrolled in ${subjectName} are notified that "${detail.title}" is ready.`,
      confirmText: 'Publish',
    });
    if (!confirmed) return;

    setPublishing(true);
    try {
      await publishAssessment(detail.id);
      notifySuccess('Assessment published', 'Students in this offering have been notified.');
      router.refresh();
    } catch (error) {
      notifyError(
        'Could not publish the assessment',
        error instanceof Error ? error.message : 'Unknown error'
      );
    } finally {
      setPublishing(false);
    }
  };

  const handleCreateNewVersion = async () => {
    const confirmed = await confirmAction({
      title: 'Create a new version?',
      text: 'This creates a blank draft version you can fill with new questions. Existing deployments are unaffected.',
      confirmText: 'Create version',
    });
    if (!confirmed) return;

    setCreatingVersion(true);
    try {
      const result = await createNewVersion(detail.id);
      if (!result.success) {
        throw new Error(result.error);
      }
      notifySuccess('New version created', 'You can now add or generate questions for this version.');
      router.refresh();
    } catch (error) {
      notifyError(
        'Could not create new version',
        error instanceof Error ? error.message : 'Unknown error'
      );
    } finally {
      setCreatingVersion(false);
    }
  };

  const handleViewSource = async (question: AssessmentDetailQuestion) => {
    setSourceModalOpen(true);
    setSourceQuestionText(question.question_text);
    setSourceInfo([]);
    setLoadingSource(true);

    const result = await getSourceForQuestion(question.id);
    setLoadingSource(false);

    if (result.error) {
      notifyError('Failed to load source', result.error);
    } else {
      setSourceInfo(result.data ?? []);
    }
  };

  const handleSaveToBank = async (question: AssessmentDetailQuestion) => {
    const confirmed = await confirmAction({
      title: 'Save to question bank?',
      text: `Add "${question.question_text.slice(0, 80)}..." to this subject's reusable pool? It will be categorized by topic.`,
      confirmText: 'Save to bank',
    });
    if (!confirmed) return;
    setSavingToBankId(question.id);
    try {
      const res = await saveAssessmentQuestionToBank(question.id);
      notifySuccess('Saved to question bank', 'Reusable from the Question Bank tab, grouped by topic.');
    } catch (e) {
      notifyError('Could not save to bank', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setSavingToBankId(null);
    }
  };

  const summary: { label: string; value: string }[] = [
    { label: 'Status', value: statusLabel },
    { label: 'Version', value: detail.version ? `v${detail.version.versionNumber}` : '—' },
    { label: 'Questions', value: String(detail.version?.totalItems ?? detail.questions.length) },
    { label: 'Total points', value: String(detail.version?.totalPoints ?? 0) },
    {
      label: 'Answer keys',
      value: `${detail.questions.filter(isAnswered).length} of ${detail.questions.length}`,
    },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-[var(--color-foreground)]">
              Assessment details
            </h2>
            <Badge variant={detail.status === 'published' ? 'success' : 'warning'}>
              {statusLabel}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setDetailsOpen(true)}>
              Edit details
            </Button>
            {detail.status !== 'published' && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void handlePublish()}
                loading={publishing}
                disabled={!detail.version}
              >
                Publish
              </Button>
            )}
            <Link href={`/faculty/subjects/${detail.subjectOfferingId}/assessments/${detail.id}/deploy`}>
              <Button variant="primary" size="sm">
                Deploy
              </Button>
            </Link>
            <DownloadTosButton assessmentId={detail.id} assessmentTitle={detail.title} />
            {detail.questionsLocked && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void handleCreateNewVersion()}
                loading={creatingVersion}
              >
                New version
              </Button>
            )}
            <DeleteAssessmentButton
              assessmentId={detail.id}
              title={detail.title}
              redirectTo={`/faculty/subjects/${detail.subjectOfferingId}/assessments`}
            />
          </div>
        </CardHeader>

        <CardContent>
          <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {summary.map((item) => (
              <div key={item.label}>
                <dt className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
                  {item.label}
                </dt>
                <dd className="mt-1 text-sm font-medium tabular-nums text-[var(--color-foreground)]">
                  {item.value}
                </dd>
              </div>
            ))}
          </dl>

          {detail.instructions && (
            <div className="mt-5 border-t border-[var(--color-border)] pt-4">
              <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
                Instructions
              </h3>
              <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--color-foreground)]">
                {detail.instructions}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Version history */}
      {detail.versions.length > 0 && (
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-[var(--color-foreground)]">
              Version history ({detail.versions.length})
            </h2>
          </CardHeader>
          <Table caption="All versions of this assessment">
            <THead>
              <TR>
                <TH align="right">Version</TH>
                <TH>Status</TH>
                <TH align="right">Items</TH>
                <TH align="right">Points</TH>
              </TR>
            </THead>
            <TBody>
              {detail.versions.map((v) => (
                <TR
                  key={v.id}
                  className={v.id === detail.version?.id ? 'bg-[var(--color-primary-light)]' : ''}
                >
                  <TD numeric className="font-medium text-[var(--color-foreground)]">
                    v{v.versionNumber}
                    {v.id === detail.version?.id && (
                      <span className="ml-1.5 text-xs text-[var(--color-primary)]">(current)</span>
                    )}
                  </TD>
                  <TD>
                    <Badge variant={v.status === 'published' ? 'success' : v.status === 'approved' ? 'info' : 'warning'}>
                      {ASSESSMENT_STATUS_LABELS[v.status as keyof typeof ASSESSMENT_STATUS_LABELS] ?? v.status}
                    </Badge>
                  </TD>
                  <TD numeric className="text-[var(--color-foreground)]">
                    {v.totalItems}
                  </TD>
                  <TD numeric className="text-[var(--color-foreground)]">
                    {v.totalPoints}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}

      {/* Deployment status */}
      {detail.deployments.length > 0 && (
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-[var(--color-foreground)]">
              Deployments ({detail.deployments.length})
            </h2>
          </CardHeader>
          <Table caption="Deployments for this assessment">
            <THead>
              <TR>
                <TH>Status</TH>
                <TH align="right">Version</TH>
                <TH align="right">Items</TH>
                <TH align="right">Duration</TH>
                <TH>Window</TH>
                <TH align="right">Attempts</TH>
              </TR>
            </THead>
            <TBody>
              {detail.deployments.map((d) => (
                <TR key={d.id}>
                  <TD>
                    <Badge variant={d.status === 'active' ? 'success' : d.status === 'scheduled' ? 'info' : 'default'}>
                      {d.status}
                    </Badge>
                  </TD>
                  <TD numeric className="text-[var(--color-foreground)]">
                    v{d.version_number}
                  </TD>
                  <TD numeric className="text-[var(--color-foreground)]">
                    {d.total_items}
                  </TD>
                  <TD numeric className="text-[var(--color-muted)]">
                    {d.duration_minutes} min
                  </TD>
                  <TD className="text-xs text-[var(--color-muted)]">
                    {new Date(d.opens_at).toLocaleString()}
                    <span className="block">→ {new Date(d.closes_at).toLocaleString()}</span>
                  </TD>
                  <TD numeric className="text-[var(--color-muted)]">
                    {d.attempt_limit}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-[var(--color-foreground)]">
            Questions ({detail.questions.length})
          </h2>
          {detail.questionsLocked ? (
            <span className="text-xs text-[var(--color-muted)]">
              Read-only — this version is published or already deployed
            </span>
          ) : (
            <Button
              variant="primary"
              size="sm"
              onClick={openNewQuestion}
              disabled={!detail.version}
            >
              Add question
            </Button>
          )}
        </CardHeader>

        {detail.questions.length > 0 ? (
          <Table caption="Questions in this assessment">
            <THead>
              <TR>
                <TH align="right">#</TH>
                <TH>Question</TH>
                <TH>Topic</TH>
                <TH>Type</TH>
                <TH>Difficulty</TH>
                <TH>Bloom</TH>
                <TH>Answer key</TH>
                <TH align="right">Points</TH>
                <TH align="right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {detail.questions.map((question, index) => {
                const answer = answerSummary(question);
                const qTopic = (question as any).topicTitle as string | null;
                const qTopicId = (question as any).topicId as string | null;
                return (
                  <TR key={question.id} className="align-top">
                    <TD numeric className="text-[var(--color-muted)]">
                      {question.position ?? index + 1}
                    </TD>
                    <TD className="max-w-md">
                      <span className="line-clamp-2 text-[var(--color-foreground)]">
                        {question.question_text}
                      </span>
                      {(question as any).imageUrl && (
                        <img src={(question as any).imageUrl as string} alt="" className="mt-2 h-16 w-auto rounded border object-cover" loading="lazy" />
                      )}
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {question.is_ai_generated && (
                          <Badge variant="info">AI</Badge>
                        )}
                        {qTopic ? <Badge variant="default">{qTopic}</Badge> : <Badge variant="outline">No topic</Badge>}
                        {(question as any).imageUrl && <Badge variant="info">Image</Badge>}
                      </div>
                    </TD>
                    <TD className="text-[var(--color-muted)] whitespace-nowrap">
                      {qTopic ? (
                        <Badge variant="default" className="max-w-[120px] truncate">{qTopic}</Badge>
                      ) : (
                        <span className="text-xs text-[var(--color-muted-light)]">—</span>
                      )}
                    </TD>
                    <TD className="text-[var(--color-muted)]">
                      {QUESTION_TYPE_LABELS[question.question_type]}
                    </TD>
                    <TD className="text-[var(--color-muted)]">
                      {DIFFICULTY_LABELS[question.difficulty]}
                    </TD>
                    <TD className="text-[var(--color-muted)]">
                      {BLOOM_LABELS[question.bloom_level]}
                    </TD>
                    <TD className="max-w-xs">
                      {answer ? (
                        <span className="line-clamp-2 text-[var(--color-foreground)]">{answer}</span>
                      ) : (
                        <Badge variant="danger">Missing</Badge>
                      )}
                    </TD>
                    <TD numeric className="text-[var(--color-foreground)]">
                      {question.points}
                    </TD>
                    <TD className="whitespace-nowrap text-right">
                      {detail.questionsLocked ? (
                        <span className="text-sm text-[var(--color-muted)]">—</span>
                      ) : (
                        <div className="flex flex-col items-end gap-1">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => void handleViewSource(question)}
                              className="text-xs font-medium text-[var(--color-muted)] hover:underline"
                              title="View source material"
                            >
                              Source
                            </button>
                            <span className="text-[var(--color-border)]">|</span>
                            <button
                              type="button"
                              onClick={() => openQuestion(question)}
                              className="text-xs font-medium text-[var(--color-primary)] hover:underline"
                            >
                              Edit
                            </button>
                            <span className="text-[var(--color-border)]">|</span>
                            <button
                              type="button"
                              onClick={() => void removeQuestion(question)}
                              className="text-xs font-medium text-[var(--color-danger)] hover:underline"
                            >
                              Delete
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={() => void handleSaveToBank(question)}
                            disabled={savingToBankId === question.id}
                            className="text-xs font-medium text-[var(--color-primary)] hover:underline disabled:opacity-50"
                          >
                            {savingToBankId === question.id ? 'Saving…' : 'Save to Bank'}
                          </button>
                        </div>
                      )}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        ) : (
          <EmptyState
            title="No questions yet"
            description="Generate questions with the authoring wizard, or add one here by hand."
          />
        )}

        <CardFooter className="text-xs text-[var(--color-muted)]">
          {detail.questionsLocked
            ? 'Questions are frozen because student attempts reference their choice ids. Reach the class with a new assessment instead.'
            : 'Editing a question saves immediately — nothing reaches students until you deploy this version.'}
        </CardFooter>
      </Card>

      {/* Question editor */}
      <Modal
        open={draft !== null}
        onClose={closeQuestion}
        title={editingId ? 'Edit question' : 'New question'}
        actions={
          <>
            <Button variant="secondary" onClick={closeQuestion} disabled={savingQuestion}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => void handleSaveQuestion()}
              loading={savingQuestion}
            >
              {editingId ? 'Save changes' : 'Add question'}
            </Button>
          </>
        }
      >
        {draft && (
          <div className="space-y-4">
            {topics.length > 0 && (
              <div className="flex items-center gap-3 p-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-hover)]">
                <label className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)] whitespace-nowrap">Topic</label>
                <select
                  value={(draft as any).topic_id ?? ''}
                  onChange={(e) => setDraft((cur) => cur ? ({ ...cur, topic_id: e.target.value || null } as any) : cur)}
                  className="flex-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-sm"
                >
                  <option value="">— Uncategorized —</option>
                  {topics.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                </select>
              </div>
            )}
            <QuestionEditor
              question={draft}
              index={0}
              total={1}
              onUpdate={(updates) => setDraft((current) => (current ? { ...current, ...updates } : current))}
              onDelete={() => void handleEditorDelete()}
              onNavigate={() => undefined}
              deleteTitle="Delete this question?"
              deleteText="The question and its choices are removed from this assessment."
              offeringId={detail.subjectOfferingId}
            />
          </div>
        )}
      </Modal>

      {/* Assessment details */}
      <Modal
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        title="Assessment details"
        actions={
          <>
            <Button variant="secondary" onClick={() => setDetailsOpen(false)} disabled={savingDetails}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => void handleSaveDetails()}
              loading={savingDetails}
            >
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Title"
            value={title}
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
          />
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="assessment-instructions"
              className="text-sm font-medium text-[var(--color-foreground)]"
            >
              Instructions
            </label>
            <textarea
              id="assessment-instructions"
              rows={5}
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              placeholder="Shown to students before they begin..."
              className="w-full resize-none rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-foreground)] placeholder:text-[var(--color-muted-light)] transition-colors focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-focus-ring)] focus:outline-none"
            />
          </div>
        </div>
      </Modal>

      {/* Source Material Modal */}
      <Modal
        open={sourceModalOpen}
        onClose={() => setSourceModalOpen(false)}
        title="Source Material"
      >
        <div className="space-y-4">
          <div className="p-3 rounded-[var(--radius-md)] bg-[var(--color-surface-hover)]">
            <p className="text-xs font-medium text-[var(--color-muted)] uppercase tracking-wide mb-1">Question</p>
            <p className="text-sm text-[var(--color-foreground)] line-clamp-3">{sourceQuestionText}</p>
          </div>

          {loadingSource ? (
            <div className="flex justify-center py-6">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--color-primary)] border-t-transparent" />
            </div>
          ) : sourceInfo.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-sm text-[var(--color-muted)]">No source material linked to this question.</p>
              <p className="text-xs text-[var(--color-muted)] mt-1">This may be a manually created question.</p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs font-medium text-[var(--color-muted)] uppercase tracking-wide">
                {sourceInfo.length} source chunk{sourceInfo.length !== 1 ? 's' : ''} linked
              </p>
              {sourceInfo.map((source, idx) => (
                <div
                  key={source.source_chunk_id}
                  className="p-3 rounded-[var(--radius-md)] border border-[var(--color-border)]"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-[var(--color-primary)]">
                      {source.source_material_title}
                      {source.is_primary && (
                        <span className="ml-1 text-[var(--color-muted)]">(primary)</span>
                      )}
                    </span>
                    <span className="text-xs text-[var(--color-muted)]">
                      Relevance: {(source.relevance_score * 100).toFixed(0)}%
                    </span>
                  </div>
                  <p className="text-xs text-[var(--color-foreground)] line-clamp-4 whitespace-pre-wrap">
                    {source.chunk_content}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
