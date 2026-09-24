import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getPrimaryRole } from '@/lib/constants';
import Link from 'next/link';
import { Brand, BrandLogo } from '@/components/brand';
import type { JSX, ReactNode } from 'react';

export default async function Home(): Promise<JSX.Element> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    const { data: roles } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);

    const role = getPrimaryRole(roles?.map((r) => r.role) ?? []);

    if (role === 'super_admin') {
      redirect('/admin');
    } else if (role === 'faculty') {
      redirect('/faculty');
    } else {
      redirect('/student');
    }
  }

  return (
    <div className="min-h-screen relative">
      <div
        aria-hidden="true"
        className="fixed inset-0 -z-20 bg-[url('/seams_ai_bg.png')] bg-cover bg-center bg-no-repeat"
      />
      <div
        aria-hidden="true"
        className="fixed inset-0 -z-10 bg-[var(--color-background)]/75"
      />
      {/* Nav */}
      <nav className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-[var(--color-border)] bg-[var(--color-surface)]/80 backdrop-blur sticky top-0 z-20">
        <Link href="/" className="flex items-center gap-3" aria-label="SEAMS AI home">
          <Brand />
        </Link>
        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            href="/login"
            className="px-3 sm:px-4 py-2 text-sm font-medium text-[var(--color-foreground)] hover:text-[var(--color-primary)] transition-colors"
          >
            Sign In
          </Link>
          <Link
            href="/register"
            className="px-3 sm:px-4 py-2 text-sm font-medium text-white bg-[var(--color-primary)] rounded-lg hover:bg-[var(--color-primary-hover)] transition-colors"
          >
            Get Started
          </Link>
        </div>
      </nav>

      <main>
        {/* Hero */}
        <section className="px-4 sm:px-6 py-16 md:py-28 max-w-5xl mx-auto text-center">
          <div className="mb-8 flex justify-center">
            <BrandLogo className="h-24 sm:h-32 md:h-40 lg:h-48 w-auto max-w-full" alt="SEAMS AI" />
          </div>

          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--color-primary-light)] text-[var(--color-primary)] text-xs font-medium mb-6">
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
            </svg>
            Secure · Mobile-first · AI-grounded assessment
          </div>

          <h1 className="text-4xl md:text-6xl font-bold text-[var(--color-foreground)] tracking-tight leading-tight mb-6">
            Create Smarter Exams
            <br />
            <span className="text-[var(--color-primary)]">With AI Assistance</span>
          </h1>

          <p className="text-lg md:text-xl text-[var(--color-muted)] max-w-2xl mx-auto mb-10 leading-relaxed">
            Build blueprint-aligned assessments from your course materials, approve every draft,
            deploy securely per section, auto-score objective items, and improve teaching with
            item analysis — one connected workflow.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/register"
              className="px-8 py-3.5 text-base font-semibold text-white bg-[var(--color-primary)] rounded-lg hover:bg-[var(--color-primary-hover)] transition-colors shadow-lg shadow-[var(--color-primary)]/20"
            >
              Start Free
            </Link>
            <Link
              href="/login"
              className="px-8 py-3.5 text-base font-semibold text-[var(--color-foreground)] bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg hover:bg-[var(--color-surface-hover)] hover:border-[var(--color-border-strong)] transition-colors"
            >
              Sign In
            </Link>
          </div>
        </section>

        {/* Core features */}
        <section className="px-4 sm:px-6 py-16 border-t border-[var(--color-border)]">
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-10">
              <SectionEyebrow>Platform capabilities</SectionEyebrow>
              <h2 className="text-2xl md:text-3xl font-bold text-[var(--color-foreground)]">
                Everything in the assessment lifecycle
              </h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {FEATURES.map((f) => (
                <FeatureCard key={f.title} icon={f.icon} title={f.title} description={f.description} />
              ))}
            </div>
          </div>
        </section>

        {/* Stats */}
        <section className="px-4 sm:px-6 py-16 bg-[var(--color-surface)]/75 backdrop-blur-sm border-t border-[var(--color-border)]">
          <div className="max-w-5xl mx-auto">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
              <Stat number="3" label="Question Types" />
              <Stat number="6" label="Bloom's Levels" />
              <Stat number="3" label="Difficulty Tiers" />
              <Stat number="100%" label="Server-Scored" />
            </div>
          </div>
        </section>

        {/* Why SEAMS AI */}
        <section className="px-4 sm:px-6 py-16 border-t border-[var(--color-border)]">
          <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
            {WHY.map((item) => (
              <div key={item.title} className="p-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
                <h3 className="text-base font-semibold text-[var(--color-foreground)] mb-2">{item.title}</h3>
                <p className="text-sm text-[var(--color-muted)] leading-relaxed">{item.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="px-4 sm:px-6 py-20 border-t border-[var(--color-border)] bg-[var(--color-surface)]/75 backdrop-blur-sm">
          <div className="max-w-2xl mx-auto text-center">
            <div className="mb-6 flex justify-center">
              <BrandLogo className="h-16 sm:h-20 md:h-24" alt="SEAMS AI" />
            </div>
            <h2 className="text-3xl font-bold text-[var(--color-foreground)] mb-4">
              Ready to transform your assessments?
            </h2>
            <p className="text-[var(--color-muted)] mb-8 text-lg">
              Join faculty and students using a secure, AI-grounded assessment platform.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                href="/register"
                className="px-8 py-3.5 text-base font-semibold text-white bg-[var(--color-primary)] rounded-lg hover:bg-[var(--color-primary-hover)] transition-colors shadow-lg shadow-[var(--color-primary)]/20"
              >
                Create Your Account
              </Link>
              <Link
                href="/login"
                className="px-8 py-3.5 text-base font-semibold text-[var(--color-foreground)] bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg hover:bg-[var(--color-surface-hover)] hover:border-[var(--color-border-strong)] transition-colors"
              >
                Sign In
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="px-4 sm:px-6 py-8 border-t border-[var(--color-border)] bg-[var(--color-surface)]/75 backdrop-blur-sm text-center text-sm text-[var(--color-muted)]">
        <div className="mb-3 flex justify-center">
          <Brand />
        </div>
        <p>SEAMS AI &mdash; AI-Assisted Secure Assessment and Examination Management System</p>
      </footer>
    </div>
  );
}

const sparkIcon = (
  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
  </svg>
);

const docIcon = (
  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
  </svg>
);

const shieldIcon = (
  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
  </svg>
);

const chartIcon = (
  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
  </svg>
);

const cloudIcon = (
  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z" />
  </svg>
);

const lockIcon = (
  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
  </svg>
);

const FEATURES: { icon: ReactNode; title: string; description: string }[] = [
  {
    icon: docIcon,
    title: 'Source-grounded generation',
    description:
      'Upload PDF, DOCX, PPTX, and text. Chunked embeddings retrieve only authorized sources so every AI item stays traceable to your material.',
  },
  {
    icon: sparkIcon,
    title: 'TOS + quality pipeline',
    description:
      'Generate and approve a Table of Specifications, then run duplicate, similarity, grounding, and Bloom/difficulty checks before faculty review.',
  },
  {
    icon: lockIcon,
    title: 'Secure examinations',
    description:
      'Answer keys never ship to the browser. Randomized manifests, server-authoritative timing, auto-save/offline queue, and integrity review signals.',
  },
  {
    icon: shieldIcon,
    title: 'Versioned approval',
    description:
      'Draft → Reviewed → Approved → Published lifecycle with immutable history once attempts exist — faculty always has the final say.',
  },
  {
    icon: cloudIcon,
    title: 'Deploy & schedule per section',
    description:
      'Reuse one assessment across offerings with independent open/close windows, attempt limits, pools, score-release policy, and student exceptions.',
  },
  {
    icon: chartIcon,
    title: 'Analytics & question bank',
    description:
      'Auto-score MCQ/identification, release results on your terms, and improve items with difficulty, discrimination, and distractor analysis.',
  },
];

const WHY = [
  {
    title: 'Faculty-owned quality',
    body: 'AI proposes; faculty approves. Every draft, modification, and score release is reviewable — never silently committed.',
  },
  {
    title: 'Defense in depth',
    body: 'RLS, answer-key isolation, server-side scoring, audit logs, and optional face/liveness verification for protected exams.',
  },
  {
    title: 'Mobile-first PWA',
    body: 'Clear touch targets, low-bandwidth exam UI, offline answer persistence with re-sync when connectivity returns.',
  },
] as const;

function SectionEyebrow({ children }: { children: ReactNode }): JSX.Element {
  return (
    <p className="inline-block mb-3 px-3 py-1 rounded-full bg-[var(--color-primary-light)] text-[var(--color-primary)] text-xs font-semibold uppercase tracking-wide">
      {children}
    </p>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}): JSX.Element {
  return (
    <div className="p-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] hover:shadow-lg hover:border-[var(--color-primary)]/20 transition-all h-full">
      <div className="w-12 h-12 rounded-lg bg-[var(--color-primary-light)] text-[var(--color-primary)] flex items-center justify-center mb-4">
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-[var(--color-foreground)] mb-2">{title}</h3>
      <p className="text-sm text-[var(--color-muted)] leading-relaxed">{description}</p>
    </div>
  );
}

function Stat({ number, label }: { number: string; label: string }): JSX.Element {
  return (
    <div>
      <div className="text-3xl font-bold text-[var(--color-primary)]">{number}</div>
      <div className="text-sm text-[var(--color-muted)] mt-1">{label}</div>
    </div>
  );
}
