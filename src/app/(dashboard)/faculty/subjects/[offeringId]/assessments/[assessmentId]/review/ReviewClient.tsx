'use client';

import { useState, useEffect, useCallback } from 'react';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import Spinner from '@/components/ui/Spinner';
import Modal from '@/components/ui/Modal';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { notifySuccess, notifyError } from '@/components/ui/alerts';
import {
  getIdentificationResponsesNeedingReview,
  scoreIdentificationResponse,
  getScoreRecommendation,
  type IdentificationReviewItem,
  type ScoreRecommendationOutcome,
} from './actions';

interface ReviewClientProps {
  assessmentId: string;
}

/** Human labels for the scoring vocabulary (scope §26 tiers). */
const STATUS_LABELS: Record<string, string> = {
  pending: 'not yet scored',
  auto_scored: 'auto-scored',
  manual_review: 'held for review',
  scored: 'scored by faculty',
};

/**
 * Render the machine's verdict evidence (scoring_metadata { method,
 * similarity, candidate }) so faculty can see *why* a response was held or
 * auto-scored before overriding it.
 */
function describeAutoVerdict(meta: Record<string, unknown> | null): string | null {
  if (!meta || typeof meta.method !== 'string') return null;
  const candidate = typeof meta.candidate === 'string' ? ` “${meta.candidate}”` : '';
  const similarity =
    typeof meta.similarity === 'number' ? `${Math.round(meta.similarity * 100)}% similar` : null;

  switch (meta.method) {
    case 'exact':
      return 'exact match to the key';
    case 'alias':
      return `matches an approved answer${candidate}`;
    case 'fuzzy':
      return `close match${similarity ? ` (${similarity})` : ''} to${candidate}`;
    case 'choice':
      return 'selected choice compared to the key';
    case 'none':
      return 'no usable comparison — your judgment decides';
    default:
      return null;
  }
}

export default function ReviewClient({ assessmentId }: ReviewClientProps) {
  const [items, setItems] = useState<IdentificationReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [scoringModal, setScoringModal] = useState<IdentificationReviewItem | null>(null);
  const [scoreInput, setScoreInput] = useState('');
  const [scoring, setScoring] = useState(false);
  const [recommendation, setRecommendation] = useState<ScoreRecommendationOutcome | null>(null);
  const [recommending, setRecommending] = useState(false);

  const loadItems = useCallback(async () => {
    setLoading(true);
    const result = await getIdentificationResponsesNeedingReview(assessmentId);
    if (result.error) {
      notifyError(result.error);
    } else {
      setItems(result.data ?? []);
    }
    setLoading(false);
  }, [assessmentId]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const openScoringModal = (item: IdentificationReviewItem) => {
    setScoringModal(item);
    setScoreInput(String(item.earned_points ?? 0));
    setRecommendation(null);
  };

  // Scope §26: the AI recommends, the faculty confirms. The call only reads +
  // records an advisory note (scoring_metadata.ai); the score itself is still
  // saved exclusively through handleScore below.
  const handleRecommend = async () => {
    if (!scoringModal || recommending) return;

    setRecommending(true);
    setRecommendation(null);
    const result = await getScoreRecommendation(scoringModal.response_id);
    setRecommending(false);

    if (!result.success || !result.recommendation) {
      notifyError(result.error ?? 'Could not get an AI recommendation');
      return;
    }
    setRecommendation(result.recommendation);
    if (result.recommendation.suggestedPoints !== null) {
      setScoreInput(String(result.recommendation.suggestedPoints));
    }
  };

  const handleScore = async () => {
    if (!scoringModal) return;

    setScoring(true);
    const points = parseInt(scoreInput, 10);
    const result = await scoreIdentificationResponse(scoringModal.response_id, points);
    setScoring(false);

    if (result.error) {
      notifyError(result.error);
    } else {
      notifySuccess('Score updated');
      setScoringModal(null);
      loadItems();
    }
  };

  return (
    <Card>
      <CardHeader>
        <h3 className="text-lg font-semibold text-foreground">Identification Question Review</h3>
        <p className="text-sm text-muted">Review and manually score identification responses</p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : items.length === 0 ? (
          <EmptyState
            title="No responses to review"
            description="All identification responses have been scored or there are no identification questions."
          />
        ) : (
          <div className="space-y-4">
            {items.map((item) => (
              <div
                key={item.response_id}
                className="p-4 rounded-[var(--radius-md)] border border-[var(--color-border)]"
              >
                <div className="flex items-start justify-between gap-4 mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-foreground">{item.student_name}</span>
                      <span className="text-xs text-muted">{item.student_email}</span>
                    </div>
                    <p className="text-sm text-muted line-clamp-2">{item.question_text}</p>
                  </div>
                  <Badge variant={item.earned_points === 0 ? 'danger' : 'success'}>
                    {item.earned_points ?? 0}/{item.max_points}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm mb-3">
                  <div>
                    <span className="text-muted">Student answer:</span>
                    <p className="font-medium text-foreground">{item.text_answer}</p>
                  </div>
                  <div>
                    <span className="text-muted">Expected answer:</span>
                    <p className="font-medium text-foreground">{item.canonical_answer}</p>
                  </div>
                </div>

                {item.accepted_answers.length > 0 && (
                  <div className="text-sm mb-3">
                    <span className="text-muted">Also accepted:</span>
                    <p className="text-foreground">{item.accepted_answers.join(', ')}</p>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <Button variant="primary" size="sm" onClick={() => openScoringModal(item)}>
                    Score This Response
                  </Button>
                  <span className="text-xs text-muted">
                    Status: {STATUS_LABELS[item.scoring_status] ?? item.scoring_status}
                    {describeAutoVerdict(item.scoring_metadata)
                      ? ` — ${describeAutoVerdict(item.scoring_metadata)}`
                      : ''}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Modal
        open={!!scoringModal}
        onClose={() => setScoringModal(null)}
        title="Score Identification Response"
        actions={
          <>
            <Button variant="secondary" onClick={() => setScoringModal(null)} disabled={scoring}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleScore} loading={scoring}>
              Save Score
            </Button>
          </>
        }
      >
        {scoringModal && (
          <div className="space-y-4">
            <div className="p-3 rounded-[var(--radius-md)] bg-[var(--color-surface-hover)]">
              <p className="text-xs text-muted mb-1">Question</p>
              <p className="text-sm text-foreground">{scoringModal.question_text}</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-[var(--color-md)] border border-[var(--color-border)]">
                <p className="text-xs text-muted mb-1">Student answer</p>
                <p className="text-sm font-medium text-foreground">{scoringModal.text_answer}</p>
              </div>
              <div className="p-3 rounded-[var(--radius-md)] border border-[var(--color-border)]">
                <p className="text-xs text-muted mb-1">Expected answer</p>
                <p className="text-sm font-medium text-foreground">{scoringModal.canonical_answer}</p>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Points (0 to {scoringModal.max_points})
              </label>
              <input
                type="number"
                min={0}
                max={scoringModal.max_points}
                value={scoreInput}
                onChange={(e) => setScoreInput(e.target.value)}
                className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-foreground)]"
              />
            </div>

            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted">
                Optional: let the AI judge this answer (scope §26) — advisory only, you still
                confirm the score.
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleRecommend}
                loading={recommending}
              >
                Ask AI
              </Button>
            </div>

            {recommendation && (
              <div
                className="p-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-hover)]"
                role="status"
                aria-label="AI recommendation"
              >
                <div className="flex items-center gap-2 mb-1">
                  <Badge
                    variant={
                      recommendation.verdict === 'correct'
                        ? 'success'
                        : recommendation.verdict === 'incorrect'
                          ? 'danger'
                          : 'warning'
                    }
                  >
                    AI: {recommendation.verdict}
                  </Badge>
                  <span className="text-xs text-muted">
                    {Math.round(recommendation.confidence * 100)}% confidence
                    {recommendation.suggestedPoints !== null
                      ? ` — suggested ${recommendation.suggestedPoints} point(s) loaded below`
                      : ''}
                  </span>
                </div>
                <p className="text-sm text-foreground">
                  {recommendation.rationale || 'No rationale provided.'}
                </p>
                <p className="text-[11px] text-muted mt-1">
                  Advisory only — nothing is saved until you press Save Score.
                </p>
              </div>
            )}
          </div>
        )}
      </Modal>
    </Card>
  );
}
