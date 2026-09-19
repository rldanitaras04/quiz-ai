import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

/**
 * SECURITY MODEL
 * --------------
 * - `create_admin` is only permitted while NO super_admin exists yet
 *   (initial self-host bootstrap window). Once an admin exists, this
 *   endpoint can no longer mint new ones.
 * - `promote_to_admin`, `diagnose`, and `run_migration` require an
 *   authenticated, active super_admin session.
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

      const { error: roleError } = await supabase
        .from('user_roles')
        .insert({ user_id: userData.user.id, role: 'super_admin' });

      if (roleError) {
        return NextResponse.json({ error: roleError.message }, { status: 500 });
      }

      // The auth trigger already creates the profiles row; add faculty profile.
      await supabase.from('faculty_profiles').insert({ user_id: userData.user.id });

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

    if (action === 'run_migration') {
      const supabase = createAdminClient();

      const migrationSQL = `
        CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
        CREATE EXTENSION IF NOT EXISTS "vector";
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_name = 'profiles'
        ) as migration_applied;
      `;

      const { data, error } = await supabase.rpc('exec_sql', { sql: migrationSQL }).single();

      if (error) {
        return NextResponse.json(
          {
            error: 'Migration check failed. Please run the SQL migration manually from the SQL Editor.',
            details: error.message,
          },
          { status: 500 }
        );
      }

      return NextResponse.json({ success: true, data });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
