/**
 * Live smoke test for question-bank embeddings (migration
 * 20261009000000_question_bank_embedding) used by the generate route's
 * duplicate gate (scope §13: "...and, where configured, against relevant
 * question-bank items").
 *
 * Exercises the full data path the route relies on:
 *   1. question_bank.embedding exists and accepts a 384-dim write;
 *   2. PostgREST reads it back in a shape parseEmbedding understands;
 *   3. a near-identical candidate scores as a semantic duplicate against the
 *      stored row, while an unrelated candidate does not;
 *   4. a re-worded (punctuation/spacing) candidate still hits the normalized
 *      exact-match path.
 *
 * It warms one existing bank row (persisting the embedding — the same state
 * the route's backfill produces); only when the bank is empty does it create
 * a temporary row and remove it again.
 *
 * Run:  node --env-file=.env.local scripts/diag-bank-embedding.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { parseEmbedding, scoreAgainstExisting } from '../src/lib/ai/duplicate-check.ts';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hfKey = process.env.HUGGINGFACE_API_KEY;

if (!url || !serviceKey || !hfKey) {
  console.error('Missing Supabase/HuggingFace env vars. Run: node --env-file=.env.local scripts/diag-bank-embedding.mjs');
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function embed(text) {
  const res = await fetch(
    'https://router.huggingface.co/hf-inference/models/sentence-transformers/all-MiniLM-L6-v2/pipeline/feature-extraction',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${hfKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: text }),
    }
  );
  if (!res.ok) throw new Error(`HuggingFace API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return Array.isArray(data[0]) ? data[0] : data;
}

// --- Locate (or create) a bank row to probe against -------------------------
let cleanupTempRow = null;

const { data: existingRows, error: bankError } = await admin
  .from('question_bank')
  .select('id, subject_id, question_text, embedding, created_by')
  .eq('status', 'active')
  .not('question_text', 'is', null)
  .limit(50);
if (bankError) throw new Error(`question_bank read: ${bankError.message}`);

let row = (existingRows ?? []).find((r) => parseEmbedding(r.embedding) === null)
  ?? (existingRows ?? [])[0];

if (!row) {
  // Bank is empty: synthesize a minimal row, then delete it again.
  const { data: subject } = await admin.from('subjects').select('id').limit(1).maybeSingle();
  const { data: profile } = await admin.from('profiles').select('id').limit(1).maybeSingle();
  if (!subject || !profile) {
    console.log('SKIP  no bank rows and no subject/profile to anchor a probe row — nothing to verify yet');
    await new Promise((r) => setTimeout(r, 300));
    process.exit(0);
  }
  const tempText = 'Which process converts sunlight into chemical energy in plants?';
  const { data: inserted, error: insertError } = await admin
    .from('question_bank')
    .insert({
      subject_id: subject.id,
      question_type: 'identification',
      question_text: tempText,
      difficulty: 'moderate',
      bloom_level: 'understand',
      points: 1,
      created_by: profile.id,
      status: 'active',
    })
    .select('id, subject_id, question_text, embedding, created_by')
    .single();
  if (insertError) throw new Error(`probe row insert: ${insertError.message}`);
  row = inserted;
  cleanupTempRow = inserted.id;
  console.log(`      (bank was empty — created probe row ${row.id})`);
}

const originalEmbedding = parseEmbedding(row.embedding);

try {
  // --- 1/2. The column exists, accepts a write, and reads back -------------
  const stored = await embed(row.question_text);
  check('embedding produced (384-dim MiniLM)', Array.isArray(stored) && stored.length === 384, `dim=${stored?.length}`);

  const { error: writeError } = await admin
    .from('question_bank')
    .update({ embedding: stored })
    .eq('id', row.id);
  check('question_bank.embedding write accepted', !writeError, writeError?.message ?? 'ok');

  const { data: readBack, error: readError } = await admin
    .from('question_bank')
    .select('embedding')
    .eq('id', row.id)
    .single();
  check('embedding read back', !readError, readError?.message ?? 'ok');

  const parsed = parseEmbedding(readBack?.embedding);
  check(
    'parseEmbedding handles the PostgREST shape',
    parsed !== null && parsed.length === 384,
    `type=${Array.isArray(readBack?.embedding) ? 'array' : typeof readBack?.embedding} dim=${parsed?.length ?? 'n/a'}`
  );
  const maxDelta = parsed
    ? Math.max(...stored.map((v, i) => Math.abs(v - parsed[i])))
    : NaN;
  check('round-trip values preserved', Number.isFinite(maxDelta) && maxDelta < 1e-5, `maxDelta=${maxDelta}`);

  if (parsed) {
    const existing = [{ id: row.id, question_text: row.question_text, embedding: parsed, origin: 'bank' }];

    // --- 3. Semantic path: near-identical wording scores, noise does not ---
    const nearDupText = `${row.question_text.trim().replace(/\s+$/, '')} (choose the best answer)`;
    const nearDupEmbed = await embed(nearDupText);
    const semantic = scoreAgainstExisting(nearDupText, nearDupEmbed, existing, 0.6);
    check(
      'near-identical bank question scores as a semantic duplicate',
      Boolean(semantic.similarQuestionId === row.id && semantic.maxSimilarity >= 0.6),
      `similarity=${semantic.maxSimilarity ? semantic.maxSimilarity.toFixed(3) : 'n/a'}`
    );

    const noiseText = 'Underwater basket weaving requires blue elephants operating xylophones.';
    const noiseEmbed = await embed(noiseText);
    const noise = scoreAgainstExisting(noiseText, noiseEmbed, existing, 0.6);
    check('unrelated question is not flagged', !noise.similarQuestionId, `similarity=${noise.maxSimilarity?.toFixed(3) ?? 'n/a'}`);

    // --- 4. Exact path still applies regardless of embeddings --------------
    const exact = scoreAgainstExisting(`  ${row.question_text.toUpperCase()}!! `, null, existing, 0.6);
    check(
      're-worded duplicate still caught by normalized exact match',
      Boolean(exact.exactDuplicateOf),
      exact.exactDuplicateOf ? `matched "${row.question_text.slice(0, 40)}…"` : 'no exact match'
    );
  }
} finally {
  if (cleanupTempRow) {
    const { error: cleanupError } = await admin.from('question_bank').delete().eq('id', cleanupTempRow);
    if (cleanupError) console.warn(`WARN  probe row cleanup failed: ${cleanupError.message}`);
  } else if (originalEmbedding === null) {
    // Leave the row warm — that is exactly what the route's backfill does —
    // but never fail the run over bookkeeping.
    console.log('      (probe row left warmed, matching the route backfill state)');
  }
}

console.log(`\n${failures === 0 ? 'All question-bank embedding checks passed.' : `${failures} check(s) failed.`}`);
// Not process.exit(): that can race undici's socket teardown on Windows and
// flip a passing run to exit code 1 (see diag-generation.mjs).
process.exitCode = failures === 0 ? 0 : 1;
