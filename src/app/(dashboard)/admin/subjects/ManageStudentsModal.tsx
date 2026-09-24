'use client';

import { useCallback, useEffect, useState, type JSX } from 'react';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Badge from '@/components/ui/Badge';
import Spinner from '@/components/ui/Spinner';
import { getOfferingRoster, type OfferingRosterRow } from './actions';
import AddStudentButton from '@/app/(dashboard)/faculty/subjects/[offeringId]/students/AddStudentButton';
import RemoveStudentButton from '@/app/(dashboard)/faculty/subjects/[offeringId]/students/RemoveStudentButton';
import ReenrollStudentButton from '@/app/(dashboard)/faculty/subjects/[offeringId]/students/ReenrollStudentButton';
import BulkEnrollPanel from '@/app/(dashboard)/faculty/subjects/[offeringId]/students/BulkEnrollPanel';

const statusBadge: Record<string, { label: string; variant: 'success' | 'warning' | 'danger' | 'info' | 'default' }> = {
  enrolled: { label: 'Enrolled', variant: 'success' },
  withdrawn: { label: 'Withdrawn', variant: 'warning' },
  dropped: { label: 'Dropped', variant: 'danger' },
  completed: { label: 'Completed', variant: 'info' },
};

interface ManageStudentsModalProps {
  offeringId: string;
  open: boolean;
  onClose: () => void;
}

/**
 * Admin option A: offering-level roster management from Subjects & Offerings.
 * Reuses the faculty enrollment server actions — `canManageEnrollment`
 * already accepts super_admin, and RLS grants `Admin can manage enrollments`.
 */
export default function ManageStudentsModal({
  offeringId,
  open,
  onClose,
}: ManageStudentsModalProps): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<OfferingRosterRow[]>([]);
  const [subjectLabel, setSubjectLabel] = useState('');
  const [sectionLabel, setSectionLabel] = useState('');

  const load = useCallback(async () => {
    const result = await getOfferingRoster(offeringId);
    setLoading(false);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    setError(null);
    setRows(result.rows);
    setSubjectLabel(result.subjectLabel);
    setSectionLabel(result.sectionLabel);
  }, [offeringId]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    (async () => {
      const result = await getOfferingRoster(offeringId);
      if (!active) return;
      setLoading(false);
      if ('error' in result) {
        setError(result.error);
        return;
      }
      setError(null);
      setRows(result.rows);
      setSubjectLabel(result.subjectLabel);
      setSectionLabel(result.sectionLabel);
    })();
    return () => {
      active = false;
    };
  }, [open, offeringId]);

  const activeCount = rows.filter((r) => r.status === 'enrolled').length;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Manage Students"
      actions={
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="space-y-5">
        <div className="text-sm text-[var(--color-muted)]">
          <span className="font-medium text-[var(--color-foreground)]">{subjectLabel}</span>
          {' · Section '}
          <span className="font-medium text-[var(--color-foreground)]">{sectionLabel}</span>
          {' · '}
          {activeCount} enrolled · {rows.length} total
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <AddStudentButton offeringId={offeringId} onChanged={() => void load()} />
        </div>

        <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-4">
          <h3 className="text-sm font-semibold text-[var(--color-foreground)] mb-1">
            Bulk enroll
          </h3>
          <p className="text-sm text-[var(--color-muted)] mb-3">
            Select students from section {sectionLabel || '—'}, or search by ID/name for irregular students.
          </p>
          <BulkEnrollPanel
            offeringId={offeringId}
            sectionName={sectionLabel}
            onChanged={() => void load()}
          />
        </section>

        {loading ? (
          <div className="flex justify-center py-8">
            <Spinner size="md" />
          </div>
        ) : error ? (
          <p className="text-sm text-[var(--color-danger)]" role="alert">{error}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">
            No students yet — search by ID or name, or bulk-select from the section roster.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {rows.map((row) => {
              const badge = statusBadge[row.status] ?? { label: row.status, variant: 'default' as const };
              return (
                <li key={row.enrollmentId} className="py-2 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-[var(--color-foreground)] truncate">
                      {row.fullName}
                    </p>
                    <p className="text-xs text-[var(--color-muted)] font-mono">
                      {row.studentNumber}
                      {row.email ? ` · ${row.email}` : ''}
                    </p>
                  </div>
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                  <div className="flex items-center gap-1">
                    {row.status === 'enrolled' ? (
                      <RemoveStudentButton
                        offeringId={offeringId}
                        studentId={row.studentId}
                        studentName={row.fullName}
                        onChanged={() => void load()}
                      />
                    ) : (
                      <ReenrollStudentButton
                        offeringId={offeringId}
                        studentId={row.studentId}
                        studentName={row.fullName}
                        onChanged={() => void load()}
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}
