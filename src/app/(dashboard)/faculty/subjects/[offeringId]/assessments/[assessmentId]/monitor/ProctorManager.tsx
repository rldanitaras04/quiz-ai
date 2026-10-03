'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Select from '@/components/ui/Select';
import Input from '@/components/ui/Input';
import Spinner from '@/components/ui/Spinner';
import EmptyState from '@/components/ui/EmptyState';
import { confirmAction, notifyError, notifySuccess } from '@/components/ui/alerts';
import {
  assignProctor,
  listProctorCandidates,
  listProctors,
  removeProctor,
  type ProctorCandidate,
  type ProctorRowInfo,
} from '@/app/(dashboard)/faculty/proctoring/actions';

/**
 * "Proctors" management card on the Live Monitor (scope §42).
 *
 * Visible only to offering faculty and administrators (the page passes
 * `canManageProctors`). All writes go through service-role server actions
 * that re-check authorization; the browser only ever reads the two lists.
 * Assigning notifies the new proctor with a deep link to this monitor.
 */
export default function ProctorManager({
  offeringId,
  deploymentId,
}: {
  offeringId: string;
  deploymentId: string;
}) {
  const [proctors, setProctors] = useState<ProctorRowInfo[]>([]);
  const [candidates, setCandidates] = useState<ProctorCandidate[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const fetchLists = useCallback(
    async (isCancelled?: () => boolean) => {
      const [proctorRes, candidateRes] = await Promise.all([
        listProctors(deploymentId),
        listProctorCandidates({ offeringId }),
      ]);
      if (isCancelled?.()) return;
      setError(null);
      if (proctorRes.error) {
        setError(proctorRes.error);
      } else {
        setProctors(proctorRes.proctors ?? []);
      }
      if (candidateRes.error) {
        setError(candidateRes.error);
      } else {
        setCandidates(candidateRes.candidates ?? []);
      }
      setLoading(false);
    },
    [deploymentId, offeringId]
  );

  // Initial load + refetch when the selected deployment changes — same
  // inline-async + cancellation pattern as QualityReportCard.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await fetchLists(() => cancelled);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchLists]);

  const assignedIds = new Set(proctors.map((p) => p.proctor_id));
  const query = search.trim().toLowerCase();
  const available = candidates.filter(
    (c) =>
      !assignedIds.has(c.id) &&
      (query === '' ||
        c.full_name.toLowerCase().includes(query) ||
        c.email.toLowerCase().includes(query))
  );

  const handleAssign = async () => {
    if (!selectedId || busy) return;
    setBusy('assign');
    try {
      const result = await assignProctor({
        deploymentId,
        proctorUserId: selectedId,
      });
      if (!result.success) {
        notifyError('Could not assign proctor', result.error);
        if (result.already) await fetchLists();
        return;
      }
      notifySuccess(
        'Proctor assigned',
        'They were notified and can now open this live monitor.'
      );
      setSelectedId('');
      await fetchLists();
    } finally {
      setBusy(null);
    }
  };

  const handleRemove = async (proctor: ProctorRowInfo) => {
    if (busy) return;
    const ok = await confirmAction({
      title: 'Remove this proctor?',
      text: `${proctor.full_name} will immediately lose access to this exam's live monitor and controls. You can assign them again later.`,
      confirmText: 'Remove proctor',
      destructive: true,
    });
    if (!ok) return;
    setBusy(`remove-${proctor.proctor_id}`);
    try {
      const result = await removeProctor({
        deploymentId,
        proctorUserId: proctor.proctor_id,
      });
      if (!result.success) {
        notifyError('Could not remove proctor', result.error);
        return;
      }
      notifySuccess('Proctor removed', `${proctor.full_name} no longer supervises this exam.`);
      await fetchLists();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Proctors</h2>
        <p className="text-xs text-[var(--color-muted)]">
          Optional supervision (scope §42): assigned proctors can open this live
          monitor, run every intervention, and conclude attempts. Assignment is
          per deployment and can be revoked at any time.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex justify-center py-6">
            <Spinner size="lg" />
          </div>
        ) : (
          <>
            {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}

            {proctors.length === 0 ? (
              <EmptyState
                title="No proctor assigned"
                description="This exam runs with no proctor until you assign one below."
              />
            ) : (
              <ul className="space-y-2">
                {proctors.map((p) => (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--color-border)] px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{p.full_name}</div>
                      {p.email && (
                        <div className="truncate text-xs text-[var(--color-muted)]">{p.email}</div>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={busy !== null}
                      onClick={() => handleRemove(p)}
                    >
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <Input
                label="Add a proctor"
                placeholder="Search faculty or administrators by name or email"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="sm:flex-1"
              />
              <Select
                label="Candidate"
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
                className="sm:w-72"
                disabled={available.length === 0}
              >
                <option value="">
                  {available.length === 0 ? 'No candidates available' : 'Select a user…'}
                </option>
                {available.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.full_name}
                    {c.email ? ` (${c.email})` : ''} · {c.role === 'admin' ? 'admin' : 'faculty'}
                  </option>
                ))}
              </Select>
              <Button
                size="sm"
                disabled={!selectedId || busy !== null}
                onClick={handleAssign}
              >
                {busy === 'assign' ? 'Assigning…' : 'Assign'}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
