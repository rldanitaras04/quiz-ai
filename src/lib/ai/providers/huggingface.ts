import type { EmbeddingResult } from '@/lib/ai/types';

const HF_EMBEDDING_MODEL = 'sentence-transformers/all-MiniLM-L6-v2';
// Use HF Router endpoint — api-inference.huggingface.co may be blocked on some networks
const HF_API_URL = `https://router.huggingface.co/hf-inference/models/${HF_EMBEDDING_MODEL}/pipeline/feature-extraction`;

async function queryHF(text: string, attempt = 0): Promise<number[]> {
  const apiKey = process.env.HUGGINGFACE_API_KEY;
  if (!apiKey) throw new Error('HUGGINGFACE_API_KEY not set');

  const res = await fetch(HF_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ inputs: text }),
  });

  if (res.status === 503 && attempt < 3) {
    const body = await res.json().catch(() => ({}));
    const waitMs = (body as any)?.estimated_time ?? 10;
    await new Promise((r) => setTimeout(r, Math.min(waitMs * 1000, 10000)));
    return queryHF(text, attempt + 1);
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HuggingFace API error ${res.status}: ${body}`);
  }

  const data = await res.json();
  return Array.isArray(data[0]) ? data[0] : data;
}

export async function generateEmbedding(text: string): Promise<EmbeddingResult> {
  const embedding = await queryHF(text);
  return { embedding, tokensUsed: 0 };
}
