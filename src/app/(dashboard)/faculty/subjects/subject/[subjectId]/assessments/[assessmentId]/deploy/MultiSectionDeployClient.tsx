'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table';
import { notifySuccess, notifyError } from '@/components/ui/alerts';
import { createDeployment } from '@/app/(dashboard)/faculty/subjects/[offeringId]/assessments/[assessmentId]/deploy/actions';

interface Offering {
  id: string;
  sectionName: string;
  semesterName: string;
}

interface MultiSectionDeployClientProps {
  assessmentId: string;
  subjectId: string;
  offerings: Offering[];
  assessmentTitle: string;
  versionNumber: number;
  totalItems: number;
  totalPoints: number;
}

export default function MultiSectionDeployClient({
  assessmentId,
  subjectId,
  offerings,
  assessmentTitle,
  versionNumber,
  totalItems,
  totalPoints,
}: MultiSectionDeployClientProps) {
  const router = useRouter();
  const [selectedOfferings, setSelectedOfferings] = useState<Set<string>>(
    new Set(offerings.map(o => o.id))
  );
  const [deploying, setDeploying] = useState(false);
  const [results, setResults] = useState<{ offeringId: string; sectionName: string; success: boolean; error?: string }[]>([]);

  // Shared config for all deployments
  const [opensAt, setOpensAt] = useState(() => {
    const now = new Date();
    now.setHours(now.getHours() + 1);
    return now.toISOString().slice(0, 16);
  });
  const [closesAt, setClosesAt] = useState(() => {
    const now = new Date();
    now.setDate(now.getDate() + 7);
    return now.toISOString().slice(0, 16);
  });
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [attemptLimit, setAttemptLimit] = useState(1);

  const toggleOffering = (id: string) => {
    setSelectedOfferings(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedOfferings.size === offerings.length) {
      setSelectedOfferings(new Set());
    } else {
      setSelectedOfferings(new Set(offerings.map(o => o.id)));
    }
  };

  const handleDeploy = async () => {
    if (selectedOfferings.size === 0) {
      notifyError('No sections selected', 'Select at least one section to deploy to.');
      return;
    }

    setDeploying(true);
    setResults([]);

    const deployResults: { offeringId: string; sectionName: string; success: boolean; error?: string }[] = [];

    for (const offeringId of selectedOfferings) {
      const offering = offerings.find(o => o.id === offeringId);
      try {
        const result = await createDeployment(assessmentId, offeringId, {
          assessment_version_id: '', // Will be resolved server-side
          subject_offering_id: offeringId,
          opens_at: new Date(opensAt).toISOString(),
          closes_at: new Date(closesAt).toISOString(),
          duration_minutes: durationMinutes,
          attempt_limit: attemptLimit,
          question_order_mode: 'shuffled',
          choice_order_mode: 'shuffled',
          score_release_mode: 'immediate',
          show_raw_score: true,
          show_percentage: true,
          show_item_correctness: false,
          show_correct_answers: false,
          show_explanations: false,
          requires_identity_verification: false,
        });

        deployResults.push({
          offeringId,
          sectionName: offering?.sectionName ?? '—',
          success: result.success,
          error: result.error,
        });
      } catch (err) {
        deployResults.push({
          offeringId,
          sectionName: offering?.sectionName ?? '—',
          success: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    setResults(deployResults);
    setDeploying(false);

    const successCount = deployResults.filter(r => r.success).length;
    if (successCount === deployResults.length) {
      notifySuccess('Deployed successfully', `Assessment deployed to ${successCount} section${successCount !== 1 ? 's' : ''}.`);
    } else {
      notifyError('Partial deployment', `${successCount}/${deployResults.length} sections deployed.`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Assessment Info */}
      <Card>
        <CardHeader>
          <h3 className="text-base font-semibold text-foreground">Assessment Details</h3>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-muted">Title</p>
              <p className="font-medium text-foreground">{assessmentTitle}</p>
            </div>
            <div>
              <p className="text-muted">Version</p>
              <p className="font-medium text-foreground">v{versionNumber}</p>
            </div>
            <div>
              <p className="text-muted">Items</p>
              <p className="font-medium text-foreground">{totalItems}</p>
            </div>
            <div>
              <p className="text-muted">Points</p>
              <p className="font-medium text-foreground">{totalPoints}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Section Selection */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-foreground">Select Sections</h3>
            <Button variant="ghost" size="sm" onClick={toggleAll}>
              {selectedOfferings.size === offerings.length ? 'Deselect All' : 'Select All'}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <THead>
              <TR>
                <TH>
                  <input
                    type="checkbox"
                    checked={selectedOfferings.size === offerings.length}
                    onChange={toggleAll}
                    className="rounded"
                  />
                </TH>
                <TH>Section</TH>
                <TH>Term</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {offerings.map((offering) => (
                <TR key={offering.id}>
                  <TD>
                    <input
                      type="checkbox"
                      checked={selectedOfferings.has(offering.id)}
                      onChange={() => toggleOffering(offering.id)}
                      className="rounded"
                    />
                  </TD>
                  <TD className="font-medium text-foreground">{offering.sectionName}</TD>
                  <TD className="text-muted">{offering.semesterName}</TD>
                  <TD>
                    <Badge variant={selectedOfferings.has(offering.id) ? 'success' : 'default'}>
                      {selectedOfferings.has(offering.id) ? 'Selected' : 'Not selected'}
                    </Badge>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>

      {/* Deployment Config */}
      <Card>
        <CardHeader>
          <h3 className="text-base font-semibold text-foreground">Deployment Settings</h3>
          <p className="text-sm text-muted">Applied to all selected sections</p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Opens At</label>
              <input
                type="datetime-local"
                value={opensAt}
                onChange={(e) => setOpensAt(e.target.value)}
                className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-foreground)]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Closes At</label>
              <input
                type="datetime-local"
                value={closesAt}
                onChange={(e) => setClosesAt(e.target.value)}
                className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-foreground)]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Duration (minutes)</label>
              <input
                type="number"
                min={1}
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(parseInt(e.target.value, 10) || 60)}
                className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-foreground)]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Attempt Limit</label>
              <input
                type="number"
                min={1}
                value={attemptLimit}
                onChange={(e) => setAttemptLimit(parseInt(e.target.value, 10) || 1)}
                className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-foreground)]"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Deploy Button */}
      <div className="flex justify-end">
        <Button
          variant="primary"
          size="lg"
          onClick={handleDeploy}
          loading={deploying}
          disabled={selectedOfferings.size === 0}
        >
          Deploy to {selectedOfferings.size} Section{selectedOfferings.size !== 1 ? 's' : ''}
        </Button>
      </div>

      {/* Results */}
      {results.length > 0 && (
        <Card>
          <CardHeader>
            <h3 className="text-base font-semibold text-foreground">Deployment Results</h3>
          </CardHeader>
          <CardContent>
            <Table>
              <THead>
                <TR>
                  <TH>Section</TH>
                  <TH>Status</TH>
                  <TH>Error</TH>
                </TR>
              </THead>
              <TBody>
                {results.map((result) => (
                  <TR key={result.offeringId}>
                    <TD className="font-medium text-foreground">{result.sectionName}</TD>
                    <TD>
                      <Badge variant={result.success ? 'success' : 'danger'}>
                        {result.success ? 'Deployed' : 'Failed'}
                      </Badge>
                    </TD>
                    <TD className="text-sm text-muted">{result.error ?? '—'}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Back Link */}
      <div className="text-center">
        <Button
          variant="ghost"
          onClick={() => router.push(`/faculty/subjects/subject/${subjectId}/assessments/${assessmentId}`)}
        >
          Back to Assessment
        </Button>
      </div>
    </div>
  );
}
