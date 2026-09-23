import OpenAI from 'openai';
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

function buildQuestionPrompt(params: GenerateQuestionsParams): string {
  const { sourceTexts, topic, questionType, count, difficulty, bloomLevel, customInstructions } = params;
  const sourceContent = sourceTexts.join('\n\n---\n\n');

  const difficultyInstruction = difficulty === 'mixed'
    ? 'Generate a mix of easy, moderate, and difficult questions.'
    : `Generate ${difficulty} difficulty questions.`;

  const typeInstruction = questionType === 'multiple_choice'
    ? `Each question must be multiple choice with exactly 4 choices (A, B, C, D), where exactly one is correct.`
    : `Each question must be a theoretical identification/short-answer question. The answer MUST be a specific term, concept, or definition directly found in the source material. Questions should test knowledge of key terminology, definitions, or factual concepts.`;

  return `You are an expert assessment item writer for academic examinations.

TASK: Generate exactly ${count} high-quality examination questions about "${topic}".

SOURCE MATERIAL:
${sourceContent}

QUESTION TYPE: ${questionType}
${typeInstruction}

DIFFICULTY: ${difficultyInstruction}

BLOOM'S TAXONOMY LEVEL: ${bloomLevel}
- Focus questions at the "${bloomLevel}" cognitive level.

OUTPUT FORMAT: Return a JSON array. Each element must be an object with:
- "questionText" (string): The question stem
- "questionType" (string): "${questionType}"
- "difficulty" (string): one of "easy", "moderate", "difficult"
- "bloomLevel" (string): "${bloomLevel}"
- "points" (number): point value (1-5 based on difficulty)
${questionType === 'multiple_choice'
  ? `- "choices" (array of 4 objects): each with "key" (A/B/C/D), "text" (string), "isCorrect" (boolean, exactly one true)`
  : `- "canonicalAnswer" (string): a specific term, concept, or short phrase directly from the source material as the correct answer`}
- "sourceChunkIds" (array of strings): leave as empty array []

GUIDELINES:
- Questions must be grounded in the source material provided.
- Avoid ambiguous questions or trick questions.
- Use clear, concise academic language.
- Ensure distractors (for MCQ) are plausible but clearly incorrect.
- Do not include the correct answer in the question text.
${questionType === 'identification'
  ? `- For identification questions: ask "What is...", "Define...", "Name the...", or "According to the source, what..." style questions.\n- The canonicalAnswer must be a specific term or concept that appears in the source material.\n- Do NOT ask open-ended or essay-style questions.`
  : ''}
${customInstructions ? `\nADDITIONAL INSTRUCTIONS:\n${customInstructions}` : ''}

Return ONLY the JSON array, no additional text or markdown.`;
}

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
