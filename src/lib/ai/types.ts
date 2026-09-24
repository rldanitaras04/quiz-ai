export interface AIProvider {
  name: string;
  model: string;
}

export interface GenerateQuestionsParams {
  sourceTexts: string[];
  topic: string;
  questionType: 'multiple_choice' | 'identification' | 'true_false';
  count: number;
  difficulty: 'easy' | 'moderate' | 'difficult' | 'mixed';
  bloomLevel: string;
  customInstructions?: string;
}

export interface GeneratedQuestion {
  questionText: string;
  questionType: 'multiple_choice' | 'identification' | 'true_false';
  difficulty: string;
  bloomLevel: string;
  points: number;
  choices?: { key: string; text: string; isCorrect: boolean }[];
  canonicalAnswer?: string;
  sourceChunkIds?: string[];
}

export interface GenerationResult {
  questions: GeneratedQuestion[];
  provider: string;
  model: string;
  tokensUsed: number;
  duration: number;
}

export interface SimilarityCheckResult {
  isDuplicate: boolean;
  similarityScore: number;
  similarQuestionId?: string;
  similarQuestionText?: string;
}

export interface EmbeddingResult {
  embedding: number[];
  tokensUsed: number;
}
