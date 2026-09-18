import type { JSX, ReactNode } from 'react';

interface AuthLayoutProps {
  children: ReactNode;
}

export default function AuthLayout({ children }: AuthLayoutProps): JSX.Element {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-background)] px-4 py-12">
      <div className="w-full max-w-md">
        {children}
      </div>
    </div>
  );
}
