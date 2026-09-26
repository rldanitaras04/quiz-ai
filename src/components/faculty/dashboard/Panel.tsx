import type { JSX, ReactNode } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';

export function Panel({
  title,
  action,
  children,
  className = '',
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <Card className={className}>
      <CardHeader className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-[var(--color-foreground)]">{title}</h2>
        {action}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function PanelNote({ children }: { children: ReactNode }): JSX.Element {
  return <p className="py-12 text-center text-sm text-[var(--color-muted)]">{children}</p>;
}

export function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? '' : 's'} ago`;
}
