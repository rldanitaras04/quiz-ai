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

const attemptIds = [
  'f08327fb-5344-414f-b3bd-7b60bf92e791',
  '387f9f6b-e764-4f85-8b47-723323adf080',
];

for (const id of attemptIds) {
  const { data: attempt } = await db
    .from('exam_attempts')
    .select('id, assessment_version_id, status, deployment_id')
    .eq('id', id)
    .single();

  const { data: questions } = await db
    .from('questions')
    .select('id, points')
    .eq('attempt.assessment_version_id', attempt.assessment_version_id); // wrong - fix below

  const { data: qs, error: qErr } = await db
    .from('questions')
    .select('id, points')
    .eq('assessment_version_id', attempt.assessment_version_id);

  const { data: responses, error: rErr } = await db
    .from('student_responses')
    .select('id, question_id, selected_choice_id, text_answer, earned_points, scoring_status')
    .eq('attempt_id', id);

  const { data: keys, error: kErr } = await db
    .from('answer_keys')
    .select('id, question_id, correct_choice_id, canonical_answer')
    .in('question_id', (qs ?? []).map((q) => q.id));

  console.log('\n=== attempt', id, '===');
  console.log('version:', attempt.assessment_version_id);
  console.log('questions:', qs?.length, qErr?.message ?? '');
  console.log('responses:', responses?.length, rErr?.message ?? '');
  console.log('keys:', keys?.length, kErr?.message ?? '');
  console.log('sample response:', JSON.stringify(responses?.[0] ?? null));
}
