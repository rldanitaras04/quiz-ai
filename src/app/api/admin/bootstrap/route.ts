import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

/**
 * SECURITY MODEL
 * --------------
 * - `create_admin` is only permitted while NO super_admin exists yet
 *   (initial self-host bootstrap window). Once an admin exists, this
 *   endpoint can no longer mint new ones.
 * - `promote_to_admin` and `diagnose` require an authenticated, active
 *   super_admin session.
 *
 * There is deliberately no SQL-execution action: schema changes are applied
 * with `supabase db push`, not through an HTTP endpoint.
 * - This route must never trust client input for authorization decisions.
 */

async function requireSuperAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { error: 'Unauthorized' as const };
  }

  const { data: roles } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id);

  const isAdmin = roles?.some((r) => r.role === 'super_admin');
  if (!isAdmin) {
    return { error: 'Forbidden: super_admin access required' as const };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('status')
    .eq('id', user.id)
    .single();

  if (profile && profile.status === 'suspended') {
    return { error: 'Forbidden: account suspended' as const };
  }

  return { userId: user.id };
}

async function anySuperAdminExists(): Promise<boolean> {
  const adminClient = createAdminClient();
  const { data } = await adminClient
    .from('user_roles')
    .select('user_id')
    .eq('role', 'super_admin')
    .limit(1);
  return (data?.length ?? 0) > 0;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const action = body?.action;

    // ------------------------------------------------------------------
    // check_env: report which env vars are configured (no secrets)
    // ------------------------------------------------------------------
    if (action === 'check_env') {
      const missing: string[] = [];
      if (!process.env.NEXT_PUBLIC_SUPABASE_URL) missing.push('NEXT_PUBLIC_SUPABASE_URL');
      if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) missing.push('NEXT_PUBLIC_SUPABASE_ANON_KEY');
      if (!process.env.SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
      return NextResponse.json({
        success: missing.length === 0,
        missing,
        ai: {
          openai: !!process.env.OPENAI_API_KEY,
          groq: !!process.env.GROQ_API_KEY,
        },
      });
    }

    // ------------------------------------------------------------------
    // create_admin: ONLY during bootstrap (no super_admin exists yet)
    // ------------------------------------------------------------------
    if (action === 'create_admin') {
      const { email, password, fullName } = body ?? {};

      if (typeof email !== 'string' || typeof password !== 'string' || typeof fullName !== 'string') {
        return NextResponse.json({ error: 'email, password and fullName are required' }, { status: 400 });
      }
      if (password.length < 8) {
        return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
      }

      if (await anySuperAdminExists()) {
        return NextResponse.json(
          { error: 'Forbidden: an administrator already exists. Bootstrap is closed.' },
          { status: 403 }
        );
      }

      const supabase = createAdminClient();

      const { data: userData, error: createError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });

      if (createError) {
        return NextResponse.json({ error: createError.message }, { status: 400 });
      }

      if (!userData.user) {
        return NextResponse.json({ error: 'User creation failed' }, { status: 500 });
      }

      const adminUserId = userData.user.id;

      // Create the profiles row FIRST. There is no trigger on auth.users in this
      // project, and both user_roles.user_id and faculty_profiles.user_id carry
      // a FK to profiles(id) — inserting the role before the profile fails with
      // a foreign-key violation and leaves an auth user with no profile at all.
      const { error: profileError } = await supabase
        .from('profiles')
        .insert({
          id: adminUserId,
          email,
          full_name: fullName,
          status: 'active',
        });

      if (profileError) {
        await supabase.auth.admin.deleteUser(adminUserId);
        return NextResponse.json(
          { error: profileError.message, details: 'Failed to create admin profile' },
          { status: 500 }
        );
      }

      const { error: roleError } = await supabase
        .from('user_roles')
        .insert({ user_id: adminUserId, role: 'super_admin' });

      if (roleError) {
        await supabase.auth.admin.deleteUser(adminUserId);
        return NextResponse.json({ error: roleError.message }, { status: 500 });
      }

      // Optional: admins may also be assigned to offerings, so give them the
      // faculty profile row. Not fatal if it fails.
      await supabase.from('faculty_profiles').insert({ user_id: adminUserId });

      return NextResponse.json({
        success: true,
        user: { id: userData.user.id, email: userData.user.email },
      });
    }

    // ------------------------------------------------------------------
    // All remaining actions require an authenticated super_admin
    // ------------------------------------------------------------------
    const auth = await requireSuperAdmin();
    if ('error' in auth) {
      return NextResponse.json(
        { error: auth.error },
        { status: auth.error === 'Unauthorized' ? 401 : 403 }
      );
    }

    if (action === 'promote_to_admin') {
      const { userId } = body ?? {};

      if (typeof userId !== 'string' || !userId) {
        return NextResponse.json({ error: 'userId is required' }, { status: 400 });
      }

      const supabase = createAdminClient();
      const { data: existing } = await supabase
        .from('user_roles')
        .select('id')
        .eq('user_id', userId)
        .eq('role', 'super_admin')
        .maybeSingle();

      if (existing) {
        return NextResponse.json({ success: true, message: 'Already an admin' });
      }

      const { error } = await supabase
        .from('user_roles')
        .insert({ user_id: userId, role: 'super_admin' });

      if (error) {
        return NextResponse.json(
          { error: error.message, details: 'Failed to insert super_admin role' },
          { status: 500 }
        );
      }

      return NextResponse.json({ success: true });
    }

    if (action === 'diagnose') {
      const { userId } = body ?? {};

      if (typeof userId !== 'string' || !userId) {
        return NextResponse.json({ error: 'userId is required' }, { status: 400 });
      }

      const supabase = createAdminClient();
      const [profileResult, rolesResult] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
        supabase.from('user_roles').select('*').eq('user_id', userId),
      ]);

      return NextResponse.json({
        profile: profileResult.data,
        profileError: profileResult.error?.message,
        roles: rolesResult.data,
        rolesError: rolesResult.error?.message,
        adminClientUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      });
    }

    // ------------------------------------------------------------------
    // create_test_student: Creates a ready-to-use test student account
    // ------------------------------------------------------------------
    if (action === 'create_test_student') {
      const supabase = createAdminClient();
      const email = 'student@test.com';
      const password = 'Student123!';
      const fullName = 'Test Student';

      // Check if test student already exists
      const { data: existingUsers } = await supabase.auth.admin.listUsers();
      const existing = existingUsers?.users?.find((u) => u.email === email);
      if (existing) {
        return NextResponse.json({
          success: true,
          message: 'Test student already exists',
          credentials: { email, password },
          userId: existing.id,
        });
      }

      // Create auth user
      const { data: userData, error: createError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });

      if (createError || !userData.user) {
        return NextResponse.json({ error: createError?.message || 'User creation failed' }, { status: 500 });
      }

      const userId = userData.user.id;

      // Create profile
      const { error: profileError } = await supabase
        .from('profiles')
        .insert({ id: userId, email, full_name: fullName, status: 'active' });

      if (profileError) {
        await supabase.auth.admin.deleteUser(userId);
        return NextResponse.json({ error: profileError.message }, { status: 500 });
      }

      // Create student role
      await supabase.from('user_roles').insert({ user_id: userId, role: 'student' });

      // Get BSIT program and 2nd Year level
      const [{ data: program }, { data: yearLevel }] = await Promise.all([
        supabase.from('programs').select('id').eq('code', 'BSIT').maybeSingle(),
        supabase.from('year_levels').select('id').eq('name', '2nd Year').maybeSingle(),
      ]);

      // Get or create a section
      let sectionId = null;
      if (program && yearLevel) {
        const { data: section } = await supabase
          .from('sections')
          .select('id')
          .eq('program_id', program.id)
          .eq('year_level_id', yearLevel.id)
          .maybeSingle();
        sectionId = section?.id ?? null;
      }

      // Create student profile
      await supabase.from('student_profiles').insert({
        user_id: userId,
        student_number: '2024-TEST-001',
        program_id: program?.id ?? null,
        year_level_id: yearLevel?.id ?? null,
        section_id: sectionId,
        verification_status: 'verified',
      });

      // Enroll in all active subject offerings for OOP1
      const { data: offerings } = await supabase
        .from('subject_offerings')
        .select('id')
        .eq('status', 'active');

      if (offerings && offerings.length > 0) {
        const enrollments = offerings.map((o) => ({
          subject_offering_id: o.id,
          student_id: userId,
          status: 'enrolled' as const,
          enrolled_at: new Date().toISOString(),
        }));
        await supabase.from('enrollments').insert(enrollments);
      }

      return NextResponse.json({
        success: true,
        message: 'Test student created successfully',
        credentials: { email, password },
        userId,
      });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
