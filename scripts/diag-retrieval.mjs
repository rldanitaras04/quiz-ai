/**
 * Live smoke test for vector retrieval (migration 20261007000000 —
 * match_source_chunks) used by the generate route (scope §11).
 *
 * Embeds a query with the same HuggingFace model the app uses (384-dim
 * MiniLM), then checks the SQL function:
 *   1. executes through the service role and returns rows for an authorized
 *      source material that has embedded chunks;
 *   2. honors the material-scope filter (other material ids → no rows);
 *   3. honors the similarity floor (a floor above 1.0 → no rows);
 *   4. returns matches best-first.
 *
 * Run:  node --env-file=.env.local scripts/diag-retrieval.mjs
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hfKey = process.env.HUGGINGFACE_API_KEY;

if (!url || !serviceKey || !hfKey) {
  console.error('Missing Supabase/HuggingFace env vars. Run: node --env-file=.env.local scripts/diag-retrieval.mjs');
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

const query = await embed('photosynthesis and cellular respiration');
check('query embedding produced', Array.isArray(query) && query.length === 384, `dim=${query?.length}`);

// A source material that actually has embedded chunks.
const { data: sample, error: sampleError } = await admin
  .from('source_chunks')
  .select('id, source_material_id')
  .not('embedding', 'is', null)
  .limit(1);
if (sampleError) throw new Error(`source_chunks read: ${sampleError.message}`);

if (!sample || sample.length === 0) {
  console.log('SKIP  no embedded chunks in the database yet (materials still process) — function execution not exercised');
  // Drain in-flight socket closes before tearing down: process.exit() during
  // an active close trips a libuv assert on Windows (see diag-generation.mjs).
  await new Promise((r) => setTimeout(r, 300));
  process.exit(0);
}

const materialId = sample[0].source_material_id;

// 1. Scoped search over the authorized material.
const { data: matches, error: matchError } = await admin.rpc('match_source_chunks', {
  p_query_embedding: query,
  p_source_material_ids: [materialId],
  p_match_count: 5,
  p_min_similarity: -1,
});
if (matchError) {
  check('match_source_chunks executes', false, `${matchError.message} (${matchError.code ?? 'no code'})`);
  process.exit(1);
}
check('match_source_chunks executes', Array.isArray(matches), `type=${Array.isArray(matches) ? 'array' : typeof matches}`);
check(
  'authorized material returns its embedded chunks',
  matches.length > 0 && matches.every((m) => m.source_material_id === materialId),
  `${matches.length} row(s)`
);
check(
  'every row carries content and a similarity',
  matches.every((m) => typeof m.content === 'string' && typeof m.similarity === 'number'),
  matches[0] ? `top similarity=${Number(matches[0].similarity).toFixed(3)}` : 'no rows'
);
const sorted = matches.every((m, i) => i === 0 || matches[i - 1].similarity >= m.similarity);
check('matches are ordered best-first', sorted);

// 2. Scope filter: a material the caller did not pass must never appear.
const { data: scopedOut, error: scopedError } = await admin.rpc('match_source_chunks', {
  p_query_embedding: query,
  p_source_material_ids: [crypto.randomUUID()],
  p_match_count: 5,
  p_min_similarity: -1,
});
check('material scope filter excludes everything else', !scopedError && (scopedOut ?? []).length === 0, `${(scopedOut ?? []).length} row(s)`);

// 3. Similarity floor above the maximum possible score matches nothing.
const { data: floored, error: floorError } = await admin.rpc('match_source_chunks', {
  p_query_embedding: query,
  p_source_material_ids: [materialId],
  p_match_count: 5,
  p_min_similarity: 1.1,
});
check('similarity floor filters (1.1 → no rows)', !floorError && (floored ?? []).length === 0, `${(floored ?? []).length} row(s)`);

// 4. Function is not executable by unauthenticated callers (revoked from
//    PUBLIC/anon/authenticated in the migration — a failed anon call here
//    would be the surprise, not the success).
const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const { error: anonError } = await anon.rpc('match_source_chunks', {
  p_query_embedding: query,
  p_match_count: 1,
});
check('anonymous callers cannot execute it', Boolean(anonError), anonError?.code ?? 'no error');

console.log(`\n${failures === 0 ? 'All retrieval checks passed.' : `${failures} check(s) failed.`}`);
// Not process.exit(): that can race undici's socket teardown on Windows and
// flip a passing run to exit code 1 (see diag-generation.mjs).
process.exitCode = failures === 0 ? 0 : 1;
