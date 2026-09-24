import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')];
    })
);

const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const { data: recent } = await db
  .from('notifications')
  .select('id, user_id, type, title, body, data, read_at, created_at')
  .order('created_at', { ascending: false })
  .limit(20);

console.log('recent notifications:', JSON.stringify(recent, null, 2));

const { count } = await db
  .from('notifications')
  .select('id', { count: 'exact', head: true })
  .eq('type', 'assessment_opened');

console.log('assessment_opened count:', count);
