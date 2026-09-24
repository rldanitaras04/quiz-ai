import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')];
    })
);

const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const offeringId = 'dfd3edbf-61b7-4a11-ad38-ec6f65099f1c';

const { data: deployments } = await db
  .from('assessment_deployments')
  .select('id, status, score_release_mode, opens_at, closes_at')
  .eq('subject_offering_id', offeringId);

console.log('deployments:', JSON.stringify(deployments, null, 2));

const ids = (deployments ?? []).map((d) => d.id);

if (ids.length) {
  const { data: attempts } = await db
    .from('exam_attempts')
    .select('id, student_id, status, deployment_id, submitted_at')
    .in('deployment_id', ids);
  console.log('attempts:', JSON.stringify(attempts, null, 2));

  const { data: results, error } = await db
    .from('assessment_results')
    .select('id, attempt_id, student_id, deployment_id, status, raw_score, possible_score, percentage, released_at, created_at')
    .in('deployment_id', ids);
  console.log('results error:', error?.message ?? 'none');
  console.log('results:', JSON.stringify(results, null, 2));
}
