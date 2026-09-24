'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Badge from '@/components/ui/Badge';
import Modal from '@/components/ui/Modal';
import { notifyError, notifySuccess } from '@/components/ui/alerts';
import { createDeployment } from './actions';
import type {
  AssessmentVersion,
  DeploymentLaunchMode,
  QuestionOrderMode,
  ChoiceOrderMode,
  ScoreReleaseMode,
} from '@/lib/types';

interface DeployPageProps {
  assessmentId: string;
  offeringId: string;
  assessmentTitle: string;
  versions: AssessmentVersion[];
  subjectName: string;
  defaultVersionId: string;
}

const LAUNCH_OPTIONS: { value: DeploymentLaunchMode; label: string; hint: string }[] = [
  { value: 'now', label: 'Open right away', hint: 'Students can start as soon as it is created.' },
  { value: 'scheduled', label: 'Schedule', hint: 'Pick open and close times in advance.' },
  { value: 'manual', label: 'Manual open / close', hint: 'Create as draft; open and close from Deployments.' },
];

export default function DeployClient({
  assessmentId,
  offeringId,
  assessmentTitle,
  versions,
  subjectName,
  defaultVersionId,
}: DeployPageProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [launchMode, setLaunchMode] = useState<DeploymentLaunchMode>('scheduled');

  const [selectedVersionId, setSelectedVersionId] = useState(
    defaultVersionId ||
      versions.find((v) => v.status === 'published')?.id ||
      versions[0]?.id ||
      ''
  );
  const [opensAt, setOpensAt] = useState('');
  const [closesAt, setClosesAt] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [attemptLimit, setAttemptLimit] = useState(1);
  const [questionOrderMode, setQuestionOrderMode] = useState<QuestionOrderMode>('shuffled');
  const [choiceOrderMode, setChoiceOrderMode] = useState<ChoiceOrderMode>('fixed');
  const [scoreReleaseMode, setScoreReleaseMode] = useState<ScoreReleaseMode>('immediate');
  const [showRawScore, setShowRawScore] = useState(true);
  const [showPercentage, setShowPercentage] = useState(true);
  const [showItemCorrectness, setShowItemCorrectness] = useState(false);
  const [showCorrectAnswers, setShowCorrectAnswers] = useState(false);
  const [showExplanations, setShowExplanations] = useState(false);
  const [requiresIdentityVerification, setRequiresIdentityVerification] = useState(false);

  const selectedVersion = versions.find((v) => v.id === selectedVersionId);
  const needsOpenTime = launchMode === 'scheduled';
  const needsCloseTime = launchMode === 'scheduled' || launchMode === 'now';

  const handleDeploy = async () => {
    if (!selectedVersionId) {
      setError('Select an assessment version');
      return;
    }
    if (needsCloseTime && !closesAt) {
      setError('Closing time is required');
      return;
    }
    if (needsOpenTime && !opensAt) {
      setError('Opening time is required');
      return;
    }
    if (needsOpenTime && needsCloseTime && new Date(opensAt) >= new Date(closesAt)) {
      setError('Close time must be after open time');
      return;
    }
    if (launchMode === 'now' && new Date() >= new Date(closesAt)) {
      setError('Close time must be in the future');
      return;
    }

    if (durationMinutes < 1) {
      setError('Duration must be at least 1 minute');
      return;
    }

    setLoading(true);
    setError(null);

    const result = await createDeployment(assessmentId, offeringId, {
      assessment_version_id: selectedVersionId,
      subject_offering_id: offeringId,
      launch_mode: launchMode,
      opens_at: needsOpenTime && opensAt ? new Date(opensAt).toISOString() : new Date().toISOString(),
      closes_at: needsCloseTime && closesAt ? new Date(closesAt).toISOString() : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      duration_minutes: durationMinutes,
      attempt_limit: attemptLimit,
      question_order_mode: questionOrderMode,
      choice_order_mode: choiceOrderMode,
      score_release_mode: scoreReleaseMode,
      show_raw_score: showRawScore,
      show_percentage: showPercentage,
      show_item_correctness: showItemCorrectness,
      show_correct_answers: showCorrectAnswers,
      show_explanations: showExplanations,
      requires_identity_verification: requiresIdentityVerification,
    });

    if (result.success) {
      notifySuccess(
        'Assessment deployed',
        launchMode === 'manual'
          ? 'Created as a draft. Open it from Deployments when you are ready.'
          : launchMode === 'now'
            ? 'Students can take this assessment until the window you set.'
            : 'Students will be notified of the schedule you set.'
      );
      router.push(`/faculty/subjects/${offeringId}/deployments`);
      router.refresh();
    } else {
      const message = result.error ?? 'Failed to create deployment';
      setError(message);
      notifyError('Could not deploy the assessment', message);
      setLoading(false);
    }
  };

  const scheduleSummary =
    launchMode === 'manual'
      ? 'Draft — open manually from Deployments'
      : launchMode === 'now'
        ? `Opens now → ${closesAt ? new Date(closesAt).toLocaleString() : '—'}`
        : `${opensAt ? new Date(opensAt).toLocaleString() : '—'} → ${closesAt ? new Date(closesAt).toLocaleString() : '—'}`;

  return (
    <div>
      <PageHeader
        title="Deploy Assessment"
        description={`Deploying: ${assessmentTitle}`}
        breadcrumbs={[
          { label: 'Subjects', href: '/faculty/subjects' },
          { label: subjectName, href: `/faculty/subjects/${offeringId}` },
          { label: assessmentTitle },
          { label: 'Deploy' },
        ]}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <h2 className="text-lg font-semibold">When to open</h2>
            </CardHeader>
            <CardContent className="space-y-4">
              <Select
                label="Launch mode"
                value={launchMode}
                onChange={(e) => setLaunchMode(e.target.value as DeploymentLaunchMode)}
              >
                {LAUNCH_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-[var(--color-muted)]">
                {LAUNCH_OPTIONS.find((o) => o.value === launchMode)?.hint}
              </p>

              {/* Without a picker the deployment always used the default
                  version, so "deploy version X" was impossible. */}
              <Select
                label="Assessment version"
                value={selectedVersionId}
                onChange={(e) => setSelectedVersionId(e.target.value)}
              >
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    v{v.version_number} — {v.status} ({v.total_items} items,{' '}
                    {v.total_points} pts)
                  </option>
                ))}
              </Select>
              {selectedVersion && (
                <p className="text-xs text-[var(--color-muted)]">
                  Students will take this version. The assessment must be published.
                </p>
              )}

              {needsOpenTime && (
                <Input
                  label="Opens at"
                  type="datetime-local"
                  value={opensAt}
                  onChange={(e) => setOpensAt(e.target.value)}
                  required
                />
              )}
              {needsCloseTime && (
                <Input
                  label="Closes at"
                  type="datetime-local"
                  value={closesAt}
                  onChange={(e) => setClosesAt(e.target.value)}
                  required
                />
              )}
              {launchMode === 'manual' && (
                <p className="text-xs text-[var(--color-muted)]">
                  You choose when to open and close from the Deployments list.
                </p>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Duration (minutes)"
                  type="number"
                  min={1}
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(Number(e.target.value))}
                  required
                />
                <Input
                  label="Attempt limit"
                  type="number"
                  min={1}
                  max={10}
                  value={attemptLimit}
                  onChange={(e) => setAttemptLimit(Number(e.target.value))}
                  required
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-lg font-semibold">Question & Choice Order</h2>
            </CardHeader>
            <CardContent className="space-y-4">
              <Select
                label="Question order"
                value={questionOrderMode}
                onChange={(e) => setQuestionOrderMode(e.target.value as QuestionOrderMode)}
              >
                <option value="fixed">Fixed (as created)</option>
                <option value="shuffled">Shuffled (random per student)</option>
              </Select>
              <Select
                label="Choice order"
                value={choiceOrderMode}
                onChange={(e) => setChoiceOrderMode(e.target.value as ChoiceOrderMode)}
              >
                <option value="fixed">Fixed (as created)</option>
                <option value="shuffled">Shuffled (random per student)</option>
              </Select>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-lg font-semibold">Score Release</h2>
            </CardHeader>
            <CardContent className="space-y-4">
              <Select
                label="Release mode"
                value={scoreReleaseMode}
                onChange={(e) => setScoreReleaseMode(e.target.value as ScoreReleaseMode)}
              >
                <option value="immediate">Immediate (after submission)</option>
                <option value="after_all_submitted">After all submitted</option>
                <option value="manual_release">Manual release</option>
                <option value="scheduled">Scheduled</option>
              </Select>

              <div className="space-y-3">
                <p className="text-sm font-medium">Show students:</p>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={showRawScore}
                    onChange={(e) => setShowRawScore(e.target.checked)}
                    className="h-4 w-4 rounded text-primary focus:ring-primary"
                  />
                  <span className="text-sm">Raw score</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={showPercentage}
                    onChange={(e) => setShowPercentage(e.target.checked)}
                    className="h-4 w-4 rounded text-primary focus:ring-primary"
                  />
                  <span className="text-sm">Percentage</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={showItemCorrectness}
                    onChange={(e) => setShowItemCorrectness(e.target.checked)}
                    className="h-4 w-4 rounded text-primary focus:ring-primary"
                  />
                  <span className="text-sm">Per-question correctness</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={showCorrectAnswers}
                    onChange={(e) => setShowCorrectAnswers(e.target.checked)}
                    className="h-4 w-4 rounded text-primary focus:ring-primary"
                  />
                  <span className="text-sm">Correct answers</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={showExplanations}
                    onChange={(e) => setShowExplanations(e.target.checked)}
                    className="h-4 w-4 rounded text-primary focus:ring-primary"
                  />
                  <span className="text-sm">Explanations</span>
                </label>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-lg font-semibold">Security</h2>
            </CardHeader>
            <CardContent>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={requiresIdentityVerification}
                  onChange={(e) => setRequiresIdentityVerification(e.target.checked)}
                  className="h-4 w-4 rounded text-primary focus:ring-primary"
                />
                <div>
                  <span className="text-sm font-medium">Require identity verification</span>
                  <p className="text-xs text-muted">Students must verify identity before starting</p>
                </div>
              </label>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="sticky top-6">
            <CardHeader>
              <h2 className="text-lg font-semibold">Deployment Summary</h2>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted">Version</span>
                  <span className="font-medium">
                    {selectedVersion ? `v${selectedVersion.version_number}` : 'Not selected'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Items</span>
                  <span className="font-medium">{selectedVersion?.total_items ?? 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Points</span>
                  <span className="font-medium">{selectedVersion?.total_points ?? 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Window</span>
                  <span className="text-right text-xs">{scheduleSummary}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Duration</span>
                  <span className="font-medium">{durationMinutes} min</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Attempts</span>
                  <span className="font-medium">{attemptLimit}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Questions</span>
                  <Badge variant={questionOrderMode === 'shuffled' ? 'info' : 'default'}>
                    {questionOrderMode}
                  </Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Choices</span>
                  <Badge variant={choiceOrderMode === 'shuffled' ? 'info' : 'default'}>
                    {choiceOrderMode}
                  </Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Score release</span>
                  <Badge variant="success">{scoreReleaseMode.replace(/_/g, ' ')}</Badge>
                </div>
              </div>

              {error && (
                <p className="text-sm text-danger">{error}</p>
              )}

              <Button
                onClick={() => setShowPreview(true)}
                variant="secondary"
                className="w-full"
              >
                Preview & Deploy
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      <Modal
        open={showPreview}
        onClose={() => setShowPreview(false)}
        title="Confirm Deployment"
        actions={
          <>
            <Button variant="ghost" onClick={() => setShowPreview(false)}>
              Cancel
            </Button>
            <Button onClick={handleDeploy} loading={loading}>
              Create Deployment
            </Button>
          </>
        }
      >
        <div className="space-y-4 text-sm">
          <p>
            You are about to deploy <strong>{assessmentTitle}</strong> to students.
          </p>
          <div className="rounded-lg bg-surface-hover p-4 space-y-2">
            <div className="flex justify-between">
              <span className="text-muted">Launch</span>
              <span>{LAUNCH_OPTIONS.find((o) => o.value === launchMode)?.label ?? launchMode}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Opens</span>
              <span>
                {launchMode === 'now'
                  ? 'Now'
                  : launchMode === 'manual'
                    ? 'When you open from Deployments'
                    : opensAt
                      ? new Date(opensAt).toLocaleString()
                      : '—'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Closes</span>
              <span>
                {launchMode === 'manual'
                  ? 'When you close from Deployments'
                  : closesAt
                    ? new Date(closesAt).toLocaleString()
                    : '—'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Duration</span>
              <span>{durationMinutes} minutes</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Attempts</span>
              <span>{attemptLimit}</span>
            </div>
          </div>
          <p className="text-muted">
            {launchMode === 'manual'
              ? 'Students will not see this until you open it from Deployments.'
              : 'Students will be able to start the assessment once it opens.'}
          </p>
        </div>
      </Modal>
    </div>
  );
}
