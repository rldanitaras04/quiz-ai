/**
 * Classification + retry helpers for the two transient Supabase Auth API
 * failures that show up under real classroom load:
 *
 *  - `over_request_rate_limit` (HTTP 429): the project's Auth API rate limit
 *    was exceeded. Bursts of parallel requests (middleware auth on every
 *    request, heartbeats, autosaves, polls) all hit `/auth/v1/*`, and once the
 *    limit trips every refresh fails until the window clears. Retrying with
 *    backoff usually succeeds; the durable fix is reducing Auth API volume
 *    (the proxy now only authenticates page navigations), dampening refresh
 *    attempts while limited (see `lib/supabase/auth-fetch.ts`, which lets
 *    the bucket drain and probes it again after a cooldown), or raising the
 *    rate limits in the Supabase dashboard (Authentication → Rate limits).
 *
 *  - `refresh_token_already_used` (HTTP 400): refresh tokens rotate on every
 *    use, so two clients racing on the same token (a browser auto-refresh vs.
 *    an in-flight request that already carried it) surface this error once.
 *    The winner has already committed the rotated session — re-reading the
 *    session (storage/cookies) and retrying usually picks up the new token.
 *
 * Neither error means "the user signed out". Callers must not treat them as
 * an authentication failure: retry, or fail with a transient/unavailable
 * message instead of bouncing the user to /login.
 */

/** Auth API error codes that are safe to retry instead of treating as fatal. */
const TRANSIENT_AUTH_CODES: ReadonlySet<string> = new Set([
  'over_request_rate_limit',
  'refresh_token_already_used',
]);

interface AuthErrorLike {
  code?: unknown;
  status?: unknown;
}

/** True when the error is a transient Supabase Auth failure worth retrying. */
export function isTransientAuthError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as AuthErrorLike;
  if (typeof candidate.code === 'string' && TRANSIENT_AUTH_CODES.has(candidate.code)) {
    return true;
  }
  return candidate.status === 429;
}

/** True when the failure is specifically the Auth API rate limit (429). */
export function isRateLimitAuthError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as AuthErrorLike;
  return (
    candidate.status === 429 ||
    (typeof candidate.code === 'string' && candidate.code === 'over_request_rate_limit')
  );
}

/** True when the failure is a concurrent-refresh rotation race. */
export function isRefreshRaceError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as AuthErrorLike).code;
  return code === 'refresh_token_already_used';
}

export interface AuthRetryOptions {  /** Extra attempts after the first, on transient errors only. Default 2. */
  retries?: number;
  /** Backoff before the first retry; doubles each attempt. Default 800ms. */
  baseDelayMs?: number;
  /**
   * Whether to retry `refresh_token_already_used`. Worth retrying on the
   * client (cookies/storage may already hold the rotated token from a
   * concurrent refresh) but pointless inside a single server request — the
   * request's cookies are frozen, so a retry replays the same dead token.
   * Defaults to true.
   */
  retryRefreshRace?: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run a supabase-js auth call, retrying transient failures with backoff.
 *
 * Non-transient errors are returned immediately; transient errors get up to
 * `retries` extra attempts (800ms, 1600ms, ... by default) before the last
 * result — success or error — is returned to the caller.
 *
 * Typed against the whole `{ data, error }` response rather than `data` alone
 * so supabase-js discriminated unions (e.g. `data.user: User | null`) infer
 * cleanly.
 */
export async function withAuthRetry<R extends { error: unknown }>(
  operation: () => Promise<R>,
  options: AuthRetryOptions = {}
): Promise<R> {
  const retries = options.retries ?? 2;
  const baseDelayMs = options.baseDelayMs ?? 800;
  const retryRefreshRace = options.retryRefreshRace ?? true;

  let result = await operation();

  for (let attempt = 0; attempt < retries; attempt++) {
    const error = result.error;
    if (!isTransientAuthError(error)) break;
    if (!retryRefreshRace && isRefreshRaceError(error)) break;
    await sleep(baseDelayMs * 2 ** attempt);
    result = await operation();
  }

  return result;
}
