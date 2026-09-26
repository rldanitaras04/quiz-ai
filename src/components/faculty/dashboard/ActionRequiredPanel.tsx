import type { JSX } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { WarningCircle } from '@/components/ui/icons';
import type { FacultyActionItem } from '@/app/(dashboard)/faculty/actions';

/**
 * Constitution §13 priority 1: things the faculty member must act on. Every
 * item links to a real route; when there is nothing to do the panel is not
 * rendered at all.
 */
export default function ActionRequiredPanel({
  items,
  className = '',
}: {
  items: FacultyActionItem[];
  className?: string;
}): JSX.Element | null {
  if (items.length === 0) return null;

  return (
    <Card className={className}>
      <CardHeader className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--color-foreground)]">
          <WarningCircle className="h-5 w-5 text-amber-500" weight="fill" aria-hidden="true" />
          Action Required
        </h2>
        <span className="text-xs font-medium text-[var(--color-muted)]">Needs your attention</span>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-[var(--color-border)]">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                href={item.href}
                className="group flex items-center gap-3 py-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-[var(--color-foreground)] transition-colors group-hover:text-[var(--color-primary)]">
                    {item.title}
                  </p>
                  <p className="truncate text-xs text-[var(--color-muted)]">{item.detail}</p>
                </div>
                <svg
                  className="h-4 w-4 shrink-0 text-[var(--color-muted)] transition-colors group-hover:text-[var(--color-primary)]"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                    clipRule="evenodd"
                  />
                </svg>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
