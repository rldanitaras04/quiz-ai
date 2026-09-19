import type { JSX, ReactNode } from 'react';
import { requireRole } from '@/lib/auth';
import AccountBlocked from '@/components/layout/AccountBlocked';

/**
 * Student section. Faculty and administrators are redirected to their own
 * dashboards: student pages are scoped to the caller's own attempts and
 * results, so they would only ever render empty for other roles.
 */
export default async function StudentLayout({
  children,
}: {
  children: ReactNode;
}): Promise<JSX.Element> {
  const gate = await requireRole(['student']);

  if (gate.status === 'blocked') return <AccountBlocked reason={gate.reason} />;

  return <>{children}</>;
}
