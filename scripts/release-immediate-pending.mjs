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

const { data: released, error } = await db
  .from('assessment_results')
  .update({
    status: 'released',
    released_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })
  .eq('status', 'pending')
  .in(
    'deployment_id',
    // only for deployments set to immediate release
    (
      await db
        .from('assessment_deployments')
        .select('id')
        .eq('score_release_mode', 'immediate')
    ).data?.map((d) => d.id) ?? []
  )
  .select('id, attempt_id, status');

if (error) throw error;
console.log('released', released?.length ?? 0, released ?? []);
