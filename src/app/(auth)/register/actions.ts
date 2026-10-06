'use server';

import { createAdminClient } from '@/lib/supabase/admin';
import { validateEmail, validatePassword, validateMinLength, validateRequired, validateStudentNumber, validatePattern } from '@/lib/validators';
import { LOGIN_PATH, appOrigin } from '@/lib/constants';

/**
 * Registration runs server-side with the service-role client so the whole
 * flow never depends on per-table RLS insert grants:
 *
 *  1. create the auth user UNCONFIRMED and email it the "confirm your
 *     signup" link (step 4). Email verification is the first gate: GoTrue
 *     refuses to sign an unconfirmed address in, so nobody reaches the app
 *     on an address they do not control. The link is issued with the
 *     implicit flow (no PKCE code challenge), so it opens from whatever
 *     browser or phone received the email; /login consumes its tokens.
 *  2. create profiles / user_roles / student|faculty_profiles rows
 *  3. roles: student/faculty only — super_admin cannot be created here
 *  4. send the confirmation email; if it cannot be sent, roll everything
 *     back so no account is ever left unconfirmed with no link to click
 *
 * The second gate is profiles.status='pending', which an administrator
 * flips to 'active' at /admin/users. So the full path is:
 * confirm email -> admin activates -> app unlocks.
 *
 * If step 2 or 3 fails, the auth user is deleted again so retries start
 * clean (the profile rows cascade with it).
 */

export interface RegisterInput {
  fullName: string;
  email: string;
  password: string;
  role: 'student' | 'faculty';
  studentNumber: string;
  programId: string | null;
  yearLevelId: string | null;
  sectionName: string;
  employeeNumber: string;
}

export interface RegisterResult {
  success: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fieldError(field: string, message: string): RegisterResult {
  return { success: false, fieldErrors: { [field]: message } };
}

export async function registerUser(input: RegisterInput): Promise<RegisterResult> {
  // ------------------------------------------------------------------
  // 1. Server-side validation (the client form is not trusted)
  // ------------------------------------------------------------------
  if (!input || typeof input !== 'object') {
    return { success: false, error: 'Invalid request.' };
  }

  const fullName = String(input.fullName ?? '').trim();
  const email = String(input.email ?? '').trim().toLowerCase();
  const password = String(input.password ?? '');
  const role = input.role === 'faculty' ? 'faculty' : 'student';
  const studentNumber = String(input.studentNumber ?? '').trim();
  const programId = input.programId ? String(input.programId) : null;
  const yearLevelId = input.yearLevelId ? String(input.yearLevelId) : null;
  const sectionName = String(input.sectionName ?? '').trim();
  const employeeNumber = String(input.employeeNumber ?? '').trim();

  const nameResult = validateMinLength(fullName, 2, 'Full name');
  if (!nameResult.success) return fieldError('fullName', nameResult.errors[0].message);

  if (!validateEmail(email).success) return fieldError('email', 'Invalid email address');

  const passwordResult = validatePassword(password);
  if (!passwordResult.success) {
    const messages = [...new Set(passwordResult.errors.map((e) => e.message))];
    return fieldError('password', messages[0]);
  }

  if (role === 'student') {
    const snResult = validateStudentNumber(studentNumber);
    if (!snResult.success) return fieldError('studentNumber', snResult.errors[0].message);

    const progResult = validateRequired(programId ?? '', 'program');
    if (!progResult.success) return fieldError('program', 'Please select a program');

    if (programId && !UUID_RE.test(programId)) {
      return fieldError('program', 'Please select a valid program');
    }

    const yearResult = validateRequired(yearLevelId ?? '', 'year level');
    if (!yearResult.success) return fieldError('yearLevel', 'Please select a year level');

    if (yearLevelId && !UUID_RE.test(yearLevelId)) {
      return fieldError('yearLevel', 'Please select a valid year level');
    }

    const sectionResult = validatePattern(
      sectionName,
      /^[A-Za-z0-9-]{1,20}$/,
      'section',
      'Section must be 1-20 letters, numbers, or hyphens'
    );
    if (!sectionResult.success) return fieldError('section', sectionResult.errors[0].message);
  } else if (employeeNumber) {
    const enResult = validateMinLength(employeeNumber, 3, 'Employee number');
    if (!enResult.success) return fieldError('employeeNumber', enResult.errors[0].message);
  }

  const admin = createAdminClient();

  // ------------------------------------------------------------------
  // 2. Create the auth user with the form's password. email_confirm:false
  //    leaves the address unconfirmed — step 4 then emails the link that
  //    confirms it. createUser is used (not signUp) so registration still
  //    works when the project's "Allow new users to sign up" toggle is off,
  //    and so no email is dispatched before the profile rows exist.
  // ------------------------------------------------------------------
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: false,
  });

  if (createError) {
    const message = createError.message ?? '';
    if (/already|registered|duplicate|exists/i.test(message)) {
      return fieldError('email', 'An account with this email already exists. Please sign in instead.');
    }
    return { success: false, error: message || 'Failed to create the account. Please try again.' };
  }

  const userId = created.user?.id;
  if (!userId) {
    return { success: false, error: 'Failed to create account.' };
  }

  // ------------------------------------------------------------------
  // 3. Create the profile rows. On failure, roll the auth user back.
  // ------------------------------------------------------------------
  const rollback = async () => {
    await admin.auth.admin.deleteUser(userId);
  };

  const { error: profileError } = await admin.from('profiles').insert({
    id: userId,
    email,
    full_name: fullName,
    status: 'pending',
  });

  if (profileError) {
    // The only legitimate cause is a concurrently-created profile
    // (e.g. a database trigger). Surface it as duplicate email; otherwise
    // the account would be broken anyway.
    await rollback();
    return fieldError('email', 'An account with this email already exists.');
  }

  const { error: roleError } = await admin.from('user_roles').insert({
    user_id: userId,
    role,
  });

  if (roleError) {
    await rollback();
    return { success: false, error: 'Failed to assign role. Please try again.' };
  }

  if (role === 'student') {
    // The student_profiles table stores section_id (a UUID FK into sections),
    // not a free-text section name. The registration form collects a text
    // section label, so we leave section_id null here; it gets resolved by
    // an admin when the student's verification is reviewed.
    const { error: studentError } = await admin.from('student_profiles').insert({
      user_id: userId,
      student_number: studentNumber,
      program_id: programId,
      year_level_id: yearLevelId,
      section_id: null,
    });

    if (studentError) {
      await rollback();
      const message = studentError.message ?? '';
      if (/duplicate key/i.test(message)) {
        return fieldError('studentNumber', 'This student number is already registered.');
      }
      return { success: false, error: 'Failed to create student profile. Please try again.' };
    }
  } else {
    const { error: facultyError } = await admin.from('faculty_profiles').insert({
      user_id: userId,
      employee_number: employeeNumber || null,
    });

    if (facultyError) {
      await rollback();
      const message = facultyError.message ?? '';
      if (/duplicate key/i.test(message)) {
        return fieldError('employeeNumber', 'This employee number is already registered.');
      }
      return { success: false, error: 'Failed to create faculty profile. Please try again.' };
    }
  }

  // ------------------------------------------------------------------
  // 4. Send the confirmation email (GoTrue's "Confirm signup" template,
  //    customizable in Authentication -> Email Templates). The redirect
  //    target must be on the project's allowlist. Failure rolls the whole
  //    account back: an unconfirmed user with no way to receive the link
  //    would be permanently stuck.
  // ------------------------------------------------------------------
  const { error: confirmError } = await admin.auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: `${appOrigin()}${LOGIN_PATH}` },
  });

  if (confirmError) {
    console.error('Confirmation email not dispatched:', confirmError.message);
    await rollback();
    return {
      success: false,
      error: 'We could not send the confirmation email. Please try again in a moment.',
    };
  }

  // The address must be confirmed (email) and the profile activated
  // (administrator) before this account can use the app.
  return { success: true };
}

/**
 * Reference data for the registration form (programs + year levels).
 * Reads run through the service-role client because the RLS policies grant
 * reference-table SELECTs to authenticated users only, and registration
 * happens before login.
 */
export async function getRegistrationOptions(): Promise<{
  programs: { id: string; label: string }[];
  yearLevels: { id: string; label: string }[];
}> {
  const admin = createAdminClient();

  const [programsResult, yearLevelsResult] = await Promise.all([
    admin.from('programs').select('id, code, name').eq('is_active', true).order('code'),
    admin.from('year_levels').select('id, name, sort_order').order('sort_order'),
  ]);

  return {
    programs: (programsResult.data ?? []).map((p) => ({
      id: p.id,
      label: `${p.code} — ${p.name}`,
    })),
    yearLevels: (yearLevelsResult.data ?? []).map((y) => ({
      id: y.id,
      label: y.name,
    })),
  };
}
