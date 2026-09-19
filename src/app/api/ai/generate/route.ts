import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { generateQuestions } from '@/lib/ai';
import { logAiUsage } from '@/lib/ai/logger';

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

    // Fetch source chunks via the user's session client: RLS limits chunk
    // reads to materials in offerings the faculty is assigned to, so chunk
    // IDs from other offerings are filtered out here rather than trusted.
    let sourceTexts: string[] = [];
    if (sourceChunkIds && sourceChunkIds.length > 0) {
      const { data: chunks, error: chunkError } = await sessionClient
        .from('source_chunks')
        .select('content')
        .in('id', sourceChunkIds);

      if (chunkError) {
        return NextResponse.json({ error: 'Failed to fetch source chunks' }, { status: 500 });
      }

      sourceTexts = chunks?.map((c) => c.content) || [];
    }

    if (sourceTexts.length === 0) {
      return NextResponse.json({ error: 'No source material provided' }, { status: 400 });
    }

    // Generate questions
    const result = await generateQuestions({
      sourceTexts,
      topic,
      questionType,
      count,
      difficulty,
      bloomLevel,
      customInstructions,
    });

    // Log AI usage
    await logAiUsage({
      userId: user.id,
      assessmentId: assessmentId || null,
      provider: result.provider,
      model: result.model,
      operation: 'generate_questions',
      tokensUsed: result.tokensUsed,
      durationMs: result.duration,
      status: 'success',
    });

    return NextResponse.json({
      questions: result.questions,
      metadata: {
        provider: result.provider,
        model: result.model,
        tokensUsed: result.tokensUsed,
        duration: result.duration,
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
