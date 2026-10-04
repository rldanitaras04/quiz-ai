// TEMPORARY: count subject cards + section badges on /faculty/subjects.
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BASE = 'http://localhost:3211';
const EMAIL = 'rldanitaras@gmail.com';

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const { data: link, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: EMAIL });
if (error) throw new Error(error.message);
const tokenHash = link?.hashed_token ?? link?.properties?.hashed_token;

const verifier = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
let session = null;
for (const type of ['magiclink', 'email']) {
  const { data, error: vErr } = await verifier.auth.verifyOtp({ token_hash: tokenHash, type });
  if (!vErr && data?.session) { session = data.session; break; }
  if (type === 'email') throw new Error(vErr?.message);
}

const key = `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;
const encoded = 'base64-' + Buffer.from(JSON.stringify(session), 'utf8').toString('base64url');
let chunks;
try {
  const { createChunks } = await import('@supabase/ssr/dist/main/utils/chunker.js');
  chunks = await createChunks(key, encoded);
} catch {
  chunks = [{ name: key, value: encoded }];
}
const cookie = chunks.map((c) => `${c.name}=${c.value}`).join('; ');

const res = await fetch(`${BASE}/faculty/subjects`, { headers: { Cookie: cookie }, redirect: 'manual' });
const html = (await res.text()).replace(/<!--.*?-->/g, '');
console.log('status', res.status);

const cards = [...html.matchAll(/href="\/faculty\/subjects\/subject\/[^"]+"[^>]*>([^<]+)<\/a>/g)].map((m) => m[1].trim());
console.log('subject cards:', JSON.stringify(cards));

const badges = [...html.matchAll(/(\d+)\s+sections?\b/g)].map((m) => m[0]);
console.log('badges:', JSON.stringify(badges));

// Per-row enrolled cells (rows: Section | Program/Year | Term | Enrolled | Status | Actions).
const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
  .map((tr) => [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1].replace(/<[^>]*>/g, '').trim()))
  .filter((cells) => cells.length >= 5 && cells[0] !== 'Section');
console.log('table rows:', JSON.stringify(rows.map((r) => [r[0], r[3]])));
