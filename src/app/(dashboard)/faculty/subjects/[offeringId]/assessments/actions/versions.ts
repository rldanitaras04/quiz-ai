'use server';

// Version creation, question seeding, deletion and exam-import.
// Split out of the former single actions.ts; blocks are unchanged.

import { createClient } from '@/lib/supabase/server';
import { recordAuditLog } from '@/lib/audit';
import { getFacultyAssessment } from '@/lib/auth';
import type { QuestionType, Difficulty, BloomLevel } from '@/lib/types';
import { type ParsedExamItem } from '@/lib/import/exam-parse';
import { requireUser, assertQuestionsEditable, refreshVersionTotals, revalidateAssessment } from './shared';

/**
 * Creates a new draft version of an assessment. Used when the current version
 * is published or deployed and faculty want to revise questions without
 * affecting existing deployments.
 *
 * The new version inherits the previous version's instructions, generation
 * config, **and questions** (deep-copied with choices + answer keys). Faculty
 * can then add, edit, delete, or import ready-made items on the new draft.
 * The assessment status resets to `draft`.
 */
export async function createNewVersion(
  assessmentId: string
): Promise<{ success: boolean; versionId?: string; copiedQuestions?: number; error?: string }> {
  try {
    const { supabase, userId } = await requireUser();

    const assessment = await getFacultyAssessment(supabase, userId, assessmentId);
    if (!assessment) {
      return { success: false, error: 'Assessment not found or you are not assigned to its offering' };
    }

    // Determine the next version number.
    const { data: existingVersions } = await supabase
      .from('assessment_versions')
      .select('version_number')
      .eq('assessment_id', assessmentId)
      .order('version_number', { ascending: false })
      .limit(1);

    const nextVersionNumber = (existingVersions?.[0]?.version_number ?? 0) + 1;

    // Copy instructions and generation config from the current version.
    let instructions: string | null = null;
    let generationConfig: Record<string, unknown> | null = null;
    let tosSnapshot: unknown = null;

    if (assessment.currentVersionId) {
      const { data: currentVersion } = await supabase
        .from('assessment_versions')
        .select('instructions, generation_config, tos_snapshot')
        .eq('id', assessment.currentVersionId)
        .maybeSingle();

      instructions = currentVersion?.instructions ?? null;
      generationConfig = (currentVersion?.generation_config as Record<string, unknown>) ?? null;
      // §17: preserve the TOS with each new version, like instructions and
      // generation_config — later edits start from the last approved plan.
      tosSnapshot = currentVersion?.tos_snapshot ?? null;
    }

    // Create the new version.
    const { data: newVersion, error: verErr } = await supabase
      .from('assessment_versions')
      .insert({
        assessment_id: assessmentId,
        version_number: nextVersionNumber,
        status: 'draft',
        instructions,
        generation_config: generationConfig,
        tos_snapshot: tosSnapshot,
        total_items: 0,
        total_points: 0,
      })
      .select('id')
      .single();

    if (verErr || !newVersion) {
      return { success: false, error: verErr?.message ?? 'Failed to create version' };
    }

    // Point the assessment at the new version and reset status to draft.
    const { error: updateErr } = await supabase
      .from('assessments')
      .update({
        current_version_id: newVersion.id,
        status: 'draft',
        updated_at: new Date().toISOString(),
      })
      .eq('id', assessmentId);

    if (updateErr) {
      return { success: false, error: updateErr.message };
    }

    // Deep-copy questions (with choices + answer keys) from the previous version
    // so faculty start from the recent set and can add/edit/delete/import on top.
    let copiedQuestions = 0;
    if (assessment.currentVersionId) {
      const copyResult = await seedVersionQuestions(
        supabase,
        assessment.currentVersionId,
        newVersion.id,
        userId
      );
      if (copyResult.error) {
        return { success: false, error: copyResult.error };
      }
      copiedQuestions = copyResult.copied;
    }

    await refreshVersionTotals(supabase, newVersion.id);

    await recordAuditLog({
      actorUserId: userId,
      action: 'create',
      entityType: 'assessment_version',
      entityId: newVersion.id,
      metadata: {
        assessment_id: assessmentId,
        version_number: nextVersionNumber,
        copied_from: assessment.currentVersionId,
        copied_questions: copiedQuestions,
      },
    });

    revalidateAssessment(assessment.subjectOfferingId, assessmentId);
    return { success: true, versionId: newVersion.id, copiedQuestions };
  } catch {
    return { success: false, error: 'Failed to create new version' };
  }
}

/**
 * Deep-copies questions from `sourceVersionId` into `targetVersionId`,
 * preserving positions, choices, and answer keys (remapping choice ids).
 *
 * Returns `{ copied }` on success or `{ error }` so callers can surface
 * partial failures without throwing past their own result wrappers.
 */
async function seedVersionQuestions(
  supabase: Awaited<ReturnType<typeof createClient>>,
  sourceVersionId: string,
  targetVersionId: string,
  userId: string
): Promise<{ copied: number; error?: string }> {
  const { data: sourceQuestions, error: fetchErr } = await supabase
    .from('questions')
    .select(
      `id, question_type, question_text, difficulty, bloom_level, points, position,
       status, topic_id, image_url, image_storage_path, generation_metadata, is_ai_generated,
       question_choices(id, choice_key, choice_text, position),
       answer_keys(correct_choice_id, canonical_answer, accepted_answers, scoring_config)`
    )
    .eq('assessment_version_id', sourceVersionId)
    .order('position', { ascending: true });

  if (fetchErr) {
    return { copied: 0, error: `Failed to read previous version questions: ${fetchErr.message}` };
  }
  if (!sourceQuestions || sourceQuestions.length === 0) {
    return { copied: 0 };
  }

  let copied = 0;
  for (const sq of sourceQuestions) {
    const q = sq as unknown as {
      question_type: QuestionType;
      question_text: string;
      difficulty: Difficulty;
      bloom_level: BloomLevel;
      points: number;
      position: number;
      status: string;
      topic_id: string | null;
      image_url: string | null;
      image_storage_path: string | null;
      generation_metadata: Record<string, unknown> | null;
      is_ai_generated: boolean;
      question_choices: { id: string; choice_key: string; choice_text: string; position: number }[] | { id: string; choice_key: string; choice_text: string; position: number };
      answer_keys: {
        correct_choice_id: string | null;
        canonical_answer: string | null;
        accepted_answers: string[] | null;
        scoring_config: Record<string, unknown> | null;
      } | {
        correct_choice_id: string | null;
        canonical_answer: string | null;
        accepted_answers: string[] | null;
        scoring_config: Record<string, unknown> | null;
      }[] | null;
    };

    const choices = Array.isArray(q.question_choices)
      ? q.question_choices
      : q.question_choices
        ? [q.question_choices]
        : [];
    const answerKey = Array.isArray(q.answer_keys)
      ? q.answer_keys[0]
      : q.answer_keys;

    const { data: newQ, error: qErr } = await supabase
      .from('questions')
      .insert({
        assessment_version_id: targetVersionId,
        question_type: q.question_type,
        question_text: q.question_text,
        difficulty: q.difficulty,
        bloom_level: q.bloom_level,
        points: q.points,
        position: q.position,
        status: q.status || 'active',
        topic_id: q.topic_id ?? null,
        image_url: q.image_url ?? null,
        image_storage_path: q.image_storage_path ?? null,
        generation_metadata: q.generation_metadata ?? null,
        is_ai_generated: q.is_ai_generated ?? false,
        created_by: userId,
      })
      .select('id')
      .single();

    if (qErr || !newQ) {
      return { copied, error: `Failed to copy question ${q.question_text.slice(0, 40)}: ${qErr?.message ?? 'unknown'}` };
    }

    if (choices.length > 0) {
      const sorted = [...choices].sort((a, b) => a.position - b.position);
      const { data: newChoices, error: cErr } = await supabase
        .from('question_choices')
        .insert(
          sorted.map((c) => ({
            question_id: newQ.id,
            choice_key: c.choice_key,
            choice_text: c.choice_text,
            position: c.position,
          }))
        )
        .select('id, choice_key');

      if (cErr) {
        return { copied, error: `Failed to copy choices: ${cErr.message}` };
      }

      if (answerKey) {
        const oldCorrectId = answerKey.correct_choice_id;
        const oldCorrect = oldCorrectId
          ? sorted.find((c) => c.id === oldCorrectId)
          : undefined;
        const newCorrect = oldCorrect && newChoices
          ? newChoices.find((c) => c.choice_key === oldCorrect.choice_key)
          : undefined;

        const { error: kErr } = await supabase.from('answer_keys').insert({
          question_id: newQ.id,
          correct_choice_id: newCorrect?.id ?? null,
          canonical_answer: answerKey.canonical_answer,
          accepted_answers: answerKey.accepted_answers,
          scoring_config: answerKey.scoring_config,
          updated_by: userId,
        });
        if (kErr) {
          return { copied, error: `Failed to copy answer key: ${kErr.message}` };
        }
      }
    } else if (answerKey) {
      // Identification / TF without choices still carries canonical answer.
      const { error: kErr } = await supabase.from('answer_keys').insert({
        question_id: newQ.id,
        correct_choice_id: null,
        canonical_answer: answerKey.canonical_answer,
        accepted_answers: answerKey.accepted_answers,
        scoring_config: answerKey.scoring_config,
        updated_by: userId,
      });
      if (kErr) {
        return { copied, error: `Failed to copy answer key: ${kErr.message}` };
      }
    }

    copied += 1;
  }

  return { copied };
}

/**
 * Discards a single **draft** version (e.g. an accidental “New version”).
 *
 * Only draft versions are removable — published/approved history and any
 * version that has deployments or attempts stay. When the discarded version
 * is current, the assessment repoints to the next remaining version (if any)
 * and its status is restored from that version so a published assessment is
 * not stuck in draft after a cancelled revision.
 */
export async function deleteAssessmentVersion(
  assessmentId: string,
  versionId: string
): Promise<{ success: boolean; restoredVersionId?: string | null; error?: string }> {
  try {
    const { supabase, userId } = await requireUser();

    const assessment = await getFacultyAssessment(supabase, userId, assessmentId);
    if (!assessment) {
      return { success: false, error: 'Assessment not found or you are not assigned to its offering' };
    }

    const { data: version } = await supabase
      .from('assessment_versions')
      .select('id, status, version_number')
      .eq('id', versionId)
      .eq('assessment_id', assessmentId)
      .maybeSingle();

    if (!version) {
      return { success: false, error: 'Version not found for this assessment' };
    }
    if (version.status !== 'draft') {
      return {
        success: false,
        error: 'Only draft versions can be discarded. Published or approved history is kept.',
      };
    }

    // Guard: a version with deployments/attempts must never be removed.
    const [{ count: depCount }, { count: attemptCount }] = await Promise.all([
      supabase
        .from('assessment_deployments')
        .select('id', { count: 'exact', head: true })
        .eq('assessment_version_id', versionId),
      supabase
        .from('exam_attempts')
        .select('id', { count: 'exact', head: true })
        .eq('assessment_version_id', versionId),
    ]);
    if ((depCount ?? 0) > 0) {
      return { success: false, error: 'This version has deployments — archive or close them before discarding.' };
    }
    if ((attemptCount ?? 0) > 0) {
      return { success: false, error: 'Students have attempts on this version — it cannot be discarded.' };
    }

    const { data: allOthers } = await supabase
      .from('assessment_versions')
      .select('id, status, version_number')
      .eq('assessment_id', assessmentId)
      .neq('id', versionId)
      .order('version_number', { ascending: false });

    if (!allOthers || allOthers.length === 0) {
      return {
        success: false,
        error: 'This is the assessment’s only version. Delete the assessment instead.',
      };
    }

    const isCurrent = assessment.currentVersionId === versionId;
    const nextCurrent = allOthers[0];
    const restoredVersionId = isCurrent ? nextCurrent.id : assessment.currentVersionId;

    if (isCurrent) {
      // Restore assessment status from the version we are falling back to
      // (createNewVersion forces draft; discarding the draft undoes that).
      const restoredStatus =
        nextCurrent.status === 'published'
          ? 'published'
          : nextCurrent.status === 'approved'
            ? 'approved'
            : 'draft';

      const { error: repointErr } = await supabase
        .from('assessments')
        .update({
          current_version_id: nextCurrent.id,
          status: restoredStatus,
          updated_at: new Date().toISOString(),
        })
        .eq('id', assessmentId);

      if (repointErr) {
        return { success: false, error: repointErr.message };
      }
    }

    // Cascades questions, choices, and answer keys.
    const { error: delErr } = await supabase
      .from('assessment_versions')
      .delete()
      .eq('id', versionId)
      .eq('assessment_id', assessmentId);

    if (delErr) {
      return { success: false, error: delErr.message };
    }

    // Confirm the row is gone (RLS can silently no-op).
    const { data: stillThere } = await supabase
      .from('assessment_versions')
      .select('id')
      .eq('id', versionId)
      .maybeSingle();
    if (stillThere) {
      return { success: false, error: 'Could not discard (RLS blocked the write)' };
    }

    await recordAuditLog({
      actorUserId: userId,
      action: 'delete',
      entityType: 'assessment_version',
      entityId: versionId,
      metadata: {
        assessment_id: assessmentId,
        version_number: version.version_number,
        was_current: isCurrent,
        restored_version_id: isCurrent ? nextCurrent.id : null,
      },
    });

    revalidateAssessment(assessment.subjectOfferingId, assessmentId);
    return { success: true, restoredVersionId };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to discard version',
    };
  }
}

// ---------------------------------------------------------------------------
// Deployment status for assessment detail
// ---------------------------------------------------------------------------

/**
 * Import ready-made exam items (pasted or uploaded) into the assessment's
 * **current draft version**. Does NOT replace existing questions — appends
 * after the current max position. Uses the same authz + editability guards
 * as `addQuestion`.
 */
export async function importExamIntoVersion(
  assessmentId: string,
  items: ParsedExamItem[],
  options: { topic_id?: string | null; source_filename?: string } = {}
): Promise<{ imported: number; errors: string[] }> {
  const { supabase, userId } = await requireUser();

  const assessment = await getFacultyAssessment(supabase, userId, assessmentId);
  if (!assessment) {
    throw new Error('Assessment not found or you are not assigned to its offering');
  }
  if (!assessment.currentVersionId) throw new Error('No version found');

  await assertQuestionsEditable(supabase, assessment);

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('No questions to import');
  }
  if (items.length > 200) {
    throw new Error('Import is limited to 200 questions at a time');
  }

  const versionId = assessment.currentVersionId;
  const topicId = options.topic_id || null;

  if (topicId) {
    const { data: topic } = await supabase
      .from('topics')
      .select('id, subject_id')
      .eq('id', topicId)
      .single();
    const { data: offering } = await supabase
      .from('subject_offerings')
      .select('subject_id')
      .eq('id', assessment.subjectOfferingId)
      .single();
    if (!topic || !offering || topic.subject_id !== offering.subject_id) {
      throw new Error('Invalid topic for this subject');
    }
  }

  const { data: maxPos } = await supabase
    .from('questions')
    .select('position')
    .eq('assessment_version_id', versionId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();

  let nextPosition = (maxPos?.position || 0) + 1;
  const errors: string[] = [];
  let imported = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const text = item.question_text?.trim();
    if (!text) {
      errors.push(`Item ${i + 1}: missing question text.`);
      continue;
    }

    try {
      const { data: question, error: qErr } = await supabase
        .from('questions')
        .insert({
          assessment_version_id: versionId,
          question_type: item.question_type,
          question_text: text,
          difficulty: item.difficulty || 'moderate',
          bloom_level: item.bloom_level || 'understand',
          points: item.points || 1,
          position: nextPosition,
          status: 'active',
          created_by: userId,
          is_ai_generated: false,
          topic_id: topicId,
          image_url: null,
          image_storage_path: null,
        })
        .select('id')
        .single();

      if (qErr || !question) {
        errors.push(`Item ${i + 1}: ${qErr?.message ?? 'failed to insert'}`);
        continue;
      }

      if (
        (item.question_type === 'multiple_choice' || item.question_type === 'true_false') &&
        item.choices &&
        item.choices.length > 0
      ) {
        const sorted = [...item.choices];
        const { data: choices, error: cErr } = await supabase
          .from('question_choices')
          .insert(
            sorted.map((c, ci) => ({
              question_id: question.id,
              choice_key: c.choice_key,
              choice_text: c.choice_text,
              position: ci,
            }))
          )
          .select('id, choice_key');
        if (cErr) {
          errors.push(`Item ${i + 1}: choices failed (${cErr.message})`);
          imported += 1; // question row exists; faculty can fix choices in editor
          nextPosition += 1;
          continue;
        }

        const correct = item.correct_choice_key
          ? choices?.find((c) => c.choice_key === item.correct_choice_key)
          : undefined;
        if (correct) {
          await supabase.from('answer_keys').insert({
            question_id: question.id,
            correct_choice_id: correct.id,
            updated_by: userId,
          });
        }
      } else if (item.question_type === 'identification' && item.canonical_answer) {
        await supabase.from('answer_keys').insert({
          question_id: question.id,
          canonical_answer: item.canonical_answer,
          accepted_answers: [],
          updated_by: userId,
        });
      }

      imported += 1;
      nextPosition += 1;
    } catch (e) {
      errors.push(`Item ${i + 1}: ${e instanceof Error ? e.message : 'failed'}`);
    }
  }

  if (imported === 0) {
    throw new Error(errors[0] ?? 'No questions were imported');
  }

  await refreshVersionTotals(supabase, versionId);

  await recordAuditLog({
    actorUserId: userId,
    action: 'create',
    entityType: 'question',
    entityId: `import-${imported}`,
    metadata: {
      assessment_id: assessmentId,
      version_id: versionId,
      imported_count: imported,
      source_filename: options.source_filename ?? null,
    },
  });

  revalidateAssessment(assessment.subjectOfferingId, assessmentId);

  return { imported, errors };
}

