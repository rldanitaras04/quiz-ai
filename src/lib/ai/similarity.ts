import { DEFAULT_SIMILARITY_THRESHOLD } from '@/lib/constants';
import { cosineSimilarity } from '@/lib/ai/duplicate-check';

export { cosineSimilarity, normalizeQuestionText, scoreAgainstExisting } from '@/lib/ai/duplicate-check';
export type { ExistingQuestionRef, CandidateScore } from '@/lib/ai/duplicate-check';

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
