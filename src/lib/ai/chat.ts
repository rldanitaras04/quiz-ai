// ---------------------------------------------------------------------------
// Generic chat completion — the small, reusable half of the AI layer.
// ---------------------------------------------------------------------------
// `generateQuestions` (providers/groq, providers/openai) stays the specialized
// path for exam generation; this module answers a simpler question: "send a
// system + user prompt, get the text back with token accounting." Consumers:
//   * identification score recommendations (scope §26, review/actions.ts),
//   * the §16 authoring assistant (planned, WP-2).
//
// Provider selection mirrors getChatProvider in ai/index.ts: Groq when
// GROQ_API_KEY is set, otherwise OpenAI. Clients are constructed lazily per
// provider — instantiating at module scope crashes `next build` when the key
// is absent (same reasoning as the lazy singletons in providers/*).

import OpenAI from 'openai';

export type ChatProviderName = 'groq' | 'openai';

export interface ChatCompletionResult {
  content: string;
  provider: ChatProviderName;
  model: string;
  tokensUsed: number;
  duration: number;
}

const GROQ_MODEL = 'openai/gpt-oss-120b';
const OPENAI_MODEL = 'gpt-4o';

const clients: Partial<Record<ChatProviderName, OpenAI>> = {};

function getClient(provider: ChatProviderName): OpenAI {
  if (!clients[provider]) {
    clients[provider] =
      provider === 'groq'
        ? new OpenAI({
            apiKey: process.env.GROQ_API_KEY,
            baseURL: 'https://api.groq.com/openai/v1',
          })
        : new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return clients[provider] as OpenAI;
}

/** True when at least one chat provider is configured (clean pre-flight check). */
export function hasChatProvider(): boolean {
  return Boolean(process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY);
}

/** Which provider chatCompletion would use, for usage logging before a call. */
export function activeChatProvider(): ChatProviderName {
  return process.env.GROQ_API_KEY ? 'groq' : 'openai';
}

/**
 * Send a system + user prompt and return the assistant text with token and
 * duration accounting. Throws on missing configuration, provider errors or an
 * empty completion — callers translate those into user-facing errors and log
 * the failure through logAiUsage.
 */
export async function chatCompletion(
  system: string,
  user: string,
  options: { temperature?: number; maxTokens?: number } = {}
): Promise<ChatCompletionResult> {
  if (!hasChatProvider()) {
    throw new Error('No chat provider configured. Set GROQ_API_KEY or OPENAI_API_KEY.');
  }

  const provider = activeChatProvider();
  const model = provider === 'groq' ? GROQ_MODEL : OPENAI_MODEL;
  const started = Date.now();

  const response = await getClient(provider).chat.completions.create({
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: options.temperature ?? 0,
    max_tokens: options.maxTokens ?? 500,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error(`${provider} returned an empty response`);
  }

  return {
    content,
    provider,
    model,
    tokensUsed: (response.usage?.prompt_tokens ?? 0) + (response.usage?.completion_tokens ?? 0),
    duration: Date.now() - started,
  };
}
