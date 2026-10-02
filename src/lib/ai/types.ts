export interface AIProvider {
  name: string;
  model: string;
}

export interface GenerateQuestionsParams {
  sourceTexts: string[];
  /**
   * Retrieved/selected source chunks. When present the prompt labels each one
   * with `[chunk:<id>]` and asks the model to cite the chunks it used — the
   * provenance record (scope §12) comes from that answer.
   */
  sourceChunks?: { id: string; content: string }[];
  topic: string;
  questionType: 'multiple_choice' | 'identification' | 'true_false';
  count: number;
  difficulty: 'easy' | 'moderate' | 'difficult' | 'mixed';
  bloomLevel: string;
  customInstructions?: string;
  /**
   * Question texts rejected as duplicates on an earlier generation round.
   * The model must test a different fact instead of rephrasing them (the
   * regenerate step of scope §13).
   */
  avoidQuestionTexts?: string[];
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
  /** Set by the generate route after the duplicate gate ran (scope §13). */
  validation?: QuestionValidation;
  /** Candidate embedding, ready to persist so the next check skips the
   * embedding call (scope §13 "validation results must be stored"). */
  embedding?: number[];
  /** Persisted to questions.generation_metadata — provenance per scope §12
   * (provider, model, prompt version, retrieval mode, validation outcome). */
  generation_metadata?: Record<string, unknown> | null;
}

/** Per-question outcome of the duplicate/quality gate (scope §13/§14). */
export interface QuestionValidation {
  /**
   * false once every generation round is spent: the item is returned flagged
   * for faculty review rather than silently dropped.
   */
  passed: boolean;
  /** How many times this item was (re)generated — 1 means first try. */
  attempts: number;
  reason?: 'exact_duplicate' | 'semantic_duplicate' | 'empty_text';
  exactDuplicateOf?: string;
  maxSimilarity?: number;
  similarQuestionId?: string;
  similarQuestionText?: string;
  similarQuestionSource?: 'assessment' | 'batch' | 'bank';
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
  /** Highest cosine similarity found; 0 when none (or exact-only path). */
  similarityScore: number;
  /** true when the normalized text matched an existing question exactly. */
  exactDuplicate: boolean;
  similarQuestionId?: string;
  similarQuestionText?: string;
  similarQuestionSource?: 'assessment' | 'batch' | 'bank';
  /**
   * The candidate's own embedding — callers persist it so later checks skip
   * the embedding call. null when no embedding provider was reachable (the
   * exact-match step still ran).
   */
  embedding: number[] | null;
}

export interface EmbeddingResult {
  embedding: number[];
  tokensUsed: number;
}
