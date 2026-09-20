'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';import PageHeader from '@/components/ui/PageHeader';
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
  const [questionOrderMode, setQuestionOrderMode] = useState<QuestionOrderMode>('fixed');
  const [choiceOrderMode, setChoiceOrderMode] = useState<ChoiceOrderMode>('fixed');
  const [scoreReleaseMode, setScoreReleaseMode] = useState<ScoreReleaseMode>('immediate');
  const [showRawScore, setShowRawScore] = useState(true);
  const [showPercentage, setShowPercentage] = useState(true);
  const [showItemCorrectness, setShowItemCorrectness] = useState(false);
  const [showCorrectAnswers, setShowCorrectAnswers] = useState(false);
  const [showExplanations, setShowExplanations] = useState(false);
  const [requiresIdentityVerification, setRequiresIdentityVerification] = useState(false);

  const selectedVersion = versions.find((v) => v.id === selectedVersionId);

  const handleDeploy = async () => {
    if (!selectedVersionId || !opensAt || !closesAt) {
      setError('Please fill in all required fields');
      return;
    }

    if (new Date(opensAt) >= new Date(closesAt)) {
      setError('Close time must be after open time');
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
      opens_at: new Date(opensAt).toISOString(),
      closes_at: new Date(closesAt).toISOString(),
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
      notifySuccess('Assessment deployed', 'Students can now take this assessment in the window you set.');
      router.push(`/faculty/subjects/${offeringId}/deployments`);
      router.refresh();
    } else {
      const message = result.error ?? 'Failed to create deployment';
      setError(message);
      notifyError('Could not deploy the assessment', message);
      setLoading(false);
    }
  };

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
              <h2 className="text-lg font-semibold">Schedule & Duration</h2>
            </CardHeader>
            <CardContent className="space-y-4">
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
                  Students will take this version. Only published or approved versions
                  should normally be deployed.
                </p>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Opens at"
                  type="datetime-local"
                  value={opensAt}
                  onChange={(e) => setOpensAt(e.target.value)}
                  required
                />
                <Input
                  label="Closes at"
                  type="datetime-local"
                  value={closesAt}
                  onChange={(e) => setClosesAt(e.target.value)}
                  required
                />
              </div>
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
              <span className="text-muted">Opens</span>
              <span>{opensAt ? new Date(opensAt).toLocaleString() : '-'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Closes</span>
              <span>{closesAt ? new Date(closesAt).toLocaleString() : '-'}</span>
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
          <p className="text-muted">Students will be able to start the assessment once it opens.</p>
        </div>
      </Modal>
    </div>
  );
}
