import type { JSX } from 'react';
import Link from 'next/link';
import { Bell, ChartBar, ClipboardText, Database, UploadSimple, Users, type Icon } from '@/components/ui/icons';
import { Panel } from './Panel';

interface QuickAction {
  label: string;
  href: string;
  icon: Icon;
  tile: string;
  /** Span both grid columns (used for the full-width trailing tile). */
  wide?: boolean;
}

// Design's AI Assistant tile is intentionally omitted — the feature does not
// exist anywhere in the app. Every tile points at a real route; creation is
// offering-scoped, so "Create Assessment" enters through My Subjects, and so
// do student scores (the gradebook lives per subject section).
const ACTIONS: QuickAction[] = [
  {
    label: 'Create Assessment',
    href: '/faculty/subjects',
    icon: ClipboardText,
    tile: 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400',
  },
  {
    label: 'Question Bank',
    href: '/faculty/subjects',
    icon: Database,
    tile: 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400',
  },
  {
    label: 'Upload Source',
    href: '/faculty/subjects',
    icon: UploadSimple,
    tile: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400',
  },
  {
    label: 'Enroll Students',
    href: '/faculty/subjects',
    icon: Users,
    tile: 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400',
  },
  {
    label: 'Notifications',
    href: '/notifications',
    icon: Bell,
    tile: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400',
  },
  {
    label: 'Student Scores',
    href: '/faculty/subjects',
    icon: ChartBar,
    tile: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-400',
  },
];

export default function QuickActionsPanel({ className = '' }: { className?: string }): JSX.Element {
  return (
    <Panel title="Quick Actions" className={className}>
      <div className="grid grid-cols-2 gap-3">
        {ACTIONS.map((action) => {
          const ActionIcon = action.icon;
          return (
            <Link
              key={action.label}
              href={action.href}
              className={`flex flex-col items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-5 text-center text-sm font-medium text-[var(--color-foreground)] transition-colors hover:border-[var(--color-primary)] hover:bg-[var(--color-primary-light)] hover:text-[var(--color-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] ${action.wide ? 'col-span-2 flex-row justify-center' : ''}`}
            >
              <span
                className={`flex h-9 w-9 items-center justify-center rounded-full ${action.tile}`}
                aria-hidden="true"
              >
                <ActionIcon className="h-5 w-5" weight="regular" />
              </span>
              {action.label}
            </Link>
          );
        })}
      </div>
    </Panel>
  );
}
