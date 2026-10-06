import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isTransientAuthError } from "@/lib/auth-errors";
import { dampedAuthFetch } from "@/lib/supabase/auth-fetch";

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // API routes and non-GET requests (server actions) authenticate inside the
  // handler itself — they all call getUser() and can persist rotated cookies
  // from a route handler or action. Doing it here as well doubled every call
  // against the Supabase Auth API (the source of `over_request_rate_limit`
  // 429s) and could redirect a fetch()/server-action POST to the HTML login
  // page, corrupting the JSON/action response.
  if (pathname.startsWith("/api/") || request.method !== "GET") {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
      // Auth API requests go through the refresh damper (lib/supabase/
      // auth-fetch): while the project is rate-limiting refreshes, this
      // bundle answers them locally instead of spending the rate-limit
      // budget on requests that are guaranteed to 429.
      global: { fetch: dampedAuthFetch },
    }
  );

  // Page navigations only: getSession() reads the session from the request
  // cookies and contacts the Auth API solely when the access token actually
  // needs a refresh — unlike getUser()/getClaims(), which make a network
  // round trip on every request. The refresh it performs is captured by
  // setAll above, which is what keeps Server Components (they cannot set
  // cookies themselves) supplied with valid tokens.
  //
  // The identity used here only decides redirects: UI visibility is not a
  // security control — RLS, requireRole() in the layouts and the
  // getUser() checks in every server action remain the enforcement layer.
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  // A transient Auth failure (rate limit, refresh-token rotation race) is
  // not proof the user signed out. Let the request through; the page's own
  // requireRole()/getUser() gate decides, and the next request carries the
  // rotated cookies instead of bouncing a valid session to /login.
  if (sessionError && isTransientAuthError(sessionError)) {
    return supabaseResponse;
  }

  const isAuthenticated = Boolean(session);

  // Redirect unauthenticated users to /login (except public routes). Every
  // exemption below must prefix-match a real route — enforced by
  // tests/routing.test.mjs — so this list cannot rot as routes change.
  if (
    !isAuthenticated &&
    !pathname.startsWith("/login") &&
    !pathname.startsWith("/register") &&
    !pathname.startsWith("/setup") &&
    // Password recovery: these are the destinations of the emails sent to
    // NOT-yet-authenticated (or not-yet-signed-in) recipients, and the
    // reset page consumes its tokens BEFORE a session exists.
    !pathname.startsWith("/forgot-password") &&
    !pathname.startsWith("/reset-password") &&
    pathname !== "/"
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Redirect authenticated users away from /login
  if (isAuthenticated && pathname.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (metadata file)
     * - image/manifest/robots extensions: fetched before a session exists, so
     *   redirecting them to /login would break PWA install
     * Feel free to modify this pattern to include more paths.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|webmanifest|ico|txt)$).*)",
  ],
};
