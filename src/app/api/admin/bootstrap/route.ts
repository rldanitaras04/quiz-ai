import { NextResponse } from 'next/server';
import { toInternalError } from '@/lib/api-error';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import {
  checkRequiredEnv,
  isBootstrapWindowAction,
  isPublicAction,
  parseCreateAdminInput,
  parseUserId,
} from '@/lib/bootstrap-policy';

/**
 * SECURITY MODEL
 * --------------
 * - `check_env` is public: the /setup wizard calls it before any account
 *   exists. It reports only whether the required Supabase env vars are set —
 *   never their values, and nothing about the deployment beyond that.
 * - `create_admin` is only permitted while NO super_admin exists yet
 *   (initial self-host bootstrap window). Once an admin exists, this
 *   endpoint can no longer mint new ones. Credentials always come from the
 *   request body; this file must never carry a default account.
 * - `promote_to_admin` and `diagnose` require an authenticated, active
 *   super_admin session.
 *
 * The set of actions handled above the auth gate is asserted by
 * `tests/bootstrap-auth.test.mjs` against src/lib/bootstrap-policy.ts — adding
 * an action there without updating the policy fails the unit suite.
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
    // A malformed body is the caller's mistake, not a server failure. Answering
    // 400 keeps this unauthenticated endpoint from being able to manufacture 5xx
    // responses (and the error-log noise that comes with them) with junk input,
    // and leaves the catch below for genuinely unexpected faults.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 });
    }
    const action = (body as Record<string, unknown> | null)?.action;

    // ------------------------------------------------------------------
    // check_env: report which required env vars are missing (no values, no
    // secrets, no AI-provider recon). Public: the setup wizard needs it
    // before the first admin account exists.
    // ------------------------------------------------------------------
    if (isPublicAction(action)) {
      return NextResponse.json(checkRequiredEnv());
    }

    // ------------------------------------------------------------------
    // create_admin: ONLY during bootstrap (no super_admin exists yet)
    // ------------------------------------------------------------------
    if (isBootstrapWindowAction(action)) {
      const parsed = parseCreateAdminInput(body);
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
      }
      const { email, password, fullName } = parsed.value;

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
        return NextResponse.json(toInternalError(profileError, 'Admin profile creation'), {
          status: 500,
        });
      }

      const { error: roleError } = await supabase
        .from('user_roles')
        .insert({ user_id: adminUserId, role: 'super_admin' });

      if (roleError) {
        await supabase.auth.admin.deleteUser(adminUserId);
        return NextResponse.json(toInternalError(roleError, 'super_admin role insert'), { status: 500 });
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
      const parsed = parseUserId(body);
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
      }

      const supabase = createAdminClient();
      const { data: existing } = await supabase
        .from('user_roles')
        .select('id')
        .eq('user_id', parsed.value)
        .eq('role', 'super_admin')
        .maybeSingle();

      if (existing) {
        return NextResponse.json({ success: true, message: 'Already an admin' });
      }

      const { error } = await supabase
        .from('user_roles')
        .insert({ user_id: parsed.value, role: 'super_admin' });

      if (error) {
        return NextResponse.json(toInternalError(error, 'super_admin promotion'), { status: 500 });
      }

      return NextResponse.json({ success: true });
    }

    if (action === 'diagnose') {
      const parsed = parseUserId(body);
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
      }

      const supabase = createAdminClient();
      const [profileResult, rolesResult] = await Promise.all([
        supabase.from('profiles').select('id, email, full_name, status').eq('id', parsed.value).maybeSingle(),
        supabase.from('user_roles').select('id, user_id, role').eq('user_id', parsed.value),
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
    return NextResponse.json(toInternalError(error, 'Bootstrap request'), { status: 500 });
  }
}
