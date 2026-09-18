import Link from "next/link";

export default function RegisterSuccessPage() {
  return (
    <div className="rounded-xl bg-[var(--color-surface)] p-8 text-center shadow-lg">
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[var(--color-success-light)]">
        <svg
          className="h-8 w-8 text-[var(--color-success)]"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
          />
        </svg>
      </div>

      <h2 className="text-xl font-semibold text-[var(--color-foreground)]">
        Check your email
      </h2>
      <p className="mt-2 text-sm text-[var(--color-muted)]">
        We&apos;ve sent a verification link to your email address. Please check
        your inbox and click the link to activate your account.
      </p>

      <div className="mt-6 space-y-3">
        <p className="text-xs text-[var(--color-muted)]">
          Didn&apos;t receive the email? Check your spam folder or contact
          support.
        </p>

        <Link
          href="/login"
          className="inline-block rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--color-primary-hover)]"
        >
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
