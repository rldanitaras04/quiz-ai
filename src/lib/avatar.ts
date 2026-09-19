const AVATAR_BUCKET = 'quiz-ai-bucket';

/**
 * Resolve an avatar storage path to its public URL. The quiz-ai-bucket is
 * public, so objects are addressable without signed URLs. Returns null when
 * no path is set or the env base URL is unavailable.
 */
export function getAvatarUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  return `${base}/storage/v1/object/public/${AVATAR_BUCKET}/${path}`;
}
