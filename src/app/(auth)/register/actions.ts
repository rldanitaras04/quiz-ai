'use server';

import { createAdminClient } from '@/lib/supabase/admin';
import { validateEmail, validatePassword, validateMinLength, validateRequired, validateStudentNumber, validatePattern } from '@/lib/validators';

/**
 * Registration runs server-side with the service-role client so the whole
 * flow never depends on per-table RLS insert grants:
 *
 *  1. create the auth user (email confirmed — the project has no SMTP
 *     configured; accounts instead start as profiles.status='pending' and
 *     are activated by an administrator)
 *  2. create profiles / user_roles / student|faculty_profiles rows
 *
 * If step 2 fails, the auth user is deleted again so retries start clean.
 * Roles are limited to student/faculty; super_admin cannot be created here.
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
  /** Whether the verification email was dispatched successfully. */
  emailSent?: boolean;
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
  // 2. Create the auth user AND send the verification email in one
  //    call. inviteUserByEmail creates the (unconfirmed) user when the
  //    email is new and dispatches the invite through Supabase's mailer.
  //    (admin.createUser alone NEVER sends mail, and generateLink()
  //    mints a link without sending — both were why no email arrived.)
  // ------------------------------------------------------------------
  const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    // The email link must bounce through our PKCE callback: it lands on
    // /api/auth/callback, which exchanges the code for a session and then
    // sends the user to the dashboard. Redirect origins not on the project's
    // allowlist are overridden by Supabase — add dev/prod origins in
    // Dashboard > Authentication > URL Configuration.
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/api/auth/callback?next=/`,
  });

  if (inviteError) {
    const message = inviteError.message ?? '';
    const status = (inviteError as { status?: number }).status;

    // GoTrue may have created the user before the mail send failed —
    // remove it so a retry starts clean. (inviteData is typed null on the
    // error path, but that typing is optimistic; re-read by email instead.)
    const { data: maybeUser } = await admin.auth.admin.listUsers({ perPage: 5 });
    const orphan = maybeUser?.users?.find((u) => u.email?.toLowerCase() === email);
    if (orphan) {
      await admin.auth.admin.deleteUser(orphan.id);
    }

    if (/already|registered|duplicate|confirmed/i.test(message)) {
      return fieldError('email', 'An account with this email already exists. Please sign in instead.');
    }
    if (status === 429 || /rate limit/i.test(message)) {
      return {
        success: false,
        error:
          'The email service is rate-limited right now (built-in mailer allows ~2 emails/hour). Please try again in a few minutes, or contact an administrator.',
      };
    }
    return { success: false, error: message || 'Failed to send the verification email. Please try again.' };
  }

  const userId = inviteData.user?.id;
  if (!userId) {
    return { success: false, error: 'Failed to create account.' };
  }

  // ------------------------------------------------------------------
  // 3. Apply the password chosen in the form. The invite email itself
  //    doesn't collect a password; after the user clicks the link their
  //    address is confirmed and this password works at /login.
  // ------------------------------------------------------------------
  const { error: passwordError } = await admin.auth.admin.updateUserById(userId, {
    password,
  });

  if (passwordError) {
    await admin.auth.admin.deleteUser(userId);
    return { success: false, error: 'Failed to set up the account. Please try again.' };
  }

  // ------------------------------------------------------------------
  // 4. Create the profile rows. On failure, roll the auth user back.
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

  return { success: true, emailSent: true };
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
