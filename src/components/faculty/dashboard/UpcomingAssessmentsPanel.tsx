import type { JSX } from 'react';
import Link from 'next/link';
import Badge from '@/components/ui/Badge';
import { Panel, PanelNote } from './Panel';
import type { FacultyUpcomingItem } from '@/app/(dashboard)/faculty/actions';

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/**
 * Constitution §13 priority 2: subject / section / date / time / status for
 * the next deployments that are still open. Rows link to their assessment.
 */
export default function UpcomingAssessmentsPanel({
  items,
  className = '',
}: {
  items: FacultyUpcomingItem[] | null;
  className?: string;
}): JSX.Element {
  return (
    <Panel title="Upcoming Assessments" className={className}>
      {!items ? (
        <PanelNote>Upcoming assessments are unavailable right now.</PanelNote>
      ) : items.length === 0 ? (
        <PanelNote>No upcoming assessments scheduled.</PanelNote>
      ) : (
        <ul className="divide-y divide-[var(--color-border)]">
          {items.map((item) => {
            const opened = new Date(item.opensAt);
            return (
              <li key={item.id}>
                <Link
                  href={`/faculty/subjects/${item.offeringId}/assessments/${item.assessmentId}`}
                  className="group flex items-center gap-3 py-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
                >
                  <span
                    className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-hover)]"
                    aria-hidden="true"
                  >
                    <span className="text-[10px] font-semibold uppercase leading-none text-[var(--color-muted)]">
                      {MONTH_SHORT[opened.getMonth()]}
                    </span>
                    <span className="mt-0.5 text-sm font-bold leading-none text-[var(--color-foreground)]">
                      {opened.getDate()}
                    </span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-[var(--color-foreground)] transition-colors group-hover:text-[var(--color-primary)]">
                      {item.title}
                    </p>
                    <p className="truncate text-xs text-[var(--color-muted)]">
                      {item.subjectLabel} · {formatDate(item.opensAt)}, {formatTime(item.opensAt)}
                    </p>
                  </div>
                  <Badge variant={item.status === 'active' ? 'success' : 'info'}>
                    {item.status === 'active' ? 'Ongoing' : 'Scheduled'}
                  </Badge>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
