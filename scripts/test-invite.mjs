/**
 * One-off live test: verify inviteUserByEmail actually dispatches mail.
 * Creates a throwaway user, reports the API result, then deletes the user.
 * Run: node --env-file=.env.local scripts/test-invite.mjs
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const admin = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const testEmail = `invite-test-${Date.now()}@gmail.com`; // must be a real, MX-backed domain (Supabase validates)

console.log('1. Inviting', testEmail, '...');
const { data, error } = await admin.auth.admin.inviteUserByEmail(testEmail);

if (error) {
  console.error('   INVITE FAILED:', error.status, error.message);
  process.exit(1);
}

const userId = data.user?.id;
console.log('   user created:', userId);
console.log('   email_confirmed:', data.user?.email_confirmed_at ?? null, '(null = unconfirmed, as expected)');

// Give the mailer a moment, then clean up.
await new Promise((r) => setTimeout(r, 1500));

console.log('2. Cleaning up throwaway user...');
const del = await admin.auth.admin.deleteUser(userId);
console.log('   deleted:', !del.error ? 'ok' : `FAILED: ${del.error.message}`);

console.log('\nDone. If no error above, the invite email was accepted by the mailer.');
console.log('(Check the Supabase Dashboard > Authentication > Emails log to confirm delivery.)');
