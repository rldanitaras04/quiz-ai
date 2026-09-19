import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { generateEmbedding } from '@/lib/ai';

const MAX_EMBEDDING_CHARS = 24_000; // ~6k tokens of input per request
const RATE_LIMIT_REQUESTS = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= RATE_LIMIT_REQUESTS;
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

    if (!checkRateLimit(user.id)) {
      return NextResponse.json({ error: 'Too many requests. Try again shortly.' }, { status: 429 });
    }

    // Only faculty (or admins) may generate embeddings.
    const { data: roles } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);

    const isFaculty = roles?.some((r) => r.role === 'faculty' || r.role === 'super_admin');
    if (!isFaculty) {
      return NextResponse.json({ error: 'Forbidden: Faculty access required' }, { status: 403 });
    }

    const body = await request.json();
    const { text, sourceMaterialId, chunkIndex, contentType } = body;

    if (!text && !sourceMaterialId) {
      return NextResponse.json(
        { error: 'Either text or sourceMaterialId is required' },
        { status: 400 }
      );
    }

    if (typeof text === 'string' && text.length > MAX_EMBEDDING_CHARS) {
      return NextResponse.json(
        { error: `Text too large. Maximum ${MAX_EMBEDDING_CHARS} characters per request.` },
        { status: 413 }
      );
    }

    let inputText = text;

    // If sourceMaterialId provided, fetch raw_text
    if (sourceMaterialId && !text) {
      const { data: source, error: sourceError } = await supabase
        .from('source_materials')
        .select('raw_text, subject_offering_id')
        .eq('id', sourceMaterialId)
        .single();

      if (sourceError || !source?.raw_text) {
        return NextResponse.json(
          { error: 'Source material not found or has no text' },
          { status: 404 }
        );
      }

      // Faculty may only embed materials from offerings they are assigned to.
      const { data: assignment } = await supabase
        .from('faculty_assignments')
        .select('id')
        .eq('subject_offering_id', source.subject_offering_id)
        .eq('faculty_id', user.id)
        .maybeSingle();

      if (!assignment) {
        return NextResponse.json(
          { error: 'Forbidden: not assigned to this subject offering' },
          { status: 403 }
        );
      }

      inputText = source.raw_text;
    }

    // Generate embedding
    const result = await generateEmbedding(inputText);

    // Optionally store in source_chunks
    if (sourceMaterialId && contentType === 'source_chunk') {
      const { error: insertError } = await supabase.from('source_chunks').insert({
        source_material_id: sourceMaterialId,
        chunk_index: chunkIndex || 0,
        content: inputText,
        token_count: result.tokensUsed,
        embedding: result.embedding,
        metadata: {},
      });

      if (insertError) {
        console.error('Failed to store embedding:', insertError);
      }
    }

    return NextResponse.json({
      embedding: result.embedding,
      tokensUsed: result.tokensUsed,
    });
  } catch (error) {
    console.error('Embedding generation error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
