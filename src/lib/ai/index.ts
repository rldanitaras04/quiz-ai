import { createAdminClient } from '@/lib/supabase/admin';
import type {
  GenerateQuestionsParams,
  GenerationResult,
  EmbeddingResult,
  SimilarityCheckResult,
} from '@/lib/ai/types';
import { generateQuestions as groqGenerate, generateEmbedding as groqEmbedding } from '@/lib/ai/providers/groq';
import { generateQuestions as openaiGenerate, generateEmbedding as openaiEmbedding } from '@/lib/ai/providers/openai';
import { chunkText, extractText } from '@/lib/ai/text-extraction';
import { cosineSimilarity, findSimilarQuestions, detectDuplicateWithinAssessment } from '@/lib/ai/similarity';
import { DEFAULT_SIMILARITY_THRESHOLD } from '@/lib/constants';

type Provider = 'groq' | 'openai';

function getProvider(provider?: Provider) {
  const selected = provider || (process.env.GROQ_API_KEY ? 'groq' : 'openai');

  return {
    name: selected,
    generateQuestions: selected === 'groq' ? groqGenerate : openaiGenerate,
    generateEmbedding: selected === 'groq' ? groqEmbedding : openaiEmbedding,
  };
}

export async function generateQuestions(
  params: GenerateQuestionsParams,
  provider?: Provider
): Promise<GenerationResult> {
  const p = getProvider(provider);
  return p.generateQuestions(params);
}

export async function generateEmbedding(text: string, provider?: Provider): Promise<EmbeddingResult> {
  const p = getProvider(provider);
  return p.generateEmbedding(text);
}

export async function generateEmbeddings(
  texts: string[],
  provider?: Provider
): Promise<EmbeddingResult[]> {
  const results: EmbeddingResult[] = [];
  for (const text of texts) {
    const result = await generateEmbedding(text, provider);
    results.push(result);
  }
  return results;
}

export async function checkSimilarity(
  questionText: string,
  existingEmbeddings: { id: string; question_text: string; embedding: number[] }[],
  threshold: number = DEFAULT_SIMILARITY_THRESHOLD
): Promise<SimilarityCheckResult> {
  const { embedding } = await generateEmbedding(questionText);

  const similar = findSimilarQuestions(embedding, existingEmbeddings, threshold);

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
export type { Provider };
