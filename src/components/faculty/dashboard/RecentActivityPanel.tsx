import type { JSX } from 'react';
import { CheckCircle, ClipboardText, Exam, FileText, Pulse, Robot, type Icon } from '@/components/ui/icons';
import { Panel, PanelNote, relativeTime } from './Panel';
import type { FacultyActivityItem } from '@/app/(dashboard)/faculty/actions';

interface ActionMeta {
  icon: Icon;
  tile: string;
}

const ACTION_META: Record<string, ActionMeta> = {
  'Exam submitted': { icon: Exam, tile: 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400' },
  'Assessment published': { icon: ClipboardText, tile: 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400' },
  'Source material uploaded': { icon: FileText, tile: 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400' },
  'AI generation completed': { icon: Robot, tile: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400' },
  'AI generation failed': { icon: Robot, tile: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400' },
  'Results released': { icon: CheckCircle, tile: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400' },
};

const DEFAULT_META: ActionMeta = {
  icon: Pulse,
  tile: 'bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300',
};

/**
 * Constitution §13 priority 5: what happened recently across the caller's
 * subjects, merged from domain tables (attempts, publications, uploads, AI
 * jobs, released results) — newest first.
 */
export default function RecentActivityPanel({
  items,
  className = '',
}: {
  items: FacultyActivityItem[] | null;
  className?: string;
}): JSX.Element {
  return (
    <Panel title="Recent Activity" className={className}>
      {!items ? (
        <PanelNote>Activity data is unavailable right now.</PanelNote>
      ) : items.length === 0 ? (
        <PanelNote>No activity recorded yet.</PanelNote>
      ) : (
        <ul className="divide-y divide-[var(--color-border)]">
          {items.map((item) => {
            const meta = ACTION_META[item.action] ?? DEFAULT_META;
            const ItemIcon = meta.icon;
            return (
              <li key={item.id} className="flex items-center gap-3 py-3">
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${meta.tile}`}
                  aria-hidden="true"
                >
                  <ItemIcon className="h-5 w-5" weight="regular" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-[var(--color-foreground)]">
                    {item.action}
                  </p>
                  <p className="truncate text-xs text-[var(--color-muted)]">
                    {item.detail ?? 'Across your subjects'}
                  </p>
                </div>
                <span className="w-24 shrink-0 text-right text-xs text-[var(--color-muted)]">
                  {relativeTime(item.createdAt)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
