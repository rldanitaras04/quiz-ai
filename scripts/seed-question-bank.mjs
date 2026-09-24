/**
 * Seed the question bank from existing assessment questions.
 *
 * Copies every row in `questions` (plus its choices and answer key) into
 * `question_bank` / `question_bank_choices` / `question_bank_answer_keys`.
 * Idempotent: questions already present via source_question_id are skipped.
 *
 * Run:  node --env-file=.env.local scripts/seed-question-bank.mjs
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. ' +
      'Run with: node --env-file=.env.local scripts/seed-question-bank.mjs'
  );
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PAGE = 200;
const summary = { fetched: 0, created: 0, skipped: 0, failed: 0 };

async function fetchAll(table, select, order = 'created_at') {
  const rows = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .order(order, { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

// Resolve subject_id for each assessment (via offering when needed).
const subjectIdByAssessment = new Map();
async function resolveSubjectId(assessmentId) {
  if (subjectIdByAssessment.has(assessmentId)) return subjectIdByAssessment.get(assessmentId);

  const { data: assess, error: aErr } = await supabase
    .from('assessments')
    .select('id, subject_offering_id')
    .eq('id', assessmentId)
    .single();
  if (aErr || !assess) {
    subjectIdByAssessment.set(assessmentId, null);
    return null;
  }

  let subjectId = null;
  if (assess.subject_offering_id) {
    const { data: off } = await supabase
      .from('subject_offerings')
      .select('subject_id')
      .eq('id', assess.subject_offering_id)
      .single();
    subjectId = off?.subject_id ?? null;
  }
  subjectIdByAssessment.set(assessmentId, subjectId);
  return subjectId;
}

// Already-seeded source question ids.
const { data: existing, error: eErr } = await supabase
  .from('question_bank')
  .select('source_question_id')
  .not('source_question_id', 'is', null);
if (eErr) throw new Error(`question_bank: ${eErr.message}`);
const seeded = new Set(existing.map((r) => r.source_question_id).filter(Boolean));

// Load questions with their choices + answer keys + version → assessment.
const questions = await fetchAll(
  'questions',
  `id, assessment_version_id, question_type, question_text, difficulty, bloom_level, points, topic_id, image_url, image_storage_path, created_by,
   question_choices(id, choice_key, choice_text, position),
   answer_keys(correct_choice_id, canonical_answer, accepted_answers)`
);
summary.fetched = questions.length;

// Map version → assessment.
const versionIds = [...new Set(questions.map((q) => q.assessment_version_id))];
const versionToAssessment = new Map();
for (let i = 0; i < versionIds.length; i += PAGE) {
  const chunk = versionIds.slice(i, i + PAGE);
  const { data: vers, error } = await supabase
    .from('assessment_versions')
    .select('id, assessment_id')
    .in('id', chunk);
  if (error) throw new Error(`assessment_versions: ${error.message}`);
  for (const v of vers) versionToAssessment.set(v.id, v.assessment_id);
}

for (const q of questions) {
  if (seeded.has(q.id)) {
    summary.skipped += 1;
    continue;
  }

  try {
    const assessmentId = versionToAssessment.get(q.assessment_version_id);
    const subjectId = assessmentId ? await resolveSubjectId(assessmentId) : null;
    if (!subjectId) {
      console.warn(`skip ${q.id}: cannot resolve subject`);
      summary.failed += 1;
      continue;
    }

    const answerKey = Array.isArray(q.answer_keys) ? q.answer_keys[0] : q.answer_keys;
    const choices = [...(q.question_choices ?? [])].sort(
      (a, b) => (a.position ?? 0) - (b.position ?? 0)
    );

    const { data: bank, error: bErr } = await supabase
      .from('question_bank')
      .insert({
        subject_id: subjectId,
        topic_id: q.topic_id ?? null,
        question_type: q.question_type,
        question_text: q.question_text,
        difficulty: q.difficulty,
        bloom_level: q.bloom_level,
        points: q.points,
        image_url: q.image_url ?? null,
        image_storage_path: q.image_storage_path ?? null,
        source_question_id: q.id,
        source_metadata: { seeded_from_assessment: assessmentId },
        created_by: q.created_by ?? null,
        status: 'active',
      })
      .select('id')
      .single();
    if (bErr || !bank) throw new Error(bErr?.message ?? 'insert failed');

    let bankChoices = [];
    if (q.question_type === 'multiple_choice' && choices.length > 0) {
      const { data: rows, error: cErr } = await supabase
        .from('question_bank_choices')
        .insert(
          choices.map((c, idx) => ({
            bank_question_id: bank.id,
            choice_key: c.choice_key,
            choice_text: c.choice_text,
            position: idx,
          }))
        )
        .select('id, choice_key');
      if (cErr) throw new Error(cErr.message);
      bankChoices = rows ?? [];
    }

    if (answerKey) {
      let correctChoiceId = null;
      if (answerKey.correct_choice_id) {
        const original = choices.find((c) => c.id === answerKey.correct_choice_id);
        if (original) {
          correctChoiceId =
            bankChoices.find((c) => c.choice_key === original.choice_key)?.id ?? null;
        }
      }
      const keyPayload = {
        bank_question_id: bank.id,
        correct_choice_id: correctChoiceId,
        canonical_answer: answerKey.canonical_answer ?? null,
        accepted_answers: answerKey.accepted_answers ?? [],
        updated_by: q.created_by ?? null,
      };
      const { error: kErr } = await supabase
        .from('question_bank_answer_keys')
        .insert(keyPayload);
      if (kErr) throw new Error(kErr.message);
    }

    summary.created += 1;
  } catch (err) {
    summary.failed += 1;
    console.error(`failed ${q.id}:`, err instanceof Error ? err.message : err);
  }
}

console.log(
  `Question bank seed complete: ${summary.created} created, ` +
    `${summary.skipped} already present, ${summary.failed} failed ` +
    `(of ${summary.fetched} source questions).`
);
