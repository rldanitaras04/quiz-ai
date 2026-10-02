/**
 * Smoke test for the scheduled-maintenance sweep (migration
 * 20261006000000): invokes run_scheduled_maintenance() through the
 * service-role client and reports what it did.
 *
 * Every step is time-gated, so on a quiet database the expected output is an
 * all-zero result — the point is proving the function exists, compiles, and
 * runs end-to-end (plpgsql bodies are only fully checked at first execution,
 * and the pg_cron schedule is best-effort).
 *
 * Run:  node --env-file=.env.local scripts/diag-sweep.mjs
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error('Missing Supabase env vars. Run: node --env-file=.env.local scripts/diag-sweep.mjs');
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

const { data, error } = await admin.rpc('run_scheduled_maintenance');

if (error) {
  console.error(`FAIL  run_scheduled_maintenance: ${error.message} (${error.code ?? 'no code'})`);
  process.exit(1);
}

const expectedKeys = ['closed', 'activated', 'reminded', 'released', 'notified'];
const keys = Object.keys(data ?? {});
const shapeOk = expectedKeys.every((k) => Number.isInteger(data?.[k])) && keys.length === expectedKeys.length;

if (!shapeOk) {
  console.error(`FAIL  unexpected result shape: ${JSON.stringify(data)}`);
  process.exit(1);
}

console.log(`PASS  sweep executed: ${JSON.stringify(data)}`);

// Second invocation in a row must also succeed: idempotency is the contract
// that lets pg_cron, lazy page loads and the HTTP endpoint all share it.
const second = await admin.rpc('run_scheduled_maintenance');
if (second.error) {
  console.error(`FAIL  second invocation: ${second.error.message}`);
  process.exit(1);
}
console.log(`PASS  second invocation (idempotent): ${JSON.stringify(second.data)}`);
