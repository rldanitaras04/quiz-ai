import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateQuestions } from '@/lib/ai';
import { logAiUsage } from '@/lib/ai/logger';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
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
    } = body;

    // Validate input
    if (!topic || !questionType || !count || !difficulty || !bloomLevel) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (count < 1 || count > 50) {
      return NextResponse.json({ error: 'Count must be between 1 and 50' }, { status: 400 });
    }

    // Fetch source chunks
    let sourceTexts: string[] = [];
    if (sourceChunkIds && sourceChunkIds.length > 0) {
      const { data: chunks, error: chunkError } = await supabase
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
