import { createAdminClient } from '@/lib/supabase/admin';
import { DEFAULT_SIMILARITY_THRESHOLD } from '@/lib/constants';

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have the same length');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

export interface SimilarQuestion {
  id: string;
  question_text: string;
  similarity: number;
}

export function findSimilarQuestions(
  newEmbedding: number[],
  existingQuestions: { id: string; question_text: string; embedding: number[] }[],
  threshold: number = DEFAULT_SIMILARITY_THRESHOLD
): SimilarQuestion[] {
  const results: SimilarQuestion[] = [];

  for (const question of existingQuestions) {
    const similarity = cosineSimilarity(newEmbedding, question.embedding);
    if (similarity >= threshold) {
      results.push({
        id: question.id,
        question_text: question.question_text,
        similarity,
      });
    }
  }

  return results.sort((a, b) => b.similarity - a.similarity);
}

export async function detectDuplicateWithinAssessment(
  newText: string,
  assessmentId: string,
  newEmbedding: number[],
  threshold: number = DEFAULT_SIMILARITY_THRESHOLD
): Promise<{ isDuplicate: boolean; similarQuestion?: SimilarQuestion }> {
  const supabase = createAdminClient();

  const { data: questions, error } = await supabase
    .from('questions')
    .select('id, question_text, embedding')
    .eq('assessment_version_id', assessmentId);

  if (error) {
    throw new Error(`Failed to fetch questions: ${error.message}`);
  }

  if (!questions || questions.length === 0) {
    return { isDuplicate: false };
  }

  const typedQuestions = questions as { id: string; question_text: string; embedding: number[] }[];
  const similar = findSimilarQuestions(newEmbedding, typedQuestions, threshold);

  if (similar.length > 0) {
    return {
      isDuplicate: true,
      similarQuestion: similar[0],
    };
  }

  return { isDuplicate: false };
}

export async function findSimilarInQuestionBank(
  newEmbedding: number[],
  subjectId: string,
  threshold: number = DEFAULT_SIMILARITY_THRESHOLD
): Promise<SimilarQuestion[]> {
  const supabase = createAdminClient();

  const { data: questions, error } = await supabase
    .from('questions')
    .select('id, question_text, embedding')
    .not('embedding', 'is', null);

  if (error) {
    throw new Error(`Failed to fetch questions: ${error.message}`);
  }

  if (!questions || questions.length === 0) {
    return [];
  }

  const typedQuestions = questions as { id: string; question_text: string; embedding: number[] }[];
  return findSimilarQuestions(newEmbedding, typedQuestions, threshold);
}
