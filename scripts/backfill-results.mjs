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

const { data: attempts, error } = await db
  .from('exam_attempts')
  .select('id, student_id, deployment_id, assessment_version_id, status')
  .in('status', ['submitted', 'auto_submitted']);

if (error) throw error;

let created = 0;
let skipped = 0;
let failed = 0;

for (const attempt of attempts ?? []) {
  const { data: existing } = await db
    .from('assessment_results')
    .select('id')
    .eq('attempt_id', attempt.id)
    .maybeSingle();

  if (existing) {
    skipped++;
    continue;
  }

  try {
    const { data: questions, error: qErr } = await db
      .from('questions')
      .select('id, points')
      .eq('assessment_version_id', attempt.assessment_version_id);
    if (qErr) throw qErr;

    const { data: responses, error: rErr } = await db
      .from('student_responses')
      .select('earned_points')
      .eq('attempt_id', attempt.id);
    if (rErr) throw rErr;

    const possibleScore = (questions ?? []).reduce((s, q) => s + (q.points ?? 0), 0);
    const rawScore = (responses ?? []).reduce((s, r) => s + (r.earned_points ?? 0), 0);

    const { error: insErr } = await db.from('assessment_results').insert({
      attempt_id: attempt.id,
      student_id: attempt.student_id,
      deployment_id: attempt.deployment_id,
      raw_score: rawScore,
      possible_score: possibleScore || 1,
      status: 'pending',
    });
    if (insErr) throw insErr;

    console.log('created', attempt.id, `${rawScore}/${possibleScore || 1}`);
    created++;
  } catch (e) {
    console.error('failed', attempt.id, e.message ?? e);
    failed++;
  }
}

console.log({ created, skipped, failed, total: (attempts ?? []).length });
