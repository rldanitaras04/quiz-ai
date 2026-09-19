'use client';

import { useState, useRef, type JSX } from 'react';
import { useRouter } from 'next/navigation';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import {
  updateProfile,
  uploadAvatar,
  deleteAvatar,
} from '@/app/actions/profile';

interface ProfileFormProps {
  userId: string;
  fullName: string;
  avatarPath: string | null;
}

const AVATAR_BUCKET = 'quiz-ai-bucket';

function avatarUrl(path: string | null): string | null {
  if (!path) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  return `${base}/storage/v1/object/public/${AVATAR_BUCKET}/${path}`;
}

export default function ProfileForm({ userId, fullName, avatarPath }: ProfileFormProps): JSX.Element {
  const router = useRouter();
  const [name, setName] = useState(fullName);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [avatar, setAvatar] = useState<string | null>(avatarPath);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Cache-busting version for the avatar URL. Derived during render rather than
  // copied into state from an effect (which caused a cascading extra render),
  // and bumped whenever an upload or removal changes the stored object.
  const [avatarVersion, setAvatarVersion] = useState(0);
  const avatarHref = avatarUrl(avatar);
  const avatarUrlState = avatarHref ? `${avatarHref}?v=${avatarVersion}` : null;

  const initials = name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const handleNameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);

    const result = await updateProfile(userId, { full_name: name });

    if (result.error) {
      setError(result.error);
    } else {
      setSuccess(true);
      router.refresh(); // re-renders the layout → header name updates too
      setTimeout(() => setSuccess(false), 3000);
    }

    setLoading(false);
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;

    setAvatarBusy(true);
    setAvatarError(null);

    const result = await uploadAvatar(file);
    if (result.error) {
      setAvatarError(result.error);
    } else if (result.avatar_path) {
      setAvatar(result.avatar_path);
      setAvatarVersion(Date.now());
      router.refresh();
    }

    setAvatarBusy(false);
  };

  const handleAvatarRemove = async () => {
    setAvatarBusy(true);
    setAvatarError(null);

    const result = await deleteAvatar();
    if (result.error) {
      setAvatarError(result.error);
    } else {
      setAvatar(null);
      setAvatarVersion(Date.now());
      router.refresh();
    }

    setAvatarBusy(false);
  };

  return (
    <div className="space-y-6">
      {/* Avatar */}
      <div className="flex items-center gap-4">
        <div className="relative h-20 w-20 flex-shrink-0">
          {avatarUrlState ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarUrlState}
              alt="Avatar"
              className="h-20 w-20 rounded-full object-cover border border-[var(--color-border)]"
            />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[var(--color-primary-light)] text-lg font-semibold text-[var(--color-primary)]">
              {initials || '?'}
            </div>
          )}
          {avatarBusy && (
            <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40">
              <Spinner size="sm" />
            </div>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={avatarBusy}
            >
              Upload Avatar
            </Button>
            {avatar && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleAvatarRemove}
                disabled={avatarBusy}
              >
                Remove
              </Button>
            )}
          </div>
          <p className="text-xs text-[var(--color-muted)]">
            PNG, JPEG, WebP, or GIF · max 2 MB
          </p>
          {avatarError && (
            <p className="text-sm text-[var(--color-danger)]">{avatarError}</p>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={handleAvatarChange}
        />
      </div>

      {/* Name */}
      <form onSubmit={handleNameSubmit} className="space-y-4">
        <Input
          label="Full Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
        {success && <p className="text-sm text-[var(--color-success)]">Profile updated successfully.</p>}
        <Button type="submit" loading={loading}>Save Changes</Button>
      </form>
    </div>
  );
}
