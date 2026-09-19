import type { JSX, ReactNode } from 'react';
import { requireRole } from '@/lib/auth';
import AccountBlocked from '@/components/layout/AccountBlocked';

/**
 * Faculty workspace. Super administrators may inspect it; students are
 * redirected to their own dashboard.
 */
export default async function FacultyLayout({
  children,
}: {
  children: ReactNode;
}): Promise<JSX.Element> {
  const gate = await requireRole(['faculty', 'super_admin']);

  if (gate.status === 'blocked') return <AccountBlocked reason={gate.reason} />;

  return <>{children}</>;
}
