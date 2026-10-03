'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import Select from '@/components/ui/Select';
import Spinner from '@/components/ui/Spinner';
import EmptyState from '@/components/ui/EmptyState';
import {
  listDeploymentTargets,
  type DeploymentTarget,
} from '@/app/(dashboard)/faculty/proctoring/actions';
import ProctorManager from '@/app/(dashboard)/faculty/subjects/[offeringId]/assessments/[assessmentId]/monitor/ProctorManager';

/**
 * Admin/faculty management card on `/faculty/proctoring` (scope §42):
 * pick one of the sittings the caller may administer (RLS-scoped for
 * faculty, every recent sitting for administrators) and reuse the monitor's
 * ProctorManager to assign or remove proctors on it.
 */
export default function ProctoringManageClient() {
  const [targets, setTargets] = useState<DeploymentTarget[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Initial load — same inline-async + cancellation pattern as QualityReportCard.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await listDeploymentTargets();
      if (cancelled) return;
      if (res.error) {
        setError(res.error);
      } else {
        setTargets(res.targets ?? []);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = targets.find((t) => t.deploymentId === selectedId) ?? null;

  return (
    <Card>
      <CardHeader className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Manage proctor assignments</h2>
        <p className="text-xs text-[var(--color-muted)]">
          Assign an active faculty member or administrator as a proctor for one
          sitting. They are notified with a direct link to the live monitor.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex justify-center py-6">
            <Spinner size="lg" />
          </div>
        ) : error ? (
          <p className="text-sm text-[var(--color-danger)]">{error}</p>
        ) : targets.length === 0 ? (
          <EmptyState
            title="No exams available"
            description="Create and deploy an assessment first — proctors are assigned per deployment."
          />
        ) : (
          <>
            <Select
              label="Exam sitting"
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="sm:max-w-xl"
            >
              <option value="">Select an exam sitting…</option>
              {targets.map((t) => (
                <option key={t.deploymentId} value={t.deploymentId}>
                  {t.subjectLabel}
                  {t.sectionName ? ` · ${t.sectionName}` : ''} — {t.assessmentTitle} ({t.status}
                  {t.opensAt ? `, opens ${new Date(t.opensAt).toLocaleString()}` : ''})
                </option>
              ))}
            </Select>

            {selected && (
              <ProctorManager
                offeringId={selected.offeringId}
                deploymentId={selected.deploymentId}
              />
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
