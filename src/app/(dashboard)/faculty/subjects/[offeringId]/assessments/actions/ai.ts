'use server';

// AI generation, AI modification proposals and the pre-exam quality report.
// Split out of the former single actions.ts; blocks are unchanged.

import { recordAuditLog } from '@/lib/audit';
import { getFacultyAssessment } from '@/lib/auth';
import type { QuestionType, Difficulty, BloomLevel, TosRow } from '@/lib/types';
import { activeChatProvider, chatCompletion, hasChatProvider } from '@/lib/ai/chat';
import { buildTosPrompt, parseTosProposal, validateTos } from '@/lib/ai/tos';
import { parseEmbedding } from '@/lib/ai/duplicate-check';
import { getSettings } from '@/lib/settings';
import { dimensionCounts, exactDuplicates, groundingCoverage, semanticSimilarityFlags, tosAlignment, validateQualityQuestions, type DimensionCount, type DuplicateGroup, type GroundingCoverage, type QualityQuestion, type SimilarityFlag, type TosAlignment, type ValidationIssue } from '@/lib/quality';
import { buildModifyPrompt, parseModifyProposals, type DroppedProposal, type ModifyFields, type ModifyProposal, type ModifyQuestionContext } from '@/lib/ai/modify';
import { logAiUsage } from '@/lib/ai/logger';
import { requireUser, requireOfferingFaculty, isQuestionsLocked, revalidateAssessment } from './shared';
// Applying an AI modification set reuses the ordinary question mutations, and
// drafting a revision reuses createNewVersion — same validation, locking,
// totals refresh and audit trail as a manual edit.

import { addQuestion, updateQuestion, deleteQuestion } from './questions';
import { createNewVersion } from './versions';

export interface GenerateTosInput {
  offeringId: string;
  topics: { title: string; description?: string | null }[];
  countPerType: Record<QuestionType, number>;
  difficultyDistribution: Record<Difficulty, number>;
  bloomDistribution: Record<BloomLevel, number>;
  assessmentCategory?: string;
  sourceTitles?: string[];
}

export interface GenerateTosResult {
  success: boolean;
  rows?: TosRow[];
  validation?: { totalItems: number; problems: string[]; warnings: string[] };
  error?: string;
}

/**
 * Propose a Table of Specifications for the wizard (scope §10: "generate a
 * proposed TOS"). The proposal is advisory — nothing is persisted here; the
 * faculty edits/validates/approves it in the wizard, and approveAssessment
 * snapshots the approved rows onto the version's tos_snapshot.
 */
export async function generateAssessmentTOS(input: GenerateTosInput): Promise<GenerateTosResult> {
  const { supabase, userId } = await requireUser();
  await requireOfferingFaculty(supabase, userId, input.offeringId);

  const topics = (input.topics ?? [])
    .map((t) => ({ title: (t.title ?? '').trim(), description: t.description ?? null }))
    .filter((t) => t.title);
  if (topics.length === 0) {
    return { success: false, error: 'Add at least one topic before generating a TOS.' };
  }

  const countPerType = input.countPerType ?? ({} as Record<QuestionType, number>);
  const totalItems = Object.values(countPerType).reduce((sum, v) => sum + (v || 0), 0);
  if (totalItems <= 0) {
    return { success: false, error: 'Set at least one question type with count > 0 first.' };
  }
  if (!hasChatProvider()) {
    return {
      success: false,
      error: 'No AI provider configured — set GROQ_API_KEY or OPENAI_API_KEY.',
    };
  }

  const { system, user } = buildTosPrompt({
    topics,
    totalItems,
    countPerType,
    difficulty: input.difficultyDistribution,
    bloom: input.bloomDistribution,
    assessmentCategory: input.assessmentCategory,
    sourceTitles: input.sourceTitles,
  });

  let chat: Awaited<ReturnType<typeof chatCompletion>>;
  try {
    chat = await chatCompletion(system, user, { temperature: 0.2, maxTokens: 2500 });
  } catch (err) {
    await logAiUsage({
      userId,
      assessmentId: null,
      provider: activeChatProvider(),
      model: '-',
      operation: 'generate_tos',
      tokensUsed: 0,
      durationMs: 0,
      status: 'error',
      errorCode: err instanceof Error ? err.message.slice(0, 120) : 'unknown',
    });
    return { success: false, error: 'The AI provider could not be reached — try again.' };
  }

  let rows: TosRow[];
  try {
    rows = parseTosProposal(
      chat.content,
      topics.map((t) => t.title)
    );
  } catch {
    await logAiUsage({
      userId,
      assessmentId: null,
      provider: chat.provider,
      model: chat.model,
      operation: 'generate_tos',
      tokensUsed: chat.tokensUsed,
      durationMs: chat.duration,
      status: 'error',
      errorCode: 'parse_error',
    });
    return { success: false, error: 'The AI returned an unreadable TOS proposal — try again.' };
  }

  await logAiUsage({
    userId,
    assessmentId: null,
    provider: chat.provider,
    model: chat.model,
    operation: 'generate_tos',
    tokensUsed: chat.tokensUsed,
    durationMs: chat.duration,
    status: 'success',
  });

  const validation = validateTos(rows, {
    countPerType,
    difficulty: input.difficultyDistribution,
    bloom: input.bloomDistribution,
  });
  return { success: true, rows, validation };
}

// ---------------------------------------------------------------------------
// AI Modification Assistant (scope §16)
// ---------------------------------------------------------------------------

export interface ProposeModificationResult {
  success: boolean;
  proposals?: ModifyProposal[];
  dropped?: DroppedProposal[];
  error?: string;
}

/**
 * Propose question modifications for an assessment (scope §16: "AI changes
 * SHALL be proposed, not silently committed"). Nothing is persisted here —
 * the faculty reviews the diff in the client and decides; `applyAssessment
 * Modifications` performs the accepted subset.
 */
export async function proposeAssessmentModifications(
  assessmentId: string,
  instruction: string
): Promise<ProposeModificationResult> {
  const { supabase, userId } = await requireUser();

  const assessment = await getFacultyAssessment(supabase, userId, assessmentId);
  if (!assessment) {
    return { success: false, error: 'Assessment not found or you are not assigned to its offering' };
  }
  if (!assessment.currentVersionId) return { success: false, error: 'No version found' };

  const trimmed = (instruction ?? '').trim();
  if (!trimmed) return { success: false, error: 'Describe what to change first.' };
  if (trimmed.length > 2000) {
    return { success: false, error: 'The instruction must be 2000 characters or fewer.' };
  }

  const { data: rows, error: qErr } = await supabase
    .from('questions')
    .select('id, position, question_type, question_text, difficulty, bloom_level, points, choices:question_choices(id, choice_key, choice_text, position), answer_keys(canonical_answer, accepted_answers, correct_choice_id)')
    .eq('assessment_version_id', assessment.currentVersionId)
    .order('position', { ascending: true });
  if (qErr) return { success: false, error: qErr.message };
  if (!rows || rows.length === 0) {
    return { success: false, error: 'This assessment has no questions yet.' };
  }

  if (!hasChatProvider()) {
    return { success: false, error: 'No AI provider configured — set GROQ_API_KEY or OPENAI_API_KEY.' };
  }

  const context: ModifyQuestionContext[] = rows.map((r) => {
    const keyRow = Array.isArray(r.answer_keys) ? r.answer_keys[0] : r.answer_keys;
    const correctId = keyRow?.correct_choice_id ?? null;
    return {
      id: r.id,
      position: r.position,
      question_type: r.question_type,
      question_text: r.question_text,
      difficulty: r.difficulty,
      bloom_level: r.bloom_level,
      points: r.points,
      choices: [...(r.choices ?? [])]
        .sort(
          (a: { position: number | null }, b: { position: number | null }) =>
            (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER)
        )
        .map((c: { id: string; choice_key: string; choice_text: string }) => ({
          choice_key: c.choice_key,
          choice_text: c.choice_text,
          correct: c.id === correctId,
        })),
      canonical_answer: keyRow?.canonical_answer ?? null,
    };
  });

  const validIds = context.map((q) => q.id);
  const currentTypes: Record<string, string> = Object.fromEntries(
    context.map((q) => [q.id, q.question_type])
  );

  const { system, user } = buildModifyPrompt({ questions: context, instruction: trimmed });

  let chat: Awaited<ReturnType<typeof chatCompletion>>;
  try {
    chat = await chatCompletion(system, user, { temperature: 0.2, maxTokens: 3000 });
  } catch (err) {
    await logAiUsage({
      userId,
      assessmentId,
      provider: activeChatProvider(),
      model: '-',
      operation: 'propose_modification',
      tokensUsed: 0,
      durationMs: 0,
      status: 'error',
      errorCode: err instanceof Error ? err.message.slice(0, 120) : 'unknown',
    });
    return { success: false, error: 'The AI provider could not be reached — try again.' };
  }

  let parsed: { proposals: ModifyProposal[]; dropped: DroppedProposal[] };
  try {
    parsed = parseModifyProposals(chat.content, validIds, currentTypes);
  } catch {
    await logAiUsage({
      userId,
      assessmentId,
      provider: chat.provider,
      model: chat.model,
      operation: 'propose_modification',
      tokensUsed: chat.tokensUsed,
      durationMs: chat.duration,
      status: 'error',
      errorCode: 'parse_error',
    });
    return { success: false, error: 'The AI returned an unreadable response — try again.' };
  }

  await logAiUsage({
    userId,
    assessmentId,
    provider: chat.provider,
    model: chat.model,
    operation: 'propose_modification',
    tokensUsed: chat.tokensUsed,
    durationMs: chat.duration,
    status: 'success',
  });

  return { success: true, proposals: parsed.proposals, dropped: parsed.dropped };
}

export interface ApplyModificationResult {
  success: boolean;
  createdVersion?: boolean;
  versionId?: string | null;
  appliedCount?: number;
  failed?: { op: string; question_id: string | null; error: string }[];
  error?: string;
}

/**
 * Apply the faculty-accepted subset of AI proposals (scope §16: "Faculty can
 * review diffs and accept/reject"; "Accepted material creates or contributes
 * to a new assessment version").
 *
 * Locked versions (published or deployed, scope §17: historical content must
 * not mutate once attempts exist) are handled by creating a new version
 * first — questions are deep-copied with new ids, so update/delete targets
 * are remapped through the preserved `position` of each question. The old
 * version is never touched.
 *
 * Every operation goes through the existing updateQuestion/addQuestion/
 * deleteQuestion actions, so their validation, locking, totals refresh, audit
 * entries and RLS all apply unchanged. A proposal that fails lands in
 * `failed` with its message; the rest still apply.
 */
export async function applyAssessmentModifications(
  assessmentId: string,
  accepted: ModifyProposal[]
): Promise<ApplyModificationResult> {
  const { supabase, userId } = await requireUser();

  if (!Array.isArray(accepted) || accepted.length === 0) {
    return { success: false, error: 'Select at least one proposal to apply.' };
  }
  if (accepted.length > 50) {
    return { success: false, error: 'At most 50 proposals can be applied at once.' };
  }

  const assessment = await getFacultyAssessment(supabase, userId, assessmentId);
  if (!assessment) {
    return { success: false, error: 'Assessment not found or you are not assigned to its offering' };
  }
  if (!assessment.currentVersionId) return { success: false, error: 'No version found' };

  let createdVersion = false;
  const idMap: Record<string, string> = {};

  const locked =
    assessment.status === 'published' ||
    (await isQuestionsLocked(supabase, assessment.currentVersionId));

  if (locked) {
    // Snapshot the old ids + positions, create the new version, then map
    // old → new through position (the copy preserves ordering).
    const { data: oldQuestions } = await supabase
      .from('questions')
      .select('id, position')
      .eq('assessment_version_id', assessment.currentVersionId);

    const newVersion = await createNewVersion(assessmentId);
    if (!newVersion.success || !newVersion.versionId) {
      return { success: false, error: newVersion.error ?? 'Could not create a new version' };
    }
    createdVersion = true;

    const { data: newQuestions } = await supabase
      .from('questions')
      .select('id, position')
      .eq('assessment_version_id', newVersion.versionId);
    const byPosition = new Map((newQuestions ?? []).map((q) => [q.position, q.id]));
    for (const old of oldQuestions ?? []) {
      const mapped = byPosition.get(old.position);
      if (mapped) idMap[old.id] = mapped;
    }
  }

  // The id allow-list: questions of the version we are about to modify,
  // plus their current accepted answers (identification updates that change
  // the canonical answer must not silently wipe alias answers).
  const { data: currentRow } = await supabase
    .from('assessments')
    .select('current_version_id')
    .eq('id', assessmentId)
    .single();
  const currentVersionId = currentRow?.current_version_id ?? null;
  const { data: currentQuestions } = await supabase
    .from('questions')
    .select('id, answer_keys(accepted_answers)')
    .eq('assessment_version_id', currentVersionId ?? '');
  const currentIds = new Set((currentQuestions ?? []).map((q) => q.id));
  const acceptedByQuestion = new Map<string, string[]>();
  for (const q of currentQuestions ?? []) {
    const keyRow = Array.isArray(q.answer_keys) ? q.answer_keys[0] : q.answer_keys;
    acceptedByQuestion.set(
      q.id,
      Array.isArray(keyRow?.accepted_answers) ? keyRow.accepted_answers : []
    );
  }

  const failed: { op: string; question_id: string | null; error: string }[] = [];
  let appliedCount = 0;

  for (const p of accepted) {
    try {
      if (p.op === 'add') {
        const fields: ModifyFields = p.fields ?? {};
        await addQuestion(assessmentId, {
          question_type: fields.question_type ?? 'multiple_choice',
          question_text: fields.question_text ?? '',
          difficulty: fields.difficulty ?? 'moderate',
          bloom_level: fields.bloom_level ?? 'understand',
          points: fields.points ?? 1,
          ...(fields.choices ? { choices: fields.choices } : {}),
          ...(fields.correct_choice_key ? { correct_choice_key: fields.correct_choice_key } : {}),
          ...(fields.canonical_answer !== undefined
            ? { canonical_answer: fields.canonical_answer }
            : {}),
          ...(fields.accepted_answers !== undefined
            ? { accepted_answers: fields.accepted_answers }
            : {}),
        });
      } else {
        const targetId = (p.question_id ? idMap[p.question_id] : null) ?? p.question_id;
        if (!targetId || !currentIds.has(targetId)) {
          throw new Error('Question is not in the current version');
        }
        if (p.op === 'delete') {
          await deleteQuestion(targetId);
        } else {
          const fields = p.fields ?? {};
          const payload: Record<string, unknown> = {};
          if (fields.question_text !== undefined) payload.question_text = fields.question_text;
          if (fields.difficulty !== undefined) payload.difficulty = fields.difficulty;
          if (fields.bloom_level !== undefined) payload.bloom_level = fields.bloom_level;
          if (fields.points !== undefined) payload.points = fields.points;
          if (fields.choices !== undefined) payload.choices = fields.choices;
          if (fields.correct_choice_key !== undefined) {
            payload.correct_choice_key = fields.correct_choice_key;
          }
          if (fields.canonical_answer !== undefined) {
            payload.canonical_answer = fields.canonical_answer;
            // updateQuestion rewrites the whole answer_keys row when
            // canonical_answer is present — carry the existing aliases along
            // unless the proposal replaced them explicitly.
            if (fields.accepted_answers !== undefined) {
              payload.accepted_answers = fields.accepted_answers;
            } else {
              payload.accepted_answers = acceptedByQuestion.get(targetId) ?? [];
            }
          }
          await updateQuestion(targetId, payload as Parameters<typeof updateQuestion>[1]);
        }
      }
      appliedCount += 1;
    } catch (err) {
      failed.push({
        op: p.op,
        question_id: p.question_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await recordAuditLog({
    actorUserId: userId,
    action: 'update',
    entityType: 'assessment',
    entityId: assessmentId,
    metadata: {
      kind: 'ai_modification_apply',
      applied: appliedCount,
      failed: failed.length,
      created_version: createdVersion,
    },
  });

  revalidateAssessment(assessment.subjectOfferingId, assessmentId);

  return {
    success: failed.length === 0,
    createdVersion,
    versionId: currentVersionId,
    appliedCount,
    failed,
  };
}

// ---------------------------------------------------------------------------
// Pre-exam quality dashboard (scope §31)
// ---------------------------------------------------------------------------

export interface PreExamQualityReport {
  question_count: number;
  /** Structural problems that make a question unanswerable/unscorable. */
  validation_issues: ValidationIssue[];
  /** Exact duplicate text groups within this version. */
  duplicates: DuplicateGroup[];
  /** Pairs at/above the configured similarity threshold (semantic). */
  semantic_flags: SimilarityFlag[];
  /** False when fewer than two questions carry embeddings. */
  semantic_available: boolean;
  embedded_count: number;
  /** Source-grounding coverage (questions with ≥1 linked source chunk). */
  grounding: GroundingCoverage;
  /** Approved TOS vs the actual questions, dimension by dimension. */
  tos: TosAlignment;
  distributions: {
    difficulty: DimensionCount[];
    bloom: DimensionCount[];
    types: DimensionCount[];
  };
  /** The configured thresholds these checks were run against. */
  thresholds: { similarity: number };
}

/**
 * Assembles the pre-exam half of the Assessment Quality Dashboard (§31):
 * "source-grounding coverage, TOS alignment, difficulty distribution, Bloom
 * distribution, exact duplicate count, semantic similarity flags, validation
 * issues". Read-only — nothing here blocks an assessment; it reports.
 */
export async function getPreExamQuality(
  assessmentId: string
): Promise<{ data?: PreExamQualityReport; error?: string }> {
  const { supabase, userId } = await requireUser();

  const assessment = await getFacultyAssessment(supabase, userId, assessmentId);
  if (!assessment) {
    return { error: 'Assessment not found or you are not assigned to its offering' };
  }
  if (!assessment.currentVersionId) return { error: 'No version found' };

  const versionId = assessment.currentVersionId;
  const settings = await getSettings();

  const { data: qRows, error: qErr } = await supabase
    .from('questions')
    .select('id, position, question_type, question_text, difficulty, bloom_level, points, topic:topics(title), question_choices(id), answer_keys(correct_choice_id, canonical_answer), question_sources(question_id)')
    .eq('assessment_version_id', versionId)
    .order('position', { ascending: true });
  if (qErr) return { error: qErr.message };

  // Embeddings are optional: if this role cannot read them the rest of the
  // report still renders (semantic_available flips to false).
  const embeddingById = new Map<string, number[]>();
  const { data: embRows, error: embErr } = await supabase
    .from('questions')
    .select('id, embedding')
    .eq('assessment_version_id', versionId);
  if (!embErr && embRows) {
    for (const row of embRows) {
      const parsed = parseEmbedding((row as { embedding: unknown }).embedding);
      if (parsed) embeddingById.set((row as { id: string }).id, parsed);
    }
  }

  const { data: version } = await supabase
    .from('assessment_versions')
    .select('tos_snapshot')
    .eq('id', versionId)
    .single();

  const questions: QualityQuestion[] = (qRows ?? []).map((r: Record<string, unknown>) => {
    const rawKey = r.answer_keys;
    const keyRow = Array.isArray(rawKey) ? rawKey[0] : rawKey;
    const rawTopic = r.topic as { title?: string } | { title?: string }[] | null;
    const topic = Array.isArray(rawTopic) ? rawTopic[0] : rawTopic;
    return {
      id: r.id as string,
      position: (r.position as number | null) ?? null,
      question_type: r.question_type as string,
      question_text: r.question_text as string,
      difficulty: r.difficulty as string,
      bloom_level: r.bloom_level as string,
      points: r.points as number,
      topic_title: topic?.title ?? null,
      choice_count: Array.isArray(r.question_choices) ? r.question_choices.length : 0,
      has_correct_choice: Boolean((keyRow as { correct_choice_id?: string } | null)?.correct_choice_id),
      has_canonical_answer: Boolean((keyRow as { canonical_answer?: string } | null)?.canonical_answer),
      grounded: Array.isArray(r.question_sources) && r.question_sources.length > 0,
      embedding: embeddingById.get(r.id as string) ?? null,
    };
  });

  const embeddedCount = questions.filter(q => q.embedding !== null).length;
  const snapshot = (version as { tos_snapshot?: unknown } | null)?.tos_snapshot;

  return {
    data: {
      question_count: questions.length,
      validation_issues: validateQualityQuestions(questions),
      duplicates: exactDuplicates(questions),
      semantic_flags: semanticSimilarityFlags(questions, settings.similarity_threshold),
      semantic_available: embeddedCount >= 2,
      embedded_count: embeddedCount,
      grounding: groundingCoverage(questions),
      tos: tosAlignment(snapshot as { rows?: TosRow[] } | null, questions),
      distributions: {
        difficulty: dimensionCounts(questions, 'difficulty'),
        bloom: dimensionCounts(questions, 'bloom_level'),
        types: dimensionCounts(questions, 'question_type'),
      },
      thresholds: { similarity: settings.similarity_threshold },
    },
  };
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
  const { supabase, userId } = await requireUser();

  const assessment = await getFacultyAssessment(supabase, userId, assessmentId);
  if (!assessment) throw new Error('Assessment not found or you are not assigned to its offering');

  const { data: job, error: jobErr } = await supabase
    .from('assessment_generation_jobs')
    .insert({
      assessment_id: assessmentId,
      requested_by: userId,
      operation: 'generate_questions',
      status: 'queued',
      input_config: config,
    })
    .select()
    .single();

  if (jobErr || !job) throw new Error(jobErr?.message || 'Failed to create generation job');

  await recordAuditLog({
    actorUserId: userId,
    action: 'create',
    entityType: 'assessment_generation_job',
    entityId: job.id,
    metadata: { assessment_id: assessmentId },
  });

  return job;
}

/**
 * Terminal transition for the generation job state machine: mark the batch
 * completed with its outcome summary. Best-effort by design — the wizard
 * calls it after a successful batch and swallows errors, so bookkeeping can
 * never fail a run that actually produced questions. Conditional on a
 * non-terminal status so a repeated call cannot regress `failed` back to
 * `completed`.
 */
export async function completeGenerationJob(
  jobId: string,
  summary: { generated: number; failed: number; requested: number }
): Promise<{ success: boolean; error?: string }> {
  const { supabase, userId } = await requireUser();
  if (typeof jobId !== 'string' || !jobId) return { success: false, error: 'jobId is required' };

  const { data, error } = await supabase
    .from('assessment_generation_jobs')
    .update({
      status: 'completed',
      result_metadata: {
        questions_generated: summary.generated,
        questions_failed: summary.failed,
        questions_requested: summary.requested,
      },
    })
    .eq('id', jobId)
    .eq('requested_by', userId)
    .in('status', ['queued', 'processing'])
    .select('id')
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return { success: false, error: 'Job not found or already finalized' };

  await recordAuditLog({
    actorUserId: userId,
    action: 'update',
    entityType: 'assessment_generation_job',
    entityId: jobId,
    metadata: { outcome: 'completed', ...summary },
  });
  return { success: true };
}

/**
 * Terminal transition for a batch that produced no usable questions: record
 * why it failed (surfaced by the faculty dashboard's failed-jobs query and
 * the generation-failure notification). Same non-terminal guard as
 * `completeGenerationJob` — whichever outcome lands first wins.
 */
export async function failGenerationJob(
  jobId: string,
  message: string
): Promise<{ success: boolean; error?: string }> {
  const { supabase, userId } = await requireUser();
  if (typeof jobId !== 'string' || !jobId) return { success: false, error: 'jobId is required' };

  const { data, error } = await supabase
    .from('assessment_generation_jobs')
    .update({
      status: 'failed',
      error_message: message.slice(0, 500),
    })
    .eq('id', jobId)
    .eq('requested_by', userId)
    .in('status', ['queued', 'processing'])
    .select('id')
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return { success: false, error: 'Job not found or already finalized' };

  await recordAuditLog({
    actorUserId: userId,
    action: 'update',
    entityType: 'assessment_generation_job',
    entityId: jobId,
    metadata: { outcome: 'failed', error: message.slice(0, 500) },
  });
  return { success: true };
}

// ---------------------------------------------------------------------------
// Version management
// ---------------------------------------------------------------------------

