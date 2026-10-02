import OpenAI from 'openai';
import { buildQuestionPrompt } from '@/lib/ai/prompt';
import type {
  GenerateQuestionsParams,
  GenerationResult,
  GeneratedQuestion,
  EmbeddingResult,
} from '@/lib/ai/types';

// Lazily constructed: instantiating at module scope crashes `next build`
// (page-data collection) whenever the API key is not configured.
let openaiInstance: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openaiInstance) {
    openaiInstance = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return openaiInstance;
}

const OPENAI_MODEL = 'gpt-4o';
const EMBEDDING_MODEL = 'text-embedding-3-small';

function buildEmbeddingPrompt(text: string): string {
  return text;
}

function parseGeneratedQuestions(raw: string): GeneratedQuestion[] {
  let cleaned = raw.trim();

  // Strip markdown code fences if present
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  const parsed = JSON.parse(cleaned);

  if (!Array.isArray(parsed)) {
    throw new Error('AI response is not an array');
  }

  return parsed.map((q) => ({
    questionText: q.questionText || q.question_text || '',
    questionType: q.questionType || q.question_type || 'multiple_choice',
    difficulty: q.difficulty || 'moderate',
    bloomLevel: q.bloomLevel || q.bloom_level || 'remember',
    points: q.points || 1,
    choices: q.choices,
    canonicalAnswer: q.canonicalAnswer || q.canonical_answer,
    sourceChunkIds: q.sourceChunkIds || q.source_chunk_ids || [],
  }));
}

export async function generateQuestions(
  params: GenerateQuestionsParams
): Promise<GenerationResult> {
  const startTime = Date.now();
  const prompt = buildQuestionPrompt(params);

  const response = await getOpenAI().chat.completions.create({
    model: OPENAI_MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
    max_tokens: 4096,
    response_format: { type: 'json_object' },
  });

  const rawContent = response.choices[0]?.message?.content;
  if (!rawContent) {
    throw new Error('OpenAI returned empty response');
  }

  const questions = parseGeneratedQuestions(rawContent);
  const duration = Date.now() - startTime;

  const totalTokens = (response.usage?.prompt_tokens ?? 0) + (response.usage?.completion_tokens ?? 0);

  return {
    questions,
    provider: 'openai',
    model: OPENAI_MODEL,
    tokensUsed: totalTokens,
    duration,
  };
}

export async function generateEmbedding(text: string): Promise<EmbeddingResult> {
  const response = await getOpenAI().embeddings.create({
    model: EMBEDDING_MODEL,
    input: buildEmbeddingPrompt(text),
  });

  return {
    embedding: response.data[0].embedding,
    tokensUsed: response.usage.total_tokens,
  };
}
