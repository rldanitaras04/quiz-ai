import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateEmbedding } from '@/lib/ai';

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

    const body = await request.json();
    const { text, sourceMaterialId, chunkIndex, contentType } = body;

    if (!text && !sourceMaterialId) {
      return NextResponse.json(
        { error: 'Either text or sourceMaterialId is required' },
        { status: 400 }
      );
    }

    let inputText = text;

    // If sourceMaterialId provided, fetch raw_text
    if (sourceMaterialId && !text) {
      const { data: source, error: sourceError } = await supabase
        .from('source_materials')
        .select('raw_text')
        .eq('id', sourceMaterialId)
        .single();

      if (sourceError || !source?.raw_text) {
        return NextResponse.json(
          { error: 'Source material not found or has no text' },
          { status: 404 }
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
