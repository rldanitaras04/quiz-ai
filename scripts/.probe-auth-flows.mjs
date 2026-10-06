// TEMP diagnostic — exercises every email flow the app now depends on:
//   1. registration creates an UNCONFIRMED user (register/actions.ts)
//   2. signInWithPassword on that user must be REFUSED ("Email not confirmed")
//   3. recovery dispatch (sendPasswordResetEmail / sendUserPasswordReset)
//   4. resend(type:'signup') dispatches the confirmation email
//   5. approval magic-link dispatch (dispatchApprovalNotice)
//   6. generated verify links pass the project's redirect allowlist
//   7. the /profile change-password sequence: verify current on a throwaway
//      session, revoke it with scope=local, updateUser on a real session
// Sends are staggered >60s apart because GoTrue rate-limits them (429), and
// the allowlist probes run LAST because visiting a verify link consumes it
// (it confirms the user, which would invalidate the resend check).
// Then deletes the probe users. Run: node scripts/.probe-auth-flows.mjs
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      const key = l.slice(0, i).trim();
      // .env.local quotes values; strip one layer so they compare as strings.
      const value = l.slice(i + 1).trim().replace(/^"([^"]*)"$/, '$1').replace(/^'([^']*)'$/, '$1');
      return [key, value];
    })
);

const app = env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false, flowType: 'implicit' },
});

const stamp = Date.now();
const PW = 'ProbePass123!';
const results = [];
const record = (label, ok, detail) => {
  results.push({ label, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}\n      ${detail}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// `--allowlist-only` skips every send (dispatch was already proven) so the
// verify-link probes can be re-run without waiting out the rate limit.
const allowlistOnly = process.argv.includes('--allowlist-only');

// Fetch a GoTrue verify link WITHOUT following the redirect, so we can read
// where it would send the clicker (and whether the allowlist accepted it).
async function probeVerify(label, link) {
  const actionLink = link?.properties?.action_link ?? link?.action_link ?? link?.data?.action_link;
  if (!actionLink) {
    record(
      label,
      false,
      `generateLink returned no action_link (top-level keys: ${Object.keys(link ?? {}).join(', ') || 'none'}, properties: ${Object.keys(link?.properties ?? {}).join(', ') || 'none'})`
    );
    return;
  }
  try {
    const res = await fetch(actionLink, { redirect: 'manual' });
    const loc = res.headers.get('location') ?? '';
    const bare = loc.replace(/[?#].*$/, '');
    const allowed =
      (res.status === 302 || res.status === 303 || res.status === 307) && loc.startsWith(app);
    record(
      label,
      allowed,
      allowed
        ? `status ${res.status} → ${bare} (allowlist ACCEPTS ${app})`
        : `status ${res.status} → ${loc ? bare || loc.slice(0, 90) : 'no Location'} (allowlist PROBLEM for ${app})`
    );
  } catch (err) {
    record(label, false, `fetch failed: ${err.message}`);
  }
}

// ---- probe users ------------------------------------------------------------
const confirmEmail = `confirm-probe-${stamp}@example.com`;
const otpEmail = `otp-probe-${stamp}@example.com`;

const { data: created, error: createErr } = await admin.auth.admin.createUser({
  email: confirmEmail,
  password: PW,
  email_confirm: false,
});
const { data: created2, error: confirmedErr } = await admin.auth.admin.createUser({
  email: otpEmail,
  password: PW,
  email_confirm: true,
});

if (created?.user) {
  record(
    'register: createUser (unconfirmed)',
    !created.user.email_confirmed_at,
    `id=${created.user.id}, email_confirmed_at=${created.user.email_confirmed_at ?? 'null (correct)'}`
  );

  const { error: signInErr } = await anon.auth.signInWithPassword({
    email: confirmEmail,
    password: PW,
  });
  const gated = Boolean(signInErr && /not confirmed/i.test(signInErr.message));
  record(
    'login blocked until confirmed',
    gated,
    gated
      ? `"${signInErr.message}" — hosted "Confirm email" is ON`
      : signInErr
        ? `unexpected error: ${signInErr.message}`
        : 'SIGN-IN SUCCEEDED while unconfirmed — hosted "Confirm email" is OFF'
  );
} else {
  record('register: createUser (unconfirmed)', false, createErr?.message ?? 'no user returned');
}

if (!created2?.user) {
  record('probe user for otp/recovery', false, confirmedErr?.message ?? 'no user returned');
}

// ---- send #1: password recovery --------------------------------------------
if (created2?.user && !allowlistOnly) {
  const { error: recoverErr } = await admin.auth.resetPasswordForEmail(otpEmail, {
    redirectTo: `${app}/reset-password`,
  });
  record(
    'password recovery dispatch',
    !recoverErr,
    recoverErr ? `${recoverErr.status ?? ''} ${recoverErr.message}` : 'GoTrue accepted the recovery email'
  );

  console.log('      (waiting 65s for the email rate limit to clear…)');
  await sleep(65_000);

  // ---- send #2: confirmation ----------------------------------------------
  if (created?.user) {
    const { error: resendErr } = await admin.auth.resend({
      type: 'signup',
      email: confirmEmail,
      options: { emailRedirectTo: `${app}/login` },
    });
    record(
      'register: confirmation email dispatch',
      !resendErr,
      resendErr ? `${resendErr.status ?? ''} ${resendErr.message}` : 'GoTrue accepted the confirmation email'
    );
  }

  // ---- send #3: approval magic link ---------------------------------------
  const { error: otpErr } = await admin.auth.signInWithOtp({
    email: otpEmail,
    options: { emailRedirectTo: `${app}/login`, shouldCreateUser: false },
  });
  record(
    'approval magic-link dispatch',
    !otpErr,
    otpErr ? `${otpErr.status ?? ''} ${otpErr.message}` : 'GoTrue accepted the approval email'
  );
}

// ---- allowlist probes (consume the generated links, so they run last) -------
if (created?.user) {
  const { data: link, error: genErr } = await admin.auth.admin.generateLink({
    type: 'signup',
    email: confirmEmail,
    options: { emailRedirectTo: `${app}/login` },
  });
  if (genErr) record('confirm link allowlist', false, `${genErr.status ?? ''} ${genErr.message}`);
  else await probeVerify('confirm link allowlist', link);
}

if (created2?.user) {
  const { data: recLink, error: recGenErr } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email: otpEmail,
    options: { redirectTo: `${app}/reset-password` },
  });
  if (recGenErr) record('recovery link allowlist', false, `${recGenErr.status ?? ''} ${recGenErr.message}`);
  else await probeVerify('recovery link allowlist', recLink);
}

// ---- password change (the /profile action's exact sequence, no emails) -----
// Mirrors changePassword in src/app/actions/profile.ts: verify current on a
// throwaway client -> revoke that session with scope=local (ONLY it) ->
// updateUser through a real session. Also captures the error strings the
// action maps.
const pwEmail = `password-probe-${stamp}@example.com`;
const NEW_PW = 'NewProbePass456!';
const throwawayClient = () =>
  createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });

const { data: pwCreated, error: pwCreateErr } = await admin.auth.admin.createUser({
  email: pwEmail,
  password: PW,
  email_confirm: true,
});

if (pwCreated?.user) {
  // (a) wrong current password -> the exact message changePassword maps on
  const wrong = await throwawayClient().auth.signInWithPassword({
    email: pwEmail,
    password: 'WrongProbePass999!',
  });
  record(
    'change password: wrong current rejected',
    Boolean(wrong.error && /invalid login credentials/i.test(wrong.error.message)),
    wrong.error ? `"${wrong.error.message}"` : 'SIGN-IN SUCCEEDED with a wrong password'
  );

  // (b) correct current password -> throwaway session + a second session
  const verify = await throwawayClient().auth.signInWithPassword({ email: pwEmail, password: PW });
  const other = await throwawayClient().auth.signInWithPassword({ email: pwEmail, password: PW });

  if (verify.error || other.error || !verify.data.session || !other.data.session) {
    record(
      'change password: current password verified',
      false,
      verify.error?.message ?? other.error?.message ?? 'no session returned'
    );
  } else {
    record('change password: current password verified', true, 'password grant accepted');

    // (c) scope=local must kill ONLY the throwaway session
    const { error: revokeErr } = await admin.auth.admin.signOut(
      verify.data.session.access_token,
      'local'
    );
    const dead = await throwawayClient().auth.refreshSession({
      refresh_token: verify.data.session.refresh_token,
    });
    const alive = await throwawayClient().auth.refreshSession({
      refresh_token: other.data.session.refresh_token,
    });

    record(
      'change password: throwaway session revoked (local scope)',
      !revokeErr && Boolean(dead.error) && !alive.error,
      `revoke=${revokeErr?.message ?? 'ok'}, throwaway refresh=${dead.error ? 'rejected ✓' : 'STILL VALID'}, other session refresh=${alive.error ? `BROKEN (${alive.error.message})` : 'still valid ✓'}`
    );

    // (d) updateUser through a real session, incl. the "same password" error
    const sessionHolder = throwawayClient();
    await sessionHolder.auth.setSession({
      access_token: other.data.session.access_token,
      refresh_token: other.data.session.refresh_token,
    });

    const sameErr = await sessionHolder.auth.updateUser({ password: PW });
    record(
      'change password: same-as-current refused by GoTrue',
      Boolean(sameErr.error),
      sameErr.error ? `"${sameErr.error.message}"` : 'GoTrue ACCEPTED the identical password'
    );

    const changed = await sessionHolder.auth.updateUser({ password: NEW_PW });
    const relogin = await throwawayClient().auth.signInWithPassword({
      email: pwEmail,
      password: NEW_PW,
    });
    record(
      'change password: new password takes effect',
      !changed.error && !relogin.error,
      changed.error
        ? `update failed: ${changed.error.message}`
        : relogin.error
          ? `sign-in with new password failed: ${relogin.error.message}`
          : `update ok, sign-in with the NEW password ok`
    );
  }
} else {
  record('change password: probe user', false, pwCreateErr?.message ?? 'no user returned');
}

// ---- cleanup ---------------------------------------------------------------
if (pwCreated?.user) {
  const { error: del3 } = await admin.auth.admin.deleteUser(pwCreated.user.id);
  record('cleanup password probe user', !del3, del3 ? del3.message : 'removed');
}
if (created?.user) {
  const { error: del1 } = await admin.auth.admin.deleteUser(created.user.id);
  record('cleanup confirm probe user', !del1, del1 ? del1.message : 'removed');
}
if (created2?.user) {
  const { error: del2 } = await admin.auth.admin.deleteUser(created2.user.id);
  record('cleanup otp probe user', !del2, del2 ? del2.message : 'removed');
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
