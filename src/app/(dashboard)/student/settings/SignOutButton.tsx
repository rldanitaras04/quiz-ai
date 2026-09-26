'use client';

import type { JSX } from 'react';
import Button from '@/components/ui/Button';
import { useSignOut } from '@/lib/hooks';

export default function SignOutButton(): JSX.Element {
  const { signOut, signingOut } = useSignOut();

  return (
    <Button variant="secondary" onClick={signOut} disabled={signingOut} loading={signingOut}>
      {signingOut ? 'Signing out…' : 'Sign out'}
    </Button>
  );
}
