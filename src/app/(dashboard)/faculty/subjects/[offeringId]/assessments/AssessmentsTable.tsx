'use client';

import { useMemo, useState, type JSX } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table';
import { confirmAction, notifyError, notifySuccess } from '@/components/ui/alerts';
import { ASSESSMENT_STATUS_LABELS } from '@/lib/constants';
import { deleteAssessments } from '@/app/(dashboard)/faculty/subjects/[offeringId]/assessments/actions';
import DeleteAssessmentButton from '@/app/(dashboard)/faculty/subjects/[offeringId]/assessments/[assessmentId]/DeleteAssessmentButton';

export interface AssessmentListRow {
  id: string;
  title: string;
  assessment_type: string;
  status: string;
  created_at: string;
  total_items: number | null;
  total_points: number | null;
  section_label?: string;
  review_href: string;
  deploy_href?: string;
  show_deploy?: boolean;
  /** After a single-row delete from the subject list, return here. */
  single_redirect_to?: string;
}

interface Props {
  rows: AssessmentListRow[];
  /** Extra toolbar content (e.g. New Assessment). */
  toolbar?: JSX.Element;
}

function statusVariant(status: string): 'success' | 'warning' | 'info' | 'default' {
  switch (status) {
    case 'published': return 'success';
    case 'approved': return 'info';
    case 'draft': return 'warning';
    default: return 'default';
  }
}

export default function AssessmentsTable({ rows, toolbar }: Props): JSX.Element {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const allIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const someSelected = selected.size > 0 && !allSelected;
  const selectedCount = selected.size;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(allIds));
  };

  const selectedRows = rows.filter((r) => selected.has(r.id));
  const selectedTitles = selectedRows.map((r) => r.title);
  const previewTitles =
    selectedTitles.slice(0, 3).join(', ') +
    (selectedTitles.length > 3 ? `… and ${selectedTitles.length - 3} more` : '');

  const runBulkDelete = async (ids: string[], confirmTitle: string, confirmText: string) => {
    if (ids.length === 0) return;
    const ok = await confirmAction({
      title: confirmTitle,
      text: confirmText,
      confirmText: ids.length === allIds.length && allIds.length > 0 ? 'Delete all' : 'Delete selected',
      destructive: true,
    });
    if (!ok) return;

    setBusy(true);
    try {
      const result = await deleteAssessments(ids);
      const removed = new Set(result.deleted);

      if (result.failed.length > 0) {
        const detail = result.failed
          .map((f) => `“${f.title}”: ${f.error}`)
          .join('; ');
        notifyError(
          `Deleted ${result.deleted.length}, failed ${result.failed.length}`,
          detail
        );
        // Keep only rows that still exist (and failed) selected for a retry.
        const failedIds = new Set(result.failed.map((f) => f.id));
        setSelected(
          new Set(rows.map((r) => r.id).filter((id) => failedIds.has(id) && !removed.has(id)))
        );
      } else {
        notifySuccess(
          `Deleted ${result.deleted.length} assessment${result.deleted.length === 1 ? '' : 's'}`,
          undefined
        );
        setSelected(new Set());
      }

      router.refresh();
    } catch (e) {
      notifyError('Delete failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteSelected = () =>
    void runBulkDelete(
      [...selected],
      `Delete ${selectedCount} selected assessment${selectedCount === 1 ? '' : 's'}?`,
      `Selected: ${previewTitles}. Questions, deployments, and schedules are removed. This cannot be undone.`
    );

  const handleDeleteAll = () =>
    void runBulkDelete(
      allIds,
      `Delete all ${allIds.length} assessments?`,
      `Every assessment on this list will be permanently deleted (${previewTitles}). Questions, deployments, and schedules are removed. This cannot be undone.`
    );

  if (rows.length === 0) return <></>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleDeleteSelected}
            disabled={selectedCount === 0 || busy}
            loading={busy}
          >
            Delete selected ({selectedCount})
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={handleDeleteAll}
            disabled={busy}
            loading={busy}
          >
            Delete all ({allIds.length})
          </Button>
          {selectedCount > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())} disabled={busy}>
              Clear selection
            </Button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-[var(--color-muted)]">
            {selectedCount} of {allIds.length} selected
          </span>
          {toolbar}
        </div>
      </div>

      <Table caption="Assessments">
        <THead>
          <TR>
            <TH>
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someSelected;
                }}
                onChange={toggleAll}
                aria-label="Select all assessments"
                className="h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-primary)]"
              />
            </TH>
            <TH>Assessment</TH>
            <TH>Type</TH>
            <TH align="right">Items</TH>
            <TH align="right">Points</TH>
            {rows[0]?.section_label !== undefined && <TH>Section</TH>}
            <TH>Created</TH>
            <TH>Status</TH>
            <TH align="right">Actions</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((a) => {
            const isSelected = selected.has(a.id);
            return (
              <TR
                key={a.id}
                className={`hover:bg-[var(--color-surface-hover)] ${isSelected ? 'bg-[var(--color-primary)]/5' : ''}`}
              >
                <TD>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggle(a.id)}
                    aria-label={`Select ${a.title}`}
                    className="h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-primary)]"
                  />
                </TD>
                <TD className="font-medium">
                  <Link
                    href={a.review_href}
                    className="text-[var(--color-foreground)] hover:text-[var(--color-primary)] hover:underline"
                  >
                    {a.title}
                  </Link>
                </TD>
                <TD className="text-[var(--color-muted)]">
                  {a.assessment_type === 'multiple_choice' ? 'MCQ' : a.assessment_type === 'true_false' ? 'TF' : 'ID'}
                </TD>
                <TD numeric className="text-[var(--color-foreground)]">
                  {a.total_items ?? '—'}
                </TD>
                <TD numeric className="text-[var(--color-foreground)]">
                  {a.total_points ?? '—'}
                </TD>
                {a.section_label !== undefined && (
                  <TD>
                    <Badge variant="info">{a.section_label}</Badge>
                  </TD>
                )}
                <TD className="text-xs text-[var(--color-muted)]">
                  {new Date(a.created_at).toLocaleDateString()}
                </TD>
                <TD>
                  <Badge variant={statusVariant(a.status)}>
                    {ASSESSMENT_STATUS_LABELS[a.status as keyof typeof ASSESSMENT_STATUS_LABELS] ?? a.status}
                  </Badge>
                </TD>
                <TD className="whitespace-nowrap text-right">
                  <Link
                    href={a.review_href}
                    className="text-sm font-medium text-[var(--color-primary)] hover:underline"
                  >
                    Review
                  </Link>
                  {a.show_deploy !== false && a.deploy_href && (
                    <>
                      <span className="mx-2 text-[var(--color-border)]">|</span>
                      <Link
                        href={a.deploy_href}
                        className="text-sm font-medium text-[var(--color-primary)] hover:underline"
                      >
                        Deploy
                      </Link>
                    </>
                  )}
                  <span className="mx-2 text-[var(--color-border)]">|</span>
                  <DeleteAssessmentButton
                    assessmentId={a.id}
                    title={a.title}
                    redirectTo={a.single_redirect_to}
                  />
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    </div>
  );
}
