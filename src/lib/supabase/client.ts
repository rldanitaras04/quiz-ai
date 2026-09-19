import { createBrowserClient } from "@supabase/ssr";

// Client components are statically prerendered at build time, which constructs
// this client without a real backend. If the public env vars are missing or
// malformed (e.g. a project ref pasted instead of a URL), fall back to a
// placeholder so prerendering succeeds. The placeholder client never performs
// I/O during prerender; in the browser the real values are inlined.
const FALLBACK_URL = "http://localhost:54321";
const FALLBACK_KEY = "build-time-placeholder-anon-key";

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key || !isValidHttpUrl(url)) {
    console.warn(
      "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are missing or invalid " +
        "(NEXT_PUBLIC_SUPABASE_URL must be a full https://... URL). " +
        "Using a placeholder browser client — authentication will not work until .env.local is fixed."
    );
    return createBrowserClient(FALLBACK_URL, FALLBACK_KEY);
  }

  return createBrowserClient(url, key);
}
