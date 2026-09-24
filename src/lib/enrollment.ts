import type { SupabaseClient } from '@supabase/supabase-js';
import { emptySummary, type EnrollSummary } from '@/lib/enrollment-summary';

export type { EnrollSummary };
export { emptySummary, describeSummary, mergeSummaries } from '@/lib/enrollment-summary';

/**
 * Shared enrollment helpers used by the faculty roster actions, the admin
 * offering roster, and the section↔offering sync hooks. Server-side only —
 * the pure summary helpers live in `enrollment-summary.ts` for client use.
 *
 * Two clients, two roles:
 *   - `lookup` is the service-role client. Under RLS a faculty member may only
 *     read `student_profiles` for students who are ALREADY enrolled in one of
 *     their offerings, so resolving *new* students (by number or by section)
 *     has to bypass RLS — authorization is established by the caller first.
 *   - `db` is the caller's session client. The write still goes through it so
 *     the `Faculty can enroll…` / `Admin can manage enrollments` policies
 *     remain the enforcement layer.
 *
 * No `'use server'` marker: this module is imported by server actions and may
 * also be exercised directly from scripts.
 */

/** Splits pasted/entered text into unique student numbers (order preserved). */
export function parseStudentNumbers(inputs: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const input of inputs) {
    for (const raw of input.split(/[\s,;]+/)) {
      const number = raw.trim();
      if (!number) continue;
      const key = number.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(number);
    }
  }
  return out;
}

export interface ResolveResult {
  ids: string[];
  notFound: string[];
  error?: string;
}

/** Resolves student numbers to `student_profiles.user_id` via the lookup client. */
export async function resolveStudentIdsByNumbers(
  lookup: SupabaseClient,
  numbers: string[]
): Promise<ResolveResult> {
  if (numbers.length === 0) return { ids: [], notFound: [] };

  const { data, error } = await lookup
    .from('student_profiles')
    .select('user_id, student_number')
    .in('student_number', numbers);

  if (error) {
    return { ids: [], notFound: numbers, error: error.message };
  }

  const byNumber = new Map(
    (data ?? []).map((row) => [row.student_number, row.user_id] as const)
  );
  const ids: string[] = [];
  const notFound: string[] = [];
  for (const number of numbers) {
    const id = byNumber.get(number);
    if (id) ids.push(id);
    else notFound.push(number);
  }
  return { ids, notFound };
}

/** Every student whose `student_profiles.section_id` matches, via the lookup client. */
export async function resolveStudentIdsInSection(
  lookup: SupabaseClient,
  sectionId: string
): Promise<ResolveResult> {
  const { data, error } = await lookup
    .from('student_profiles')
    .select('user_id')
    .eq('section_id', sectionId);

  if (error) return { ids: [], notFound: [], error: error.message };
  return { ids: (data ?? []).map((row) => row.user_id), notFound: [] };
}

/**
 * Enrolls (or re-enrolls) the given students into the offering using the
 * session client. Idempotent: already-enrolled students are counted, not
 * touched; withdrawn/dropped/completed rows are restored to `enrolled`.
 */
export async function enrollStudents(
  db: SupabaseClient,
  offeringId: string,
  studentIds: string[]
): Promise<EnrollSummary> {
  const summary = emptySummary();
  const ids = [...new Set(studentIds.filter(Boolean))];
  if (ids.length === 0) return summary;

  const { data: existing, error: existingError } = await db
    .from('enrollments')
    .select('id, student_id, status')
    .eq('subject_offering_id', offeringId)
    .in('student_id', ids);

  if (existingError) {
    summary.failed = ids.length;
    return summary;
  }

  const byStudent = new Map((existing ?? []).map((row) => [row.student_id, row] as const));
  const missing: string[] = [];
  const toRestore: string[] = [];

  for (const id of ids) {
    const row = byStudent.get(id);
    if (!row) missing.push(id);
    else if (row.status === 'enrolled') summary.alreadyEnrolled += 1;
    else toRestore.push(row.id);
  }

  if (missing.length > 0) {
    const now = new Date().toISOString();
    const rows = missing.map((student_id) => ({
      subject_offering_id: offeringId,
      student_id,
      status: 'enrolled',
      enrolled_at: now,
    }));
    const { data: inserted, error } = await db
      .from('enrollments')
      .upsert(rows, {
        onConflict: 'subject_offering_id,student_id',
        ignoreDuplicates: true,
      })
      .select('id');

    if (error) {
      summary.failed += missing.length;
    } else {
      summary.added = inserted?.length ?? 0;
      summary.failed += missing.length - summary.added;
    }
  }

  if (toRestore.length > 0) {
    const { data: restored, error } = await db
      .from('enrollments')
      .update({ status: 'enrolled', updated_at: new Date().toISOString() })
      .in('id', toRestore)
      .select('id');

    if (error) {
      summary.failed += toRestore.length;
    } else {
      summary.reenrolled = restored?.length ?? 0;
      summary.failed += toRestore.length - summary.reenrolled;
    }
  }

  return summary;
}
