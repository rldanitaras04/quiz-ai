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
    // create_test_student: fixed ready-to-use student for local testing.
    // Allowed without a session (same setup-wizard surface as check_env):
    // credentials are fixed and shown on /setup, and the role is not
    // privileged. Always leaves email confirmed + verification_status verified.
    // ------------------------------------------------------------------
    if (action === 'create_test_student') {
      const supabase = createAdminClient();
      const email = 'student@test.com';
      const password = 'Student123!';
      const fullName = 'Test Student';

      const ensureVerifiedStudent = async (userId: string): Promise<void> => {
        // Confirm email so password login works without a confirmation click.
        const { data: authUser } = await supabase.auth.admin.getUserById(userId);
        if (authUser?.user && !authUser.user.email_confirmed_at) {
          await supabase.auth.admin.updateUserById(userId, { email_confirm: true });
        }

        await supabase.from('profiles').upsert(
          { id: userId, email, full_name: fullName, status: 'active' },
          { onConflict: 'id' }
        );

        const { data: roles } = await supabase
          .from('user_roles')
          .select('id')
          .eq('user_id', userId)
          .eq('role', 'student')
          .maybeSingle();
        if (!roles) {
          await supabase.from('user_roles').insert({ user_id: userId, role: 'student' });
        }

        const [{ data: program }, { data: yearLevel }] = await Promise.all([
          supabase.from('programs').select('id').eq('code', 'BSIT').maybeSingle(),
          supabase.from('year_levels').select('id').eq('name', '2nd Year').maybeSingle(),
        ]);

        let sectionId: string | null = null;
        if (program && yearLevel) {
          // Deterministic pick: BSIT/2nd Year normally has several sections
          // (AI/NT/WM) and a bare maybeSingle() errors on >1 row, which
          // silently left section_id null. Order by name so re-runs agree.
          const { data: section } = await supabase
            .from('sections')
            .select('id')
            .eq('program_id', program.id)
            .eq('year_level_id', yearLevel.id)
            .order('name', { ascending: true })
            .limit(1)
            .maybeSingle();
          sectionId = section?.id ?? null;
        }

        const { data: existingProfile } = await supabase
          .from('student_profiles')
          .select('user_id')
          .eq('user_id', userId)
          .maybeSingle();

        if (existingProfile) {
          await supabase
            .from('student_profiles')
            .update({
              verification_status: 'verified',
              program_id: program?.id ?? null,
              year_level_id: yearLevel?.id ?? null,
              section_id: sectionId,
              updated_at: new Date().toISOString(),
            })
            .eq('user_id', userId);
        } else {
          await supabase.from('student_profiles').insert({
            user_id: userId,
            student_number: '2024-TEST-001',
            program_id: program?.id ?? null,
            year_level_id: yearLevel?.id ?? null,
            section_id: sectionId,
            verification_status: 'verified',
          });
        }

        // Section-scoped enrollment: the test student sees exactly their
        // section's offerings. The old version enrolled into EVERY active
        // offering, so one subject showed up once per section on My Subjects.
        // This also normalizes previously-created rows on each re-run.
        if (sectionId) {
          const { data: offerings } = await supabase
            .from('subject_offerings')
            .select('id')
            .eq('section_id', sectionId)
            .eq('status', 'active');
          const sectionOfferingIds = new Set((offerings ?? []).map((o) => o.id));

          const { data: existingEnrollments } = await supabase
            .from('enrollments')
            .select('id, subject_offering_id, status')
            .eq('student_id', userId);
          const existing = existingEnrollments ?? [];
          const byOffering = new Map(
            existing.map((e) => [e.subject_offering_id, e] as const)
          );
          const now = new Date().toISOString();

          const toInsert = [...sectionOfferingIds]
            .filter((id) => !byOffering.has(id))
            .map((id) => ({
              subject_offering_id: id,
              student_id: userId,
              status: 'enrolled' as const,
              enrolled_at: now,
            }));
          const toReenroll = existing
            .filter((e) => sectionOfferingIds.has(e.subject_offering_id) && e.status !== 'enrolled')
            .map((e) => e.id);
          const toWithdraw = existing
            .filter((e) => !sectionOfferingIds.has(e.subject_offering_id) && e.status === 'enrolled')
            .map((e) => e.id);

          if (toInsert.length > 0) {
            await supabase.from('enrollments').insert(toInsert);
          }
          if (toReenroll.length > 0) {
            await supabase
              .from('enrollments')
              .update({ status: 'enrolled', enrolled_at: now, updated_at: now })
              .in('id', toReenroll);
          }
          if (toWithdraw.length > 0) {
            await supabase
              .from('enrollments')
              .update({ status: 'withdrawn', updated_at: now })
              .in('id', toWithdraw);
          }
        }
      };

      // Reuse an existing account and force it into a verified, usable state.
      const { data: existingUsers } = await supabase.auth.admin.listUsers();
      const existing = existingUsers?.users?.find(
        (u) => u.email?.toLowerCase() === email
      );
      if (existing) {
        await ensureVerifiedStudent(existing.id);
        return NextResponse.json({
          success: true,
          message: 'Test student already exists (verified and ready to use)',
          credentials: { email, password },
          userId: existing.id,
        });
      }

      const { data: userData, error: createError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });

      if (createError || !userData.user) {
        return NextResponse.json(
          { error: createError?.message || 'User creation failed' },
          { status: 500 }
        );
      }

      const userId = userData.user.id;
      const { error: profileError } = await supabase
        .from('profiles')
        .insert({ id: userId, email, full_name: fullName, status: 'active' });

      if (profileError) {
        await supabase.auth.admin.deleteUser(userId);
        return NextResponse.json({ error: profileError.message }, { status: 500 });
      }

      await ensureVerifiedStudent(userId);

      return NextResponse.json({
        success: true,
        message: 'Test student created successfully (verified)',
        credentials: { email, password },
        userId,
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

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
