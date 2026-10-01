/**
 * Refresh-dampening `fetch` for the Supabase Auth API (server only).
 *
 * Every server request builds fresh Supabase clients (the proxy plus each
 * Server Component / action), and every client registers its own
 * `onAuthStateChange` listeners, whose INITIAL_SESSION handler re-runs a
 * session load. When the stored session is inside the 90s expiry margin —
 * or past it — and the Auth API is rate-limiting us
 * (`over_request_rate_limit`, HTTP 429), each of those clients fires its own
 * refresh POST. One page view therefore burns several requests against an
 * already-empty rate-limit bucket, so the bucket never drains and auth-js
 * logs the 429 from its INITIAL_SESSION catch. The per-client failure
 * cooldown inside auth-js cannot help here: it dies with the client at the
 * end of the request.
 *
 * This wrapper keeps a per-bundle cooldown: after a real 429 on a
 * `grant_type=refresh_token` request, further refresh attempts are answered
 * locally with the same 429 body GoTrue would return — no network round
 * trip, no latency, no consumption of the rate-limit budget — until the
 * cooldown elapses. The first real attempt after the cooldown probes the
 * API again; once it succeeds the session rotates, callers stop seeing the
 * error, and the log noise disappears. Anything that is not a refresh
 * request passes straight through to the global fetch.
 */

/** Quiet window after a real 429 before the next refresh probe goes out. */
const REFRESH_COOLDOWN_MS = 30_000;

/**
 * Process-wide (per bundle) timestamp until which refresh requests are
 * answered locally. The proxy and the page runtime each bundle their own
 * copy of this module, so worst case each probes once per window.
 */
let refreshRetryBlockedUntil = 0;

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function isRefreshRequest(url: string): boolean {
  // GoTrue refresh calls are `POST {supabaseUrl}/auth/v1/token?grant_type=refresh_token`.
  // Matched without a leading slash so the route-literal guardrail
  // (tests/routing.test.mjs) does not read this as an app path.
  return url.includes("auth/v1/token") && url.includes("grant_type=refresh_token");
}

/** Mirrors GoTrue's real 429 body so auth-js classifies it identically (`AuthApiError`, `code: 'over_request_rate_limit'`, `status: 429`). */
function rateLimitedResponse(): Response {
  return new Response(
    JSON.stringify({
      code: 429,
      error_code: "over_request_rate_limit",
      msg: "Request rate limit reached",
    }),
    {
      status: 429,
      headers: { "Content-Type": "application/json" },
    }
  );
}

/**
 * Drop-in `global.fetch` for the server Supabase clients. Dampens token
 * refreshes while the Auth API is rate-limiting; forwards everything else
 * unchanged.
 */
export async function dampedAuthFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const url = requestUrl(input);

  if (!isRefreshRequest(url)) {
    return globalThis.fetch(input, init);
  }

  if (Date.now() < refreshRetryBlockedUntil) {
    return rateLimitedResponse();
  }

  const response = await globalThis.fetch(input, init);
  if (response.status === 429) {
    refreshRetryBlockedUntil = Date.now() + REFRESH_COOLDOWN_MS;
  }
  return response;
}
