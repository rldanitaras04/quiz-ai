'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type {
  Assessment,
  AssessmentVersion,
  Question,
  QuestionChoice,
  AnswerKey,
  QuestionType,
  Difficulty,
  BloomLevel,
} from '@/lib/types';

function assertFaculty(supabase: Awaited<ReturnType<typeof createClient>>) {
  return async function check(offeringId: string) {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error('Not authenticated');

    const { data: assignment } = await supabase
      .from('faculty_assignments')
      .select('id')
      .eq('subject_offering_id', offeringId)
      .eq('faculty_id', user.id)
      .single();

    if (!assignment) throw new Error('Not authorized for this offering');
    return user.id;
  };
}

export async function getSourceMaterials(offeringId: string) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('source_materials')
    .select('*')
    .eq('subject_offering_id', offeringId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return data || [];
}

export async function getAssessmentWithVersion(assessmentId: string) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

  const { data: assessment, error: assessErr } = await supabase
    .from('assessments')
    .select('*, current_version:assessment_versions(*)')
    .eq('id', assessmentId)
    .single();

  if (assessErr || !assessment) throw new Error('Assessment not found');

  const versionId = assessment.current_version_id;
  let questions: Question[] = [];
  if (versionId) {
    const { data: qData } = await supabase
      .from('questions')
      .select('*')
      .eq('assessment_version_id', versionId)
      .order('position', { ascending: true });
    questions = qData || [];
  }

  return { assessment, questions };
}

export async function getAssessmentQuestions(assessmentId: string) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

  const { data: assessment } = await supabase
    .from('assessments')
    .select('current_version_id')
    .eq('id', assessmentId)
    .single();

  if (!assessment?.current_version_id) return [];

  const { data, error } = await supabase
    .from('questions')
    .select('*, question_choices(*), answer_key:answer_keys(*)')
    .eq('assessment_version_id', assessment.current_version_id)
    .order('position', { ascending: true });

  if (error) throw new Error(error.message);
  return data || [];
}

export async function createAssessment(
  offeringId: string,
  data: {
    title: string;
    instructions?: string;
    assessment_category?: string;
  }
) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

  const { data: offering } = await supabase
    .from('subject_offerings')
    .select('subject_id')
    .eq('id', offeringId)
    .single();

  if (!offering) throw new Error('Subject offering not found');

  const { data: assessment, error: createErr } = await supabase
    .from('assessments')
    .insert({
      subject_id: offering.subject_id,
      created_by: user.id,
      title: data.title,
      assessment_type: 'multiple_choice' as QuestionType,
      status: 'draft' as const,
    })
    .select()
    .single();

  if (createErr || !assessment) throw new Error(createErr?.message || 'Failed to create assessment');

  const { data: version, error: verErr } = await supabase
    .from('assessment_versions')
    .insert({
      assessment_id: assessment.id,
      version_number: 1,
      status: 'draft' as const,
      instructions: data.instructions || null,
      total_items: 0,
      total_points: 0,
      generation_config: data.assessment_category ? { assessment_category: data.assessment_category } : null,
    })
    .select()
    .single();

  if (verErr || !version) throw new Error(verErr?.message || 'Failed to create version');

  await supabase
    .from('assessments')
    .update({ current_version_id: version.id })
    .eq('id', assessment.id);

  revalidatePath(`/faculty/subjects/${offeringId}/assessments`);
  return assessment as Assessment;
}

export async function updateAssessment(
  assessmentId: string,
  data: {
    title?: string;
    instructions?: string;
  }
) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

  if (data.title) {
    const { error } = await supabase
      .from('assessments')
      .update({ title: data.title, updated_at: new Date().toISOString() })
      .eq('id', assessmentId);
    if (error) throw new Error(error.message);
  }

  const { data: assessment } = await supabase
    .from('assessments')
    .select('current_version_id')
    .eq('id', assessmentId)
    .single();

  if (assessment?.current_version_id && data.instructions !== undefined) {
    const { error } = await supabase
      .from('assessment_versions')
      .update({ instructions: data.instructions, updated_at: new Date().toISOString() })
      .eq('id', assessment.current_version_id);
    if (error) throw new Error(error.message);
  }

  revalidatePath(`/faculty/subjects`);
  return { success: true };
}

export async function updateGenerationConfig(
  assessmentId: string,
  config: Record<string, unknown>
) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

  const { data: assessment } = await supabase
    .from('assessments')
    .select('current_version_id')
    .eq('id', assessmentId)
    .single();

  if (!assessment?.current_version_id) throw new Error('No version found');

  const { error } = await supabase
    .from('assessment_versions')
    .update({ generation_config: config, updated_at: new Date().toISOString() })
    .eq('id', assessment.current_version_id);

  if (error) throw new Error(error.message);
  return { success: true };
}

export async function addQuestion(
  assessmentId: string,
  data: {
    question_type: QuestionType;
    question_text: string;
    difficulty: Difficulty;
    bloom_level: BloomLevel;
    points: number;
    choices?: { choice_key: string; choice_text: string }[];
    canonical_answer?: string;
    accepted_answers?: string[];
    correct_choice_key?: string;
  }
) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

  const { data: assessment } = await supabase
    .from('assessments')
    .select('current_version_id')
    .eq('id', assessmentId)
    .single();

  if (!assessment?.current_version_id) throw new Error('No version found');

  const { data: maxPos } = await supabase
    .from('questions')
    .select('position')
    .eq('assessment_version_id', assessment.current_version_id)
    .order('position', { ascending: false })
    .limit(1)
    .single();

  const nextPosition = (maxPos?.position || 0) + 1;

  const { data: question, error: qErr } = await supabase
    .from('questions')
    .insert({
      assessment_version_id: assessment.current_version_id,
      question_type: data.question_type,
      question_text: data.question_text,
      difficulty: data.difficulty,
      bloom_level: data.bloom_level,
      points: data.points,
      position: nextPosition,
      status: 'active',
      created_by: user.id,
      is_ai_generated: false,
    })
    .select()
    .single();

  if (qErr || !question) throw new Error(qErr?.message || 'Failed to add question');

  if (data.choices && data.choices.length > 0) {
    const choiceInserts = data.choices.map((c, i) => ({
      question_id: question.id,
      choice_key: c.choice_key,
      choice_text: c.choice_text,
      position: i,
    }));

    const { data: choices, error: cErr } = await supabase
      .from('question_choices')
      .insert(choiceInserts)
      .select();

    if (cErr) throw new Error(cErr.message);

    if (data.correct_choice_key && choices) {
      const correctChoice = choices.find(c => c.choice_key === data.correct_choice_key);
      if (correctChoice) {
        await supabase.from('answer_keys').insert({
          question_id: question.id,
          correct_choice_id: correctChoice.id,
          updated_by: user.id,
        });
      }
    }
  }

  if (data.question_type === 'identification' && data.canonical_answer) {
    await supabase.from('answer_keys').insert({
      question_id: question.id,
      canonical_answer: data.canonical_answer,
      accepted_answers: data.accepted_answers || [],
      updated_by: user.id,
    });
  }

  await supabase
    .from('assessment_versions')
    .update({
      total_items: (await supabase
        .from('questions')
        .select('id', { count: 'exact', head: true })
        .eq('assessment_version_id', assessment.current_version_id)
      ).count || 0,
      total_points: (await supabase
        .from('questions')
        .select('points')
        .eq('assessment_version_id', assessment.current_version_id)
      ).data?.reduce((sum, q) => sum + (q.points || 0), 0) || 0,
      updated_at: new Date().toISOString(),
    })
    .eq('id', assessment.current_version_id);

  revalidatePath(`/faculty/subjects`);
  return question as Question;
}

export async function updateQuestion(
  questionId: string,
  data: {
    question_text?: string;
    difficulty?: Difficulty;
    bloom_level?: BloomLevel;
    points?: number;
    choices?: { id?: string; choice_key: string; choice_text: string }[];
    correct_choice_key?: string;
    canonical_answer?: string;
    accepted_answers?: string[];
  }
) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

  const updateFields: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (data.question_text !== undefined) updateFields.question_text = data.question_text;
  if (data.difficulty !== undefined) updateFields.difficulty = data.difficulty;
  if (data.bloom_level !== undefined) updateFields.bloom_level = data.bloom_level;
  if (data.points !== undefined) updateFields.points = data.points;

  if (Object.keys(updateFields).length > 1) {
    const { error } = await supabase
      .from('questions')
      .update(updateFields)
      .eq('id', questionId);
    if (error) throw new Error(error.message);
  }

  if (data.choices) {
    await supabase.from('question_choices').delete().eq('question_id', questionId);

    if (data.choices.length > 0) {
      const inserts = data.choices.map((c, i) => ({
        question_id: questionId,
        choice_key: c.choice_key,
        choice_text: c.choice_text,
        position: i,
      }));

      const { data: savedChoices } = await supabase
        .from('question_choices')
        .insert(inserts)
        .select();

      await supabase.from('answer_keys').delete().eq('question_id', questionId);

      if (data.correct_choice_key && savedChoices) {
        const correct = savedChoices.find(c => c.choice_key === data.correct_choice_key);
        if (correct) {
          await supabase.from('answer_keys').insert({
            question_id: questionId,
            correct_choice_id: correct.id,
            updated_by: user.id,
          });
        }
      }
    }
  }

  if (data.canonical_answer !== undefined) {
    await supabase.from('answer_keys').delete().eq('question_id', questionId);
    await supabase.from('answer_keys').insert({
      question_id: questionId,
      canonical_answer: data.canonical_answer,
      accepted_answers: data.accepted_answers || [],
      updated_by: user.id,
    });
  }

  revalidatePath(`/faculty/subjects`);
  return { success: true };
}

export async function deleteQuestion(questionId: string) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

  const { data: question } = await supabase
    .from('questions')
    .select('assessment_version_id, position')
    .eq('id', questionId)
    .single();

  const { error } = await supabase.from('questions').delete().eq('id', questionId);
  if (error) throw new Error(error.message);

  if (question) {
    await supabase
      .from('questions')
      .update({ position: supabase.rpc ? 0 : 0 })
      .eq('assessment_version_id', question.assessment_version_id)
      .gt('position', question.position);

    const { count } = await supabase
      .from('questions')
      .select('id', { count: 'exact', head: true })
      .eq('assessment_version_id', question.assessment_version_id);

    const { data: remaining } = await supabase
      .from('questions')
      .select('points')
      .eq('assessment_version_id', question.assessment_version_id);

    await supabase
      .from('assessment_versions')
      .update({
        total_items: count || 0,
        total_points: remaining?.reduce((sum, q) => sum + (q.points || 0), 0) || 0,
        updated_at: new Date().toISOString(),
      })
      .eq('id', question.assessment_version_id);
  }

  revalidatePath(`/faculty/subjects`);
  return { success: true };
}

export async function addAnswerKey(
  questionId: string,
  data: {
    correct_choice_id?: string;
    canonical_answer?: string;
    accepted_answers?: string[];
  }
) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

  await supabase.from('answer_keys').delete().eq('question_id', questionId);

  const { error } = await supabase.from('answer_keys').insert({
    question_id: questionId,
    correct_choice_id: data.correct_choice_id || null,
    canonical_answer: data.canonical_answer || null,
    accepted_answers: data.accepted_answers || null,
    updated_by: user.id,
  });

  if (error) throw new Error(error.message);
  revalidatePath(`/faculty/subjects`);
  return { success: true };
}

export async function approveAssessment(assessmentId: string) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

  const { data: assessment } = await supabase
    .from('assessments')
    .select('current_version_id')
    .eq('id', assessmentId)
    .single();

  if (!assessment?.current_version_id) throw new Error('No version found');

  const { error: assessErr } = await supabase
    .from('assessments')
    .update({ status: 'approved', updated_at: new Date().toISOString() })
    .eq('id', assessmentId);
  if (assessErr) throw new Error(assessErr.message);

  const { error: verErr } = await supabase
    .from('assessment_versions')
    .update({
      status: 'approved',
      approved_by: user.id,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', assessment.current_version_id);
  if (verErr) throw new Error(verErr.message);

  revalidatePath(`/faculty/subjects`);
  return { success: true };
}

export async function publishAssessment(assessmentId: string) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

  const { data: assessment } = await supabase
    .from('assessments')
    .select('current_version_id')
    .eq('id', assessmentId)
    .single();

  if (!assessment?.current_version_id) throw new Error('No version found');

  const { error: assessErr } = await supabase
    .from('assessments')
    .update({ status: 'published', updated_at: new Date().toISOString() })
    .eq('id', assessmentId);
  if (assessErr) throw new Error(assessErr.message);

  const { error: verErr } = await supabase
    .from('assessment_versions')
    .update({
      status: 'published',
      published_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', assessment.current_version_id);
  if (verErr) throw new Error(verErr.message);

  revalidatePath(`/faculty/subjects`);
  return { success: true };
}

export async function triggerGeneration(
  assessmentId: string,
  config: {
    source_material_ids: string[];
    question_types: QuestionType[];
    count_per_type: Record<QuestionType, number>;
    difficulty_distribution: Record<Difficulty, number>;
    bloom_distribution: Record<BloomLevel, number>;
    custom_instructions?: string;
  }
) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

  const { data: job, error: jobErr } = await supabase
    .from('assessment_generation_jobs')
    .insert({
      assessment_id: assessmentId,
      requested_by: user.id,
      operation: 'generate_questions',
      status: 'queued',
      input_config: config,
    })
    .select()
    .single();

  if (jobErr || !job) throw new Error(jobErr?.message || 'Failed to create generation job');

  return job;
}
