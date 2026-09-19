import type { JSX, ReactNode } from 'react';
import { requireRole } from '@/lib/auth';
import AccountBlocked from '@/components/layout/AccountBlocked';

/**
 * Super-administrator section. Direct URL access by any other role is
 * redirected to that role's own dashboard (RLS remains the data-level control).
 */
export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}): Promise<JSX.Element> {
  const gate = await requireRole(['super_admin']);

  if (gate.status === 'blocked') return <AccountBlocked reason={gate.reason} />;

  return <>{children}</>;
}
