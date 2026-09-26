'use client';

import { useState, type JSX } from 'react';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table';
import Pagination from '@/components/ui/Pagination';
import Badge from '@/components/ui/Badge';
import RemoveStudentButton from './RemoveStudentButton';
import ReenrollStudentButton from './ReenrollStudentButton';

const PAGE_SIZE = 25;

const statusBadge: Record<string, { label: string; variant: 'success' | 'warning' | 'danger' | 'info' | 'default' }> = {
  enrolled: { label: 'Enrolled', variant: 'success' },
  withdrawn: { label: 'Withdrawn', variant: 'warning' },
  dropped: { label: 'Dropped', variant: 'danger' },
  completed: { label: 'Completed', variant: 'info' },
};

export interface RosterRow {
  /** Enrollment id (row key). */
  id: string;
  /** Student profile id, used by the remove action. */
  studentId: string;
  studentNumber: string;
  name: string;
  email: string | null;
  /** Enrollment status — anything other than `enrolled` offers Re-enroll. */
  status: string;
  enrolledAt: string;
}

/**
 * Enrolled-student roster: table on desktop, labelled cards below `lg`,
 * paginated 25 at a time (rosters can outgrow one screen).
 */
export default function EnrollmentTable({
  offeringId,
  rows,
}: {
  offeringId: string;
  rows: RosterRow[];
}): JSX.Element {
  const [page, setPage] = useState(1);

  // Clamp so removing the last row of the final page never shows a blank page.
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const paged = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <>
      <Table cards caption="Enrollment roster">
        <THead>
          <TR>
            <TH>Student Number</TH>
            <TH>Name</TH>
            <TH>Email</TH>
            <TH>Enrolled</TH>
            <TH>Status</TH>
            <TH align="right">Actions</TH>
          </TR>
        </THead>
        <TBody>
          {paged.map((row) => {
            const badge = statusBadge[row.status] ?? { label: row.status, variant: 'default' as const };
            const active = row.status === 'enrolled';
            return (
              <TR key={row.id}>
                <TD label="Student Number" className="font-mono text-[var(--color-foreground)]">
                  {row.studentNumber}
                </TD>
                <TD primary label="Name" className="text-[var(--color-foreground)]">
                  {row.name}
                </TD>
                <TD label="Email" className="text-[var(--color-muted)]">
                  {row.email ?? '—'}
                </TD>
                <TD label="Enrolled" className="text-[var(--color-muted)]">
                  {new Date(row.enrolledAt).toLocaleDateString()}
                </TD>
                <TD label="Status">
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                </TD>
                <TD label="Actions">
                  <div className="flex justify-end">
                    {active ? (
                      <RemoveStudentButton
                        offeringId={offeringId}
                        studentId={row.studentId}
                        studentName={row.name}
                      />
                    ) : (
                      <ReenrollStudentButton
                        offeringId={offeringId}
                        studentId={row.studentId}
                        studentName={row.name}
                      />
                    )}
                  </div>
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
      <Pagination page={safePage} pageSize={PAGE_SIZE} total={rows.length} onPageChange={setPage} />
    </>
  );
}
