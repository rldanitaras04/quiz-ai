'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { validateEmail } from '@/lib/validators';
import { LOGIN_PATH, RESET_PASSWORD_PATH, appOrigin } from '@/lib/constants';

/**
 * Shared, pre-login server actions: sign-out, re-sending the signup
 * confirmation email, and requesting a password-reset email.
 *
 * Both email actions run through the SERVICE-ROLE client on purpose: it
 * uses the implicit auth flow, so the link it mints carries no PKCE code
 * challenge and therefore works from the recipient's own browser. A link
 * issued by a PKCE client only completes in the browser that requested it
 * (it needs the stored code verifier), which is useless for an email that
 * may be opened on a phone or another machine. The landing pages consume
 * the tokens from the URL fragment: /login for confirmation,
 * /reset-password for recovery.
 */

/** Lower-cased, trimmed form of whatever the browser posted. */
function normalizeEmail(email: string): string {
  return String(email ?? '').trim().toLowerCase();
}

/**
 * GoTrue never says whether an address is registered (anti-enumeration), so
 * neither do we: an unknown recipient is reported as success, and only a
 * real dispatch problem (rate limit, mailer failure) reaches the user.
 */
function mapSendError(message: string, status: number | undefined): { error: string } | null {
  if (/not found|no user/i.test(message)) return null;
  if (status === 429 || /rate limit/i.test(message)) {
    return { error: 'Too many requests — wait a minute and try again.' };
  }
  return { error: 'Could not send the email right now. Please try again shortly.' };
}

/**
 * Sign the user out server-side so the httpOnly auth cookies set by
 * @supabase/ssr are actually removed. The client-side signOut in TopBar is
 * kept as a belt-and-braces cleanup of local session state.
 */
export async function signOut(): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();
  if (error) return { error: error.message };
  return {};
}

/**
 * Re-send the "confirm your signup" email. Used by the login page when a
 * user with an unconfirmed address tries to sign in: GoTrue refuses the
 * session with "Email not confirmed" until the link is clicked, so the user
 * needs a way to get that email again.
 */
export async function resendConfirmationEmail(email: string): Promise<{ error?: string }> {
  const addr = normalizeEmail(email);
  if (!validateEmail(addr).success) return { error: 'Enter a valid email address.' };

  const admin = createAdminClient();
  const { error } = await admin.auth.resend({
    type: 'signup',
    email: addr,
    options: { emailRedirectTo: `${appOrigin()}${LOGIN_PATH}` },
  });

  if (error) return mapSendError(error.message, (error as { status?: number }).status) ?? {};
  return {};
}

/**
 * Request a password-reset email. Always reports success for an unknown
 * address (see mapSendError): the response must not reveal which emails
 * have accounts.
 */
export async function sendPasswordResetEmail(email: string): Promise<{ error?: string }> {
  const addr = normalizeEmail(email);
  if (!validateEmail(addr).success) return { error: 'Enter a valid email address.' };

  const admin = createAdminClient();
  const { error } = await admin.auth.resetPasswordForEmail(addr, {
    redirectTo: `${appOrigin()}${RESET_PASSWORD_PATH}`,
  });

  if (error) return mapSendError(error.message, (error as { status?: number }).status) ?? {};
  return {};
}
