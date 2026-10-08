// ============================================================================
// Bootstrap route policy
// ============================================================================
//
// Authorization policy for `/api/admin/bootstrap`, extracted from the route so
// it can be unit-tested. It is deliberately dependency-free (no imports at
// all): `tests/bootstrap-auth.test.mjs` imports it directly through Node's
// type stripping, while the route itself imports Next and the Supabase
// clients, which only resolve inside the Next bundler.
//
// SECURITY INVARIANT
// ------------------
// Exactly the actions in `PUBLIC_ACTIONS` may be answered without a session.
// `BOOTSTRAP_WINDOW_ACTIONS` may also be answered without a session, but only
// while no super_admin exists yet (first-run self-host). Every other action
// must fall through to `requireSuperAdmin()`. The route is written so the only
// `action === ...` comparisons above the auth gate are these two lists, and
// `tests/bootstrap-auth.test.mjs` fails if that stops being true.

/** Answered without a session, at any time. Must leak nothing sensitive. */
export const PUBLIC_ACTIONS = ['check_env'] as const;

/** Answered without a session, but only while the bootstrap window is open. */
export const BOOTSTRAP_WINDOW_ACTIONS = ['create_admin'] as const;

/** Require an authenticated, active super_admin. */
export const AUTHENTICATED_ACTIONS = ['promote_to_admin', 'diagnose'] as const;

export type PublicBootstrapAction = (typeof PUBLIC_ACTIONS)[number];
export type BootstrapWindowAction = (typeof BOOTSTRAP_WINDOW_ACTIONS)[number];
export type AuthenticatedBootstrapAction = (typeof AUTHENTICATED_ACTIONS)[number];

export type BootstrapAction =
  | PublicBootstrapAction
  | BootstrapWindowAction
  | AuthenticatedBootstrapAction;

/** Every action the route knows about. Anything else is a 400. */
export const KNOWN_ACTIONS: readonly BootstrapAction[] = [
  ...PUBLIC_ACTIONS,
  ...BOOTSTRAP_WINDOW_ACTIONS,
  ...AUTHENTICATED_ACTIONS,
];

/** Actions the route may handle above the `requireSuperAdmin()` gate. */
export const PRE_AUTH_ACTIONS: readonly string[] = [
  ...PUBLIC_ACTIONS,
  ...BOOTSTRAP_WINDOW_ACTIONS,
];

export function isPublicAction(action: unknown): action is PublicBootstrapAction {
  return (
    typeof action === 'string' && (PUBLIC_ACTIONS as readonly string[]).includes(action)
  );
}

export function isBootstrapWindowAction(
  action: unknown
): action is BootstrapWindowAction {
  return (
    typeof action === 'string' &&
    (BOOTSTRAP_WINDOW_ACTIONS as readonly string[]).includes(action)
  );
}

export function isKnownAction(action: unknown): action is BootstrapAction {
  return typeof action === 'string' && KNOWN_ACTIONS.includes(action as BootstrapAction);
}

// ============================================================================
// Input parsing
// ============================================================================

export interface CreateAdminInput {
  email: string;
  password: string;
  fullName: string;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Validate `create_admin` payloads. Credentials are supplied by the caller and
 * never defaulted: a hard-coded fallback account in this file would be a
 * service-role credential in source control.
 */
export function parseCreateAdminInput(body: unknown): ParseResult<CreateAdminInput> {
  const { email, password, fullName } = (body ?? {}) as Record<string, unknown>;

  if (typeof email !== 'string' || typeof password !== 'string' || typeof fullName !== 'string') {
    return { ok: false, error: 'email, password and fullName are required' };
  }
  if (!email.includes('@')) {
    return { ok: false, error: 'A valid email address is required' };
  }
  if (password.length < 8) {
    return { ok: false, error: 'Password must be at least 8 characters' };
  }

  return { ok: true, value: { email, password, fullName } };
}

/** Validate the `userId` payload used by `promote_to_admin` and `diagnose`. */
export function parseUserId(body: unknown): ParseResult<string> {
  const { userId } = (body ?? {}) as Record<string, unknown>;
  if (typeof userId !== 'string' || !userId) {
    return { ok: false, error: 'userId is required' };
  }
  return { ok: true, value: userId };
}

/**
 * Health report for the required Supabase env vars.
 *
 * Booleans only, and only for variables the setup wizard itself needs: the
 * setup page calls this before any session exists, so it stays reachable
 * pre-admin. It used to also report which AI provider keys were configured,
 * which told an anonymous caller something about the deployment for no
 * benefit to the wizard.
 */
export function checkRequiredEnv(
  env: Record<string, string | undefined> = process.env
): { success: boolean; missing: string[] } {
  const required = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  ];
  const missing = required.filter((name) => !env[name]);
  return { success: missing.length === 0, missing };
}
