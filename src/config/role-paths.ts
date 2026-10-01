import type { UserRole } from '@/lib/types';

/**
 * Landing route for each role — the single source of truth, used when a user
 * reaches a section they do not own (`requireRole()` redirect), when a signed
 * in user hits `/`, and by anything else that needs a role's home path.
 *
 * Lives in its own dependency-free module (not `config/navigation.ts`) so
 * server-only code such as `lib/auth.ts` can import it: navigation.ts pulls in
 * `@phosphor-icons/react`, whose `createContext` calls are illegal in the
 * React Server Components graph.
 */
export function homePathForRole(role: UserRole): string {
  if (role === 'super_admin') return '/admin';
  if (role === 'faculty') return '/faculty';
  return '/student';
}
