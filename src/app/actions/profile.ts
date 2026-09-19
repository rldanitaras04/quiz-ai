'use server';

import { createClient } from '@/lib/supabase/server';

export interface ProfileActionResult {
  error?: string;
  success?: boolean;
  avatar_path?: string | null;
}

const AVATAR_BUCKET = 'quiz-ai-bucket';
const AVATAR_FOLDER = 'avatar';
const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2 MB
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
 * `quiz-ai-bucket/avatar/<user_id>.<ext>` and record the path on the profile.
 * The bucket is public, so the client reads it by path directly.
 */
export async function uploadAvatar(
  file: File
): Promise<ProfileActionResult> {
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { error: 'Not authenticated' };

  if (!file || file.size === 0) return { error: 'No file provided' };
  if (file.size > MAX_AVATAR_BYTES) return { error: 'Image must be 2 MB or smaller' };
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
  const path = `${AVATAR_FOLDER}/${user.id}.${ext}`;

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
