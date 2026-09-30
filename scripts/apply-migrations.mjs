/**
 * Applies pending Supabase migrations from `supabase/migrations`, using the
 * Supabase CLI (already a devDependency) so the ledger in
 * `supabase_migrations.schema_migrations` stays the CLI's own.
 *
 * Why this exists: nothing in the repo ran migrations, so files could sit in
 * the tree unapplied — that is exactly how 20261001000000 was missed. Run this
 * after every `supabase/migrations` change so the database and the repository
 * stay in step.
 *
 * Usage:
 *   node --env-file=.env.local scripts/apply-migrations.mjs            # apply pending
 *   node --env-file=.env.local scripts/apply-migrations.mjs --check    # report only
 *   npm run db:migrate / npm run db:migrate:check
 *
 * Every migration in this repository is written to be idempotent, so a
 * re-run against an already-applied file is safe.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const databaseUrl = process.env.SUPABASE_DB_URL;
if (!databaseUrl) {
  console.error('Missing SUPABASE_DB_URL. Run: node --env-file=.env.local scripts/apply-migrations.mjs');
  process.exit(1);
}

const require = createRequire(import.meta.url);
const cliEntry = path.join(path.dirname(require.resolve('supabase/package.json')), 'dist', 'supabase.js');

const checkOnly = process.argv.includes('--check');

// `--yes` skips the interactive confirmation so this runs without a TTY.
// Run the CLI entry point with the current Node binary instead of shelling out
// to `npx`, which would need a shell (and re-quote) the connection string.
const args = ['db', 'push', '--db-url', databaseUrl, '--yes'];
if (checkOnly) args.push('--dry-run');

console.log(checkOnly ? 'Checking for pending migrations…' : 'Applying pending migrations…');

const child = spawn(process.execPath, [cliEntry, ...args], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 1));
child.on('error', (error) => {
  console.error(`Failed to run the Supabase CLI: ${error.message}`);
  process.exit(1);
});
