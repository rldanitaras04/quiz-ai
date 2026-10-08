'use server';

import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { recordAuditLog } from '@/lib/audit';
import { validatePassword } from '@/lib/validators';
import { MAX_AVATAR_BYTES, MAX_AVATAR_SIZE_MB } from '@/lib/constants';
import { logger } from '@/lib/logger';

export interface ProfileActionResult {
  error?: string;
  success?: boolean;
  avatar_path?: string | null;
}

const AVATAR_BUCKET = 'quiz-ai-bucket';
const AVATAR_FOLDER = 'avatar';
const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

/**
 * Update the caller's own profile fields. `userId` is informational; the
 * server always uses the authenticated session's user id.
 */
export async function updateProfile(
  _userId: string,
  data: { full_name: string }
): Promise<ProfileActionResult> {
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { error: 'Not authenticated' };

  const fullName = data.full_name?.trim();
  if (!fullName) return { error: 'Name cannot be empty' };
  if (fullName.length > 120) return { error: 'Name is too long' };

  const { error } = await supabase
    .from('profiles')
    .update({ full_name: fullName, updated_at: new Date().toISOString() })
    .eq('id', user.id);

  if (error) return { error: error.message };

  return { success: true };
}

/**
 * Upload an avatar image for the logged-in user to
 * `quiz-ai-bucket/avatar/<user_id>/avatar.<ext>` and record the path on the
 * profile. The bucket is public, so the client reads it by path directly.
 * The `avatar/<uid>/` folder layout is required by the storage RLS policies,
 * which match on (storage.foldername(name))[2] = auth.uid() — foldername()
 * returns only folder segments, so the uid must be a folder, not a filename.
 */
export async function uploadAvatar(
  file: File
): Promise<ProfileActionResult> {
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { error: 'Not authenticated' };

  if (!file || file.size === 0) return { error: 'No file provided' };
  if (file.size > MAX_AVATAR_BYTES) {
    return { error: `Image must be ${MAX_AVATAR_SIZE_MB} MB or smaller` };
  }
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return { error: 'Only PNG, JPEG, WebP, or GIF images are allowed' };
  }

  const ext = file.type === 'image/png'
    ? 'png'
    : file.type === 'image/webp'
      ? 'webp'
      : file.type === 'image/gif'
        ? 'gif'
        : 'jpg';
  const path = `${AVATAR_FOLDER}/${user.id}/avatar.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(path, file, {
      cacheControl: '0',
      upsert: true, // same user re-uploading replaces their avatar
    });

  if (uploadError) {
    return { error: `Upload failed: ${uploadError.message}` };
  }

  // If the extension changed (e.g. jpg → png), remove the stale file so the
  // profile doesn't point at a deleted object.
  const { data: profile } = await supabase
    .from('profiles')
    .select('avatar_path')
    .eq('id', user.id)
    .single();

  const oldPath = profile?.avatar_path;
  if (oldPath && oldPath !== path) {
    await supabase.storage.from(AVATAR_BUCKET).remove([oldPath]);
  }

  const { error: updateError } = await supabase
    .from('profiles')
    .update({ avatar_path: path, updated_at: new Date().toISOString() })
    .eq('id', user.id);

  if (updateError) {
    return { error: `Upload succeeded but saving the path failed: ${updateError.message}` };
  }

  return { success: true, avatar_path: path };
}

/**
 * Remove the caller's avatar object and clear the profile pointer.
 */
export async function deleteAvatar(): Promise<ProfileActionResult> {
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { error: 'Not authenticated' };

  const { data: profile } = await supabase
    .from('profiles')
    .select('avatar_path')
    .eq('id', user.id)
    .single();

  const path = profile?.avatar_path;
  if (path) {
    const { error: removeError } = await supabase.storage
      .from(AVATAR_BUCKET)
      .remove([path]);
    if (removeError) return { error: `Failed to delete image: ${removeError.message}` };
  }

  const { error: updateError } = await supabase
    .from('profiles')
    .update({ avatar_path: null, updated_at: new Date().toISOString() })
    .eq('id', user.id);

  if (updateError) return { error: updateError.message };

  return { success: true };
}

/**
 * Change the caller's password, but only after re-proving they know the
 * CURRENT one.
 *
 * GoTrue has no "check this password" endpoint — proving a password means a
 * password grant, which mints a session. So the check runs on a THROWAWAY,
 * non-persisting anon client: it never reads or writes the caller's auth
 * cookies and never rotates their real refresh token. The session that
 * grant creates is revoked immediately afterwards with `scope=local`
 * (only that throwaway session), so the account is not left holding a
 * phantom device. Only once both steps succeed is the new password written
 * through the caller's own session with `updateUser`, and the change is
 * written to the audit log.
 */
export async function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<ProfileActionResult> {
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { error: 'Not authenticated' };
  if (!user.email) return { error: 'This account has no email address on file.' };

  const current = String(currentPassword ?? '');
  const next = String(newPassword ?? '');

  if (!current) return { error: 'Enter your current password.' };
  if (!next) return { error: 'Enter a new password.' };

  const check = validatePassword(next);
  if (!check.success) {
    const messages = [...new Set(check.errors.map((e) => e.message))];
    return { error: messages[0] };
  }
  if (next === current) return { error: 'The new password must differ from your current one.' };

  // ---- 1. Verify the current password (throwaway client, no side effects).
  const verifier = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }
  );

  const { data: verifyData, error: verifyError } = await verifier.auth.signInWithPassword({
    email: user.email,
    password: current,
  });

  if (verifyError) {
    const message = verifyError.message ?? '';
    const status = (verifyError as { status?: number }).status;
    if (/invalid login credentials/i.test(message)) {
      return { error: 'Your current password is incorrect.' };
    }
    if (status === 429 || /rate limit/i.test(message)) {
      return { error: 'Too many attempts — wait a minute and try again.' };
    }
    logger.error('Password verification failed:', message);
    return { error: 'Could not verify your current password right now. Please try again.' };
  }

  // ---- 2. Do not leave the verification session behind as a device.
  const throwaway = verifyData.session;
  if (throwaway) {
    try {
      await createAdminClient().auth.admin.signOut(throwaway.access_token, 'local');
    } catch (err) {
      // Best-effort: an orphaned session still expires on its own.
      logger.warn(
        'Could not revoke password-verification session:',
        err instanceof Error ? err.message : err
      );
    }
  }

  // ---- 3. Set the new password through the caller's real session.
  const { error: updateError } = await supabase.auth.updateUser({ password: next });

  if (updateError) {
    const message = updateError.message ?? '';
    if (/different from the old|same password/i.test(message)) {
      return { error: 'The new password must differ from your current one.' };
    }
    if (/password/i.test(message)) {
      return { error: message };
    }
    logger.error('Password update failed:', message);
    return { error: 'Failed to update the password. Please try again.' };
  }

  await recordAuditLog({
    actorUserId: user.id,
    action: 'update',
    entityType: 'profile',
    entityId: user.id,
    metadata: { password_changed: true },
  });

  return { success: true };
}
