/**
 * One-off idempotent seed for academic reference data.
 *
 * Run:  node --env-file=.env.local scripts/seed-reference.mjs
 * (export the correct .env.local values first if your shell has stale
 *  Supabase variables inherited — see `unset NEXT_PUBLIC_SUPABASE_URL`).
 *
 * Uses the service-role key locally; key values are never printed.
 * Matching is done on natural keys (name/code); existing rows are kept,
 * missing rows are inserted, so it is safe to run repeatedly.
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. ' +
      'Run with: node --env-file=.env.local scripts/seed-reference.mjs'
  );
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

const ACADEMIC_YEAR = { name: '2026-2027', starts_on: '2026-06-01', ends_on: '2027-05-31' };

const SEMESTERS = [
  { name: '1st Semester', starts_on: '2026-06-01', ends_on: '2026-10-31' },
  { name: '2nd Semester', starts_on: '2027-01-01', ends_on: '2027-05-31' },
];

const YEAR_LEVELS = [
  { name: '1st Year', sort_order: 1 },
  { name: '2nd Year', sort_order: 2 },
  { name: '3rd Year', sort_order: 3 },
  { name: '4th Year', sort_order: 4 },
];

const PROGRAMS = [
  { code: 'BSCS', name: 'BS Computer Science' },
  { code: 'BSIT', name: 'BS Information Technology' },
  { code: 'BSIS', name: 'BS Information Systems' },
  { code: 'BSBA', name: 'BS Business Administration' },
  { code: 'BSED', name: 'BS Education' },
  { code: 'BEED', name: 'BE Elementary Education' },
  { code: 'BSN', name: 'BS Nursing' },
  { code: 'BSA', name: 'BS Accountancy' },
  { code: 'BSCRIM', name: 'BS Criminology' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function ensureRow(table, matchColumn, values, selectColumns = 'id') {
  const { data: existing } = await supabase
    .from(table)
    .select(selectColumns)
    .eq(matchColumn, values[matchColumn])
    .maybeSingle();

  if (existing) {
    return { row: existing, created: false };
  }

  const { data: inserted, error } = await supabase
    .from(table)
    .insert(values)
    .select(selectColumns)
    .single();

  if (error) {
    throw new Error(`${table}: ${error.message}`);
  }
  return { row: inserted, created: true };
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

const summary = { created: 0, existing: 0 };

function tally(created) {
  if (created) summary.created += 1;
  else summary.existing += 1;
}

// Academic year
const year = await ensureRow('academic_years', 'name', ACADEMIC_YEAR);
tally(year.created);
const academicYearId = year.row.id;

// Semesters (scoped to the academic year)
for (const sem of SEMESTERS) {
  const { data: existing } = await supabase
    .from('semesters')
    .select('id')
    .eq('academic_year_id', academicYearId)
    .eq('name', sem.name)
    .maybeSingle();

  if (existing) {
    tally(false);
    continue;
  }

  const { data: inserted, error } = await supabase
    .from('semesters')
    .insert({ ...sem, academic_year_id: academicYearId })
    .select('id')
    .single();

  if (error) throw new Error(`semesters: ${error.message}`);
  tally(true);
  void inserted;
}

// Year levels
for (const yl of YEAR_LEVELS) {
  const r = await ensureRow('year_levels', 'name', yl);
  tally(r.created);
}

// Programs
for (const p of PROGRAMS) {
  const r = await ensureRow('programs', 'code', p);
  tally(r.created);
}

console.log(
  `Seed complete: ${summary.created} rows created, ${summary.existing} already present.`
);
