import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkSimilarity, generateEmbedding, generateQuestions } from '@/lib/ai';
import { logAiUsage } from '@/lib/ai/logger';
import { getSettings } from '@/lib/settings';
import type { GenerateQuestionsParams, QuestionValidation } from '@/lib/ai/types';
import { parseEmbedding, type ExistingQuestionRef } from '@/lib/ai/duplicate-check';

// Simple per-user rate limit: 60 generation requests / 10 minutes.
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 60;
const rateBuckets = new Map<string, number[]>();

function isRateLimited(userId: string): boolean {
  const now = Date.now();
  const bucket = (rateBuckets.get(userId) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  bucket.push(now);
  rateBuckets.set(userId, bucket);
  return bucket.length > RATE_LIMIT_MAX;
}

/** How many chunks the prompt gets: vector top-k for large materials. */
const RETRIEVAL_CHUNK_LIMIT = 10;
/** Chunks below this cosine similarity are treated as unrelated to the topic. */
const MIN_RETRIEVAL_SIMILARITY = 0.1;
/** Existing stored rows (in-assessment questions and question-bank items) we
 * embed on the fly so semantic checking covers rows saved before generation
 * stored embeddings (bounded per call, persisted for next time). */
const EMBED_BACKFILL_LIMIT = 25;
/** Initial generation plus this many regenerations of rejected items
 * (scope §13: rejected items are regenerated, not dropped). */
const MAX_GENERATION_ROUNDS = 3;
/** Recorded in questions.generation_metadata whenever the prompt changes. */
const PROMPT_VERSION = 'v2-retrieval-chunk-citation';

interface RetrievedChunk {
  id: string;
  content: string;
}

export async function POST(request: NextRequest) {
  // Service-role client is created per-request (never at module scope) so
  // page-data collection during `next build` succeeds without env vars.
  const supabase = createAdminClient();

  try {
    // Authenticate user
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.split(' ')[1];
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check faculty role
    const { data: roles } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);

    const isFaculty = roles?.some((r) => r.role === 'faculty' || r.role === 'super_admin');
    if (!isFaculty) {
      return NextResponse.json({ error: 'Forbidden: Faculty access required' }, { status: 403 });
    }

    const body = await request.json();
    const {
      sourceChunkIds,
      sourceMaterialIds: requestedMaterialIds,
      topic,
      questionType,
      count,
      difficulty,
      bloomLevel,
      customInstructions,
      assessmentId,
      offeringId,
    } = body;

    // Validate input
    if (!topic || !questionType || !count || !difficulty || !bloomLevel) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (count < 1 || count > 50) {
      return NextResponse.json({ error: 'Count must be between 1 and 50' }, { status: 400 });
    }

    if (isRateLimited(user.id)) {
      return NextResponse.json({ error: 'Rate limit exceeded. Try again later.' }, { status: 429 });
    }

    // Ownership: the caller's session client is used to verify the faculty
    // member is assigned to the offering (RLS scopes this to their own
    // assignments). If offered, also verify the assessment belongs to it.
    const sessionClient = await createClient();
    const { data: assignment } = await sessionClient
      .from('faculty_assignments')
      .select('id')
      .eq('faculty_id', user.id)
      .eq('subject_offering_id', offeringId ?? '')
      .single();

    if (!assignment) {
      return NextResponse.json({ error: 'Forbidden: not assigned to this offering' }, { status: 403 });
    }

    if (assessmentId) {
      const { data: assessment } = await sessionClient
        .from('assessments')
        .select('id')
        .eq('id', assessmentId)
        .eq('subject_offering_id', offeringId)
        .single();

      if (!assessment) {
        return NextResponse.json({ error: 'Assessment not found in this offering' }, { status: 403 });
      }
    }

    // ---- Authorized source set (scope §11: retrieval must be filtered) ---
    // Both reads go through the session client: RLS plus the assignment
    // check above decide which materials/chunks may feed generation, so the
    // vector search can never reach outside the caller's offerings.
    let materialIds: string[] = [];
    if (Array.isArray(requestedMaterialIds) && requestedMaterialIds.length > 0) {
      const { data: materials, error: materialsError } = await sessionClient
        .from('source_materials')
        .select('id')
        .eq('subject_offering_id', offeringId ?? '')
        .in('id', requestedMaterialIds.map(String));

      if (materialsError) {
        return NextResponse.json({ error: 'Failed to fetch source materials' }, { status: 500 });
      }
      materialIds = (materials ?? []).map((m) => m.id as string);
    } else if (Array.isArray(sourceChunkIds) && sourceChunkIds.length > 0) {
      const { data: chunks, error: chunksError } = await sessionClient
        .from('source_chunks')
        .select('id, source_material_id')
        .in('id', sourceChunkIds.map(String));

      if (chunksError) {
        return NextResponse.json({ error: 'Failed to fetch source chunks' }, { status: 500 });
      }
      materialIds = [...new Set((chunks ?? []).map((c) => c.source_material_id as string))];
    }

    if (materialIds.length === 0) {
      return NextResponse.json({ error: 'No source material provided' }, { status: 400 });
    }

    // ---- Vector retrieval (scope §11) ------------------------------------
    // Embed the request, then take the chunks of the authorized materials
    // that actually match it — instead of stuffing every chunk of every
    // selected material into the prompt.
    let sourceChunks: RetrievedChunk[] = [];
    let retrievalMode: 'vector' | 'first_chunks' = 'vector';

    try {
      const queryText = [
        `Topic: ${topic}`,
        `Question type: ${questionType}`,
        `Bloom's taxonomy level: ${bloomLevel}`,
        `Difficulty: ${difficulty}`,
        customInstructions ? `Faculty instructions: ${customInstructions}` : null,
      ]
        .filter(Boolean)
        .join('. ');

      const { embedding } = await generateEmbedding(queryText);
      const { data: matches, error: matchError } = await supabase.rpc('match_source_chunks', {
        p_query_embedding: embedding,
        p_source_material_ids: materialIds,
        p_match_count: RETRIEVAL_CHUNK_LIMIT,
        p_min_similarity: MIN_RETRIEVAL_SIMILARITY,
      });
      if (matchError) throw new Error(matchError.message);

      sourceChunks = ((matches ?? []) as RetrievedChunk[]).map((m) => ({
        id: m.id,
        content: m.content,
      }));
    } catch (error) {
      console.warn('Vector retrieval unavailable; falling back to bounded chunk read:', error);
    }

    if (sourceChunks.length === 0) {
      // Embedding provider down, nothing above the similarity floor, or the
      // function missing on an older database: bounded fallback to the first
      // chunks of the authorized materials so generation still runs.
      retrievalMode = 'first_chunks';
      const { data: chunks, error: fallbackError } = await sessionClient
        .from('source_chunks')
        .select('id, content')
        .in('source_material_id', materialIds)
        .order('chunk_index', { ascending: true })
        .limit(RETRIEVAL_CHUNK_LIMIT);

      if (fallbackError) {
        return NextResponse.json({ error: 'Failed to fetch source chunks' }, { status: 500 });
      }
      sourceChunks = (chunks ?? []) as RetrievedChunk[];
    }

    if (sourceChunks.length === 0) {
      return NextResponse.json({ error: 'No source material provided' }, { status: 400 });
    }

    // ---- Existing items for the duplicate gate (scope §13) ---------------
    const existing: ExistingQuestionRef[] = [];

    if (assessmentId) {
      const { data: versions, error: versionsError } = await supabase
        .from('assessment_versions')
        .select('id')
        .eq('assessment_id', assessmentId);

      if (versionsError) {
        return NextResponse.json({ error: 'Failed to load existing questions' }, { status: 500 });
      }

      const versionIds = (versions ?? []).map((v) => v.id as string);
      if (versionIds.length > 0) {
        const { data: rows, error: questionsError } = await supabase
          .from('questions')
          .select('id, question_text, embedding')
          .in('assessment_version_id', versionIds);

        if (questionsError) {
          return NextResponse.json({ error: 'Failed to load existing questions' }, { status: 500 });
        }

        for (const row of rows ?? []) {
          existing.push({
            id: row.id as string,
            question_text: row.question_text as string,
            embedding: parseEmbedding(row.embedding),
            origin: 'assessment',
          });
        }
      }
    }

    // Question-bank items for the offering's subject (scope §13: "and, where
    // configured, against relevant question-bank items"). Bank rows carry
    // embeddings in the same vector space as everything else (migration
    // 20261009000000), so they join the semantic check as well as the exact
    // one; a read failure degrades to the in-assessment check instead of
    // blocking.
    const { data: offeringRow } = await sessionClient
      .from('subject_offerings')
      .select('subject_id')
      .eq('id', offeringId ?? '')
      .single();

    if (offeringRow) {
      const { data: bankRows, error: bankError } = await supabase
        .from('question_bank')
        .select('id, question_text, embedding')
        .eq('subject_id', offeringRow.subject_id)
        .eq('status', 'active');

      if (bankError) {
        console.warn('Question bank unavailable for duplicate check:', bankError.message);
      }
      for (const row of bankRows ?? []) {
        existing.push({
          id: row.id as string,
          question_text: row.question_text as string,
          embedding: parseEmbedding(row.embedding),
          origin: 'bank',
        });
      }
    }

    // Semantic checking needs embeddings on stored rows; items saved before
    // the embedding flow existed (in-assessment or bank) have none. Backfill
    // a bounded number per call (and persist) so later runs start from a warm
    // set — the write target depends on where the row came from.
    let backfilled = 0;
    for (const entry of existing) {
      if (entry.origin !== 'assessment' && entry.origin !== 'bank') continue;
      if (entry.embedding !== null) continue;
      if (backfilled >= EMBED_BACKFILL_LIMIT) break;
      try {
        const { embedding } = await generateEmbedding(entry.question_text);
        entry.embedding = embedding;
        backfilled += 1;
        if (entry.id) {
          const table = entry.origin === 'bank' ? 'question_bank' : 'questions';
          await supabase.from(table).update({ embedding }).eq('id', entry.id);
        }
      } catch (error) {
        console.warn('Could not backfill question embedding; continuing exact-match only:', error);
        break;
      }
    }

    // ---- Generate, gate, regenerate (scope §13/§14) ----------------------
    const settings = await getSettings();
    const threshold = settings.similarity_threshold;

    const generationParams: GenerateQuestionsParams = {
      sourceChunks,
      sourceTexts: sourceChunks.map((c) => c.content),
      topic,
      questionType,
      count,
      difficulty,
      bloomLevel,
      customInstructions,
    };

    const first = await generateQuestions(generationParams);
    const questions = first.questions;
    let provider = first.provider;
    let model = first.model;
    let tokensUsed = first.tokensUsed;
    let duration = first.duration;

    const attempts = questions.map(() => 1);
    const avoidTexts: string[] = [];
    let round = 0;

    for (;;) {
      round += 1;
      const rejectedSlots: number[] = [];

      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        if (q.validation?.passed) continue; // accepted earlier, still accepted

        const text = q.questionText ?? '';
        const result = await checkSimilarity(text, existing, threshold);

        const empty = text.trim().length === 0;
        const passed = !empty && !result.isDuplicate;
        const reason = empty
          ? 'empty_text'
          : result.exactDuplicate
            ? 'exact_duplicate'
            : result.isDuplicate
              ? 'semantic_duplicate'
              : undefined;

        const validation: QuestionValidation = { passed, attempts: attempts[i] };
        if (reason) validation.reason = reason;
        if (result.exactDuplicate && result.similarQuestionText) {
          validation.exactDuplicateOf = result.similarQuestionText;
        }
        if (result.similarQuestionId) validation.similarQuestionId = result.similarQuestionId;
        if (result.similarQuestionText) validation.similarQuestionText = result.similarQuestionText;
        if (result.similarQuestionSource) validation.similarQuestionSource = result.similarQuestionSource;
        if (!result.exactDuplicate && result.similarityScore > 0) {
          validation.maxSimilarity = result.similarityScore;
        }
        q.validation = validation;
        q.embedding = result.embedding ?? undefined;

        if (passed) {
          // Accepted batch mates count against the candidates that follow.
          existing.push({
            id: `batch-${i}`,
            question_text: text,
            embedding: result.embedding ?? null,
            origin: 'batch',
          });
        } else {
          rejectedSlots.push(i);
        }
      }

      if (rejectedSlots.length === 0 || round >= MAX_GENERATION_ROUNDS) break;

      // Regenerate only the rejected items, told what not to repeat.
      for (const slot of rejectedSlots) {
        const text = questions[slot].questionText?.trim();
        if (text && !avoidTexts.includes(text)) avoidTexts.push(text);
      }
      const retry = await generateQuestions({
        ...generationParams,
        count: rejectedSlots.length,
        avoidQuestionTexts: avoidTexts,
      });
      provider = retry.provider;
      model = retry.model;
      tokensUsed += retry.tokensUsed;
      duration += retry.duration;

      rejectedSlots.forEach((slot, j) => {
        const fresh = retry.questions[j];
        if (!fresh) return; // model returned fewer items; slot stays flagged
        questions[slot] = fresh;
        attempts[slot] += 1;
      });
    }

    // ---- Provenance + stored validation metadata (scope §12/§13) ---------
    const allowedChunkIds = new Set(sourceChunks.map((c) => c.id));
    const contextChunkIds = sourceChunks.map((c) => c.id);

    const payloadQuestions = questions.map((q) => {
      const cited = (q.sourceChunkIds ?? []).filter((id) => allowedChunkIds.has(id));
      return {
        ...q,
        // Cited chunks when the model answered, else the retrieved context it
        // was grounded in — either way the item is traceable to source text.
        sourceChunkIds: cited.length > 0 ? cited : contextChunkIds,
        generation_metadata: {
          provider,
          model,
          prompt_version: PROMPT_VERSION,
          generated_at: new Date().toISOString(),
          retrieval: { mode: retrievalMode, chunk_count: sourceChunks.length },
          provenance: cited.length > 0 ? 'model_citation' : 'retrieved_context',
          cited_chunk_ids: cited,
          similarity_threshold: threshold,
          validation: q.validation ?? { passed: true, attempts: 1 },
        },
      };
    });

    const flagged = payloadQuestions.filter((q) => !q.validation?.passed).length;

    // Log AI usage
    await logAiUsage({
      userId: user.id,
      assessmentId: assessmentId || null,
      provider,
      model,
      operation: 'generate_questions',
      tokensUsed,
      durationMs: duration,
      status: 'success',
    });

    return NextResponse.json({
      questions: payloadQuestions,
      metadata: {
        provider,
        model,
        tokensUsed,
        duration,
        retrieval: { mode: retrievalMode, chunk_count: sourceChunks.length },
        similarity: { threshold, flagged, rounds: round },
      },
    });
  } catch (error) {
    console.error('Question generation error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
