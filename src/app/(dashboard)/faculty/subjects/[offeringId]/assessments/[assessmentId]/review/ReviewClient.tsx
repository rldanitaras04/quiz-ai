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
  type IdentificationReviewItem,
} from './actions';

interface ReviewClientProps {
  assessmentId: string;
}

export default function ReviewClient({ assessmentId }: ReviewClientProps) {
  const [items, setItems] = useState<IdentificationReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [scoringModal, setScoringModal] = useState<IdentificationReviewItem | null>(null);
  const [scoreInput, setScoreInput] = useState('');
  const [scoring, setScoring] = useState(false);

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
                    Status: {item.scoring_status}
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
          </div>
        )}
      </Modal>
    </Card>
  );
}
