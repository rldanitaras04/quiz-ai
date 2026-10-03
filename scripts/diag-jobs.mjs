/**
 * Read-only health check for the generation-job activity log
 * (assessment_generation_jobs): status counts, non-terminal ("pending")
 * rows, and the most recent failures.
 *
 * Context: nothing in the app ever transitions this table's status — it is
 * an append-only activity log (one insert site, two reads, zero updates), so
 * a lingering `queued` row is a harmless orphan rather than pending work.
 * This script exists to make that verifiable at a glance.
 *
 * Run:  node --env-file=.env.local scripts/diag-jobs.mjs
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error('Missing Supabase env vars. Run: node --env-file=.env.local scripts/diag-jobs.mjs');
  process.exit(1);
}

const db = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

const { data: jobs, error } = await db
  .from('assessment_generation_jobs')
  .select('id, operation, status, error_message, created_at, updated_at, assessment_id');
if (error) {
  console.error('QUERY FAILED:', error.message);
  process.exit(1);
}

const counts = {};
for (const j of jobs) counts[j.status] = (counts[j.status] ?? 0) + 1;
console.log(`assessment_generation_jobs: ${jobs.length} total — ${JSON.stringify(counts)}`);

const pending = jobs
  .filter((j) => !TERMINAL.has(j.status))
  .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
console.log(`\nnon-terminal (pending/queued/processing/in_progress): ${pending.length}`);
for (const j of pending) {
  const ageMin = ((Date.now() - Date.parse(j.created_at)) / 60000).toFixed(1);
  const idleMin = ((Date.now() - Date.parse(j.updated_at)) / 60000).toFixed(1);
  console.log(
    `  - [${j.status}] ${j.operation} | age ${ageMin}m | idle ${idleMin}m | ${j.id}` +
      (j.error_message ? ` | err: ${j.error_message}` : '')
  );
}

const failed = jobs
  .filter((j) => j.status === 'failed')
  .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
  .slice(0, 5);
console.log(`\nmost recent failed (last ${failed.length}):`);
if (failed.length === 0) console.log('  (none)');
for (const j of failed) {
  console.log(`  - ${j.updated_at} | ${j.operation} | ${j.error_message ?? '(no error message)'}`);
}
