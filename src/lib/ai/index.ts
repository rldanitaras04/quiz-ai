import { createAdminClient } from '@/lib/supabase/admin';
import type {
  GenerateQuestionsParams,
  GenerationResult,
  EmbeddingResult,
  SimilarityCheckResult,
} from '@/lib/ai/types';
import { generateQuestions as groqGenerate } from '@/lib/ai/providers/groq';
import { generateQuestions as openaiGenerate, generateEmbedding as openaiEmbedding } from '@/lib/ai/providers/openai';
import { generateEmbedding as hfEmbedding } from '@/lib/ai/providers/huggingface';
import { chunkText, extractText } from '@/lib/ai/text-extraction';
import { cosineSimilarity, findSimilarQuestions, detectDuplicateWithinAssessment } from '@/lib/ai/similarity';
import { getSettings } from '@/lib/settings';

type ChatProvider = 'groq' | 'openai';

function getChatProvider(provider?: ChatProvider) {
  const selected = provider || (process.env.GROQ_API_KEY ? 'groq' : 'openai');

  return {
    name: selected,
    generateQuestions: selected === 'groq' ? groqGenerate : openaiGenerate,
  };
}

// Prefer HuggingFace (free), fall back to OpenAI for embeddings
async function getEmbeddingProvider() {
  if (process.env.HUGGINGFACE_API_KEY) {
    return { name: 'huggingface', generateEmbedding: hfEmbedding };
  }
  if (process.env.OPENAI_API_KEY) {
    return { name: 'openai', generateEmbedding: openaiEmbedding };
  }
  throw new Error('No embedding provider configured. Set HUGGINGFACE_API_KEY or OPENAI_API_KEY.');
}

export async function generateQuestions(
  params: GenerateQuestionsParams,
  provider?: ChatProvider
): Promise<GenerationResult> {
  const p = getChatProvider(provider);
  return p.generateQuestions(params);
}

export async function generateEmbedding(text: string): Promise<EmbeddingResult> {
  const p = await getEmbeddingProvider();
  return p.generateEmbedding(text);
}

export async function generateEmbeddings(texts: string[]): Promise<EmbeddingResult[]> {
  const results: EmbeddingResult[] = [];
  for (const text of texts) {
    const result = await generateEmbedding(text);
    results.push(result);
  }
  return results;
}

/**
 * Duplicate check for a single question. The threshold defaults to the
 * administrator-configured value (/admin/settings) so the similarity rule can be
 * tuned without a redeploy; callers may still override it per call.
 */
export async function checkSimilarity(
  questionText: string,
  existingEmbeddings: { id: string; question_text: string; embedding: number[] }[],
  threshold?: number
): Promise<SimilarityCheckResult> {
  const effectiveThreshold = threshold ?? (await getSettings()).similarity_threshold;
  const { embedding } = await generateEmbedding(questionText);

  const similar = findSimilarQuestions(embedding, existingEmbeddings, effectiveThreshold);

  if (similar.length > 0) {
    return {
      isDuplicate: true,
      similarityScore: similar[0].similarity,
      similarQuestionId: similar[0].id,
      similarQuestionText: similar[0].question_text,
    };
  }

  return {
    isDuplicate: false,
    similarityScore: 0,
  };
}

export async function extractTextFromFile(
  buffer: Buffer,
  mimeType: string
): Promise<string> {
  return extractText(buffer, mimeType);
}

export async function extractAndStoreSource(
  sourceMaterialId: string,
  buffer: Buffer,
  mimeType: string
): Promise<{ chunkCount: number; embeddingsGenerated: number }> {
  const supabase = createAdminClient();

  // Update status to processing
  await supabase
    .from('source_materials')
    .update({ processing_status: 'processing' })
    .eq('id', sourceMaterialId);

  try {
    // Extract text
    const rawText = await extractText(buffer, mimeType);

    // Update raw_text
    await supabase
      .from('source_materials')
      .update({ raw_text: rawText })
      .eq('id', sourceMaterialId);

    // Chunk text
    const chunks = chunkText(rawText);

    // Generate embeddings and store chunks
    let embeddingsGenerated = 0;
    for (let i = 0; i < chunks.length; i++) {
      const { embedding, tokensUsed } = await generateEmbedding(chunks[i]);

      await supabase.from('source_chunks').insert({
        source_material_id: sourceMaterialId,
        chunk_index: i,
        content: chunks[i],
        token_count: tokensUsed,
        embedding,
        metadata: {},
      });

      embeddingsGenerated++;
    }

    // Update status to ready
    await supabase
      .from('source_materials')
      .update({ processing_status: 'ready' })
      .eq('id', sourceMaterialId);

    return { chunkCount: chunks.length, embeddingsGenerated };
  } catch (error) {
    await supabase
      .from('source_materials')
      .update({
        processing_status: 'failed',
        processing_error: error instanceof Error ? error.message : 'Unknown error',
      })
      .eq('id', sourceMaterialId);

    throw error;
  }
}

export { cosineSimilarity, findSimilarQuestions, detectDuplicateWithinAssessment };
