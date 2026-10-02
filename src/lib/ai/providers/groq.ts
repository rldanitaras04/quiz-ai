import OpenAI from 'openai';
import { buildQuestionPrompt } from '@/lib/ai/prompt';
import type {
  GenerateQuestionsParams,
  GenerationResult,
  GeneratedQuestion,
  EmbeddingResult,
} from '@/lib/ai/types';

// Lazily constructed: avoids build-time crashes when GROQ_API_KEY is absent
// and matches the lazy-init pattern used by the OpenAI provider.
let groqInstance: OpenAI | null = null;

function getGroq(): OpenAI {
  if (!groqInstance) {
    groqInstance = new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: 'https://api.groq.com/openai/v1',
    });
  }
  return groqInstance;
}

const GROQ_MODEL = 'openai/gpt-oss-120b';

function parseGeneratedQuestions(raw: string): GeneratedQuestion[] {
  let cleaned = raw.trim();

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

  const response = await getGroq().chat.completions.create({
    model: GROQ_MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
    max_tokens: 4096,
  });

  const rawContent = response.choices[0]?.message?.content;
  if (!rawContent) {
    throw new Error('Groq returned empty response');
  }

  const questions = parseGeneratedQuestions(rawContent);
  const duration = Date.now() - startTime;

  const totalTokens = (response.usage?.prompt_tokens ?? 0) + (response.usage?.completion_tokens ?? 0);

  return {
    questions,
    provider: 'groq',
    model: GROQ_MODEL,
    tokensUsed: totalTokens,
    duration,
  };
}

export async function generateEmbedding(text: string): Promise<EmbeddingResult> {
  const response = await getGroq().embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  });

  return {
    embedding: response.data[0].embedding,
    tokensUsed: response.usage.total_tokens,
  };
}
