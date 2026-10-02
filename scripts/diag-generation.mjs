/**
 * Live prompt smoke test for retrieval-grounded generation (scope §11/§12):
 * builds the SHARED prompt (src/lib/ai/prompt.ts — the exact text both
 * providers send), calls Groq once, and checks the contract the generate
 * route relies on:
 *
 *   1. the reply parses as a JSON array of questions;
 *   2. sourceChunkIds cites only ids that were actually provided;
 *   3. MCQ shape is intact (4 choices, exactly one correct);
 *   4. the avoid-list branch (duplicate regeneration, scope §13) does not
 *      break parsing and the rejected text is not repeated verbatim.
 *
 * Skips cleanly when GROQ_API_KEY is absent.
 * Run:  node --env-file=.env.local scripts/diag-generation.mjs
 */
import { buildQuestionPrompt } from '../src/lib/ai/prompt.ts';

const apiKey = process.env.GROQ_API_KEY;
if (!apiKey) {
  console.log('SKIP  GROQ_API_KEY not set — generation smoke test not run');
  process.exit(0);
}

const chunks = [
  {
    id: 'chunk-aaa',
    content:
      'The mitochondrion is the powerhouse of the cell. Through cellular respiration it converts glucose into ATP, the cell\'s usable energy currency.',
  },
  {
    id: 'chunk-bbb',
    content:
      'Osmosis is the passive diffusion of water across a semipermeable membrane, moving from the region of lower solute concentration to higher solute concentration.',
  },
];

const avoidTexts = ['What is osmosis?'];

const prompt = buildQuestionPrompt({
  sourceTexts: chunks.map((c) => c.content),
  sourceChunks: chunks,
  topic: 'Cell transport',
  questionType: 'multiple_choice',
  count: 1,
  difficulty: 'moderate',
  bloomLevel: 'understand',
  avoidQuestionTexts: avoidTexts,
});

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

check('prompt labels chunks and carries the avoid list', /\[chunk:chunk-aaa\]/.test(prompt) && prompt.includes('DUPLICATE AVOIDANCE'));

const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
  method: 'POST',
  headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'openai/gpt-oss-120b',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
    max_tokens: 4096,
  }),
});
if (!res.ok) {
  console.error(`FAIL  Groq API error ${res.status}: ${await res.text()}`);
  process.exit(1);
}

const completion = await res.json();
const raw = completion.choices?.[0]?.message?.content ?? '';
let parsed;
try {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  parsed = JSON.parse(cleaned);
} catch (err) {
  console.error('FAIL  reply is not JSON:', err.message, '\n---\n', raw.slice(0, 800));
  process.exit(1);
}

check('reply parses as a JSON array', Array.isArray(parsed), `${Array.isArray(parsed) ? parsed.length : typeof parsed} item(s)`);

const q = Array.isArray(parsed) ? parsed[0] : null;
check('question has non-empty text', Boolean(q?.questionText?.trim()), `"${q?.questionText ?? ''}"`);

const allowed = new Set(chunks.map((c) => c.id));
const cited = Array.isArray(q?.sourceChunkIds) ? q.sourceChunkIds : [];
check(
  'sourceChunkIds cites only provided chunk ids',
  cited.every((id) => allowed.has(id)),
  JSON.stringify(cited)
);
check('at least one chunk was cited', cited.length > 0, JSON.stringify(cited));

const choices = Array.isArray(q?.choices) ? q.choices : [];
const correctCount = choices.filter((c) => c?.isCorrect === true).length;
check('MCQ has exactly 4 choices with one correct', choices.length === 4 && correctCount === 1, `${choices.length} choices, ${correctCount} correct`);

const repeated = avoidTexts.some((t) => q?.questionText?.trim().toLowerCase() === t.toLowerCase());
check('rejected question is not repeated verbatim', !repeated);

const tokens = (completion.usage?.prompt_tokens ?? 0) + (completion.usage?.completion_tokens ?? 0);
console.log(`\nGroq usage: ${tokens} tokens, model ${completion.model}`);
console.log(failures === 0 ? 'All generation checks passed.' : `${failures} check(s) failed.`);
// Deliberately NOT process.exit(): tearing down while undici's keep-alive
// socket is closing trips a libuv assert on Windows and turns a passing run
// into exit code 1. Setting exitCode lets the event loop drain naturally.
process.exitCode = failures === 0 ? 0 : 1;
