import { cache } from "react";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { dampedAuthFetch } from "./auth-fetch";

/**
 * One Supabase client per request: React's `cache` dedupes every
 * `createClient()` call inside a single render (layout, page, lib helpers),
 * so the request loads the session once instead of once per call site.
 * Outside React's render (route handlers, server actions) `cache` passes
 * through to the wrapped function — nothing is reused across requests.
 */
export const createClient = cache(async () => {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing sessions.
          }
        },
      },
      // All Auth API requests flow through the refresh damper (./auth-fetch)
      // so per-request clients cannot drive a rate-limited project deeper
      // into `over_request_rate_limit`.
      global: { fetch: dampedAuthFetch },
    }
  );
});
