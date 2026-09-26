import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getPrimaryRole } from '@/lib/constants';
import Link from 'next/link';
import { Brand, BrandIcon, BrandLogo } from '@/components/brand';
import { SectionNav } from '@/components/landing/SectionNav';
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
        className="fixed inset-0 -z-10 bg-[var(--color-background)]/55"
      />

      <div className="sticky top-0 z-30 px-3 pt-3 sm:px-6 sm:pt-5">
        <nav className="mx-auto flex max-w-7xl items-center justify-between gap-4 rounded-2xl border border-[var(--color-border)]/60 bg-[var(--color-surface)]/90 px-4 py-2.5 shadow-lg shadow-slate-900/5 backdrop-blur sm:px-5">
          <Link href="/" className="shrink-0" aria-label="SEAMS AI home">
            <Brand />
          </Link>
          <SectionNav />
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <Link
              href="/login"
              className="rounded-xl border border-[var(--color-primary)]/70 px-3 py-2 text-sm font-semibold text-[var(--color-primary)] transition-colors hover:bg-[var(--color-primary-light)] sm:px-4"
            >
              Sign In
            </Link>
            <Link
              href="/register"
              className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--color-primary)] px-3 py-2 text-sm font-semibold text-white shadow-md shadow-[var(--color-primary)]/25 transition-colors hover:bg-[var(--color-primary-hover)] sm:px-4"
            >
              Get Started
              {arrowRightIcon}
            </Link>
          </div>
        </nav>
      </div>

      <main>
        {/* Hero */}
        <section
          id="home"
          className="mx-auto grid max-w-7xl scroll-mt-28 items-center gap-12 px-4 pb-16 pt-10 sm:px-6 lg:grid-cols-2 lg:gap-6 lg:pb-24 lg:pt-16"
        >
          <div className="text-center lg:text-left">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[var(--color-primary)]/15 bg-[var(--color-surface)]/85 px-4 py-1.5 text-xs font-semibold text-[var(--color-primary)] backdrop-blur sm:text-sm">
              {shieldCheckIcon}
              Secure &middot; AI-Powered &middot; Academic Focused
            </div>

            <h1 className="mb-6 text-4xl font-bold leading-[1.08] tracking-tight text-[var(--color-foreground)] sm:text-5xl xl:text-6xl">
              Create Smarter Exams
              <span className="block text-[var(--color-primary)]">With AI Assistance</span>
            </h1>

            <p className="mx-auto mb-9 max-w-xl text-base leading-relaxed text-[var(--color-muted)] sm:text-lg lg:mx-0">
              Build blueprint-aligned assessments from your course materials, approve every draft,
              deploy securely per section, auto-score objective items, and improve teaching with
              item analysis &mdash; all in one connected platform.
            </p>

            <div className="flex flex-col items-center justify-center gap-3 sm:flex-row lg:justify-start">
              <Link
                href="/register"
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--color-primary)] px-7 py-3.5 text-sm font-semibold text-white shadow-lg shadow-[var(--color-primary)]/25 transition-colors hover:bg-[var(--color-primary-hover)] sm:w-auto sm:text-base"
              >
                Get Started
                {arrowRightIcon}
              </Link>
              <Link
                href="/login"
                className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-7 py-3.5 text-sm font-semibold text-[var(--color-foreground)] shadow-sm transition-colors hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-hover)] sm:w-auto sm:text-base"
              >
                Sign In
              </Link>
            </div>

            <ul className="mt-7 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[13px] font-medium text-[var(--color-muted)] lg:justify-start">
              {HERO_POINTS.map((point) => (
                <li key={point} className="inline-flex items-center gap-1.5">
                  <span className="text-[var(--color-primary)]">{checkCircleIcon}</span>
                  {point}
                </li>
              ))}
            </ul>
          </div>

          {/* Product preview */}
          <div className="relative mx-auto w-full max-w-[560px] lg:max-w-none">
            <FloatingCard
              className="-left-1 top-[3%] lg:-left-4"
              icon={docIcon}
              tint="bg-blue-500/10 text-blue-600 dark:text-blue-400"
              label="AI Question Generation"
            />
            <FloatingCard
              className="left-0 top-[36%] lg:-left-8"
              icon={shieldIcon}
              tint="bg-blue-500/10 text-blue-600 dark:text-blue-400"
              label="Secure Examination"
            />
            <FloatingCard
              className="left-[4%] bottom-[6%] lg:left-0"
              icon={chartIcon}
              tint="bg-purple-500/10 text-purple-600 dark:text-purple-400"
              label="Analytics & Insights"
            />
            <FloatingCard
              className="-right-1 top-[1%] lg:-right-4"
              icon={bookIcon}
              tint="bg-blue-500/10 text-blue-600 dark:text-blue-400"
              label="Source Materials"
            />
            <FloatingCard
              className="right-0 top-[34%] lg:-right-8"
              icon={clipboardCheckIcon}
              tint="bg-blue-500/10 text-blue-600 dark:text-blue-400"
              label="TOS & Validation"
            />
            <FloatingCard
              className="right-[4%] bottom-[8%] lg:right-0"
              icon={peopleIcon}
              tint="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              label="Student Management"
            />
            <LaptopMock />
          </div>
        </section>

        {/* Core features */}
        <section id="features" className="mx-auto max-w-7xl scroll-mt-28 px-4 pb-16 sm:px-6 lg:pb-24">
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            {FEATURES.map((f) => (
              <FeatureCard
                key={f.title}
                icon={f.icon}
                tint={f.tint}
                title={f.title}
                description={f.description}
              />
            ))}
          </div>
        </section>

        {/* Audience */}
        <section className="border-y border-[var(--color-border)]/60 bg-[var(--color-surface)]/60 backdrop-blur-sm">
          <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:py-20">
            <div className="mb-10 text-center">
              <SectionEyebrow>Why SEAMS AI</SectionEyebrow>
              <h2 className="text-2xl font-bold text-[var(--color-foreground)] md:text-3xl">
                One platform for everyone in the assessment loop
              </h2>
            </div>
            <div className="grid gap-5 md:grid-cols-3">
              {WHY.map((item) => (
                <div
                  key={item.id}
                  id={item.id}
                  className="h-full scroll-mt-28 rounded-2xl border border-[var(--color-border)]/70 bg-[var(--color-surface)]/90 p-6 shadow-sm backdrop-blur"
                >
                  <h3 className="mb-2 text-base font-semibold text-[var(--color-foreground)]">
                    {item.title}
                  </h3>
                  <p className="text-sm leading-relaxed text-[var(--color-muted)]">{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* About */}
        <section id="about" className="scroll-mt-28 px-4 py-16 sm:px-6 lg:py-24">
          <div className="mx-auto grid max-w-7xl items-center gap-10 lg:grid-cols-2 lg:gap-16">
            <div>
              <SectionEyebrow>About SEAMS AI</SectionEyebrow>
              <h2 className="mb-5 text-2xl font-bold text-[var(--color-foreground)] md:text-3xl">
                AI-assisted assessment, built for academic integrity
              </h2>
              <p className="mb-4 text-[15px] leading-relaxed text-[var(--color-muted)]">
                SEAMS AI is an AI-Assisted Secure Examination and Assessment Management System for
                schools and universities. It connects the whole assessment lifecycle &mdash; source
                materials, Table of Specifications, question generation, faculty approval, secure
                deployment, results, and analytics &mdash; in one platform.
              </p>
              <p className="text-[15px] leading-relaxed text-[var(--color-muted)]">
                From day-to-day quizzes to high-stakes examinations, SEAMS AI helps institutions
                move faster without giving up control &mdash; secure by design, mobile-first, and
                grounded in the materials you already teach from.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4 sm:gap-5">
              {ABOUT_STATS.map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-2xl border border-[var(--color-border)]/70 bg-[var(--color-surface)]/90 p-5 text-center shadow-sm backdrop-blur sm:p-6"
                >
                  <div className="text-3xl font-bold text-[var(--color-primary)] sm:text-4xl">
                    {stat.value}
                  </div>
                  <div className="mt-1.5 text-sm text-[var(--color-muted)]">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section
          className="px-4 py-16 sm:px-6 lg:py-24"
        >
          <div className="mx-auto max-w-2xl text-center">
            <div className="mb-6 flex justify-center">
              <BrandLogo className="h-9 sm:h-11 md:h-14" alt="SEAMS AI" />
            </div>
            <h2 className="mb-4 text-3xl font-bold text-[var(--color-foreground)]">
              Ready to transform your assessments?
            </h2>
            <p className="mb-8 text-lg text-[var(--color-muted)]">
              Join faculty and students using a secure, AI-grounded assessment platform.
            </p>
            <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/register"
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--color-primary)] px-7 py-3.5 text-sm font-semibold text-white shadow-lg shadow-[var(--color-primary)]/25 transition-colors hover:bg-[var(--color-primary-hover)] sm:w-auto sm:text-base"
              >
                Create Your Account
                {arrowRightIcon}
              </Link>
              <Link
                href="/login"
                className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-7 py-3.5 text-sm font-semibold text-[var(--color-foreground)] shadow-sm transition-colors hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-hover)] sm:w-auto sm:text-base"
              >
                Sign In
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-[var(--color-border)]/60 bg-[var(--color-surface)]/70 px-4 py-8 text-center text-sm text-[var(--color-muted)] backdrop-blur-sm sm:px-6">
        <div className="mb-3 flex justify-center">
          <Brand />
        </div>
        <p>SEAMS AI &mdash; AI-Assisted Secure Examination and Assessment Management System</p>
      </footer>
    </div>
  );
}

const HERO_POINTS = [
  'Secure by design',
  'Mobile-first',
  'AI-grounded',
  'For educators and students',
] as const;

const arrowRightIcon = (
  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12l-7.5 7.5M3 12h17.25" />
  </svg>
);

const shieldCheckIcon = (
  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
  </svg>
);

const checkCircleIcon = (
  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const docIcon = (
  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
  </svg>
);

const shieldIcon = (
  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
  </svg>
);

const chartIcon = (
  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
  </svg>
);

const bookIcon = (
  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
  </svg>
);

const clipboardCheckIcon = (
  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M11.35 3.836c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m8.9-4.414c.376.023.75.05 1.124.08 1.131.094 1.976 1.057 1.976 2.192V16.5A2.25 2.25 0 0118 18.75h-2.25m-7.5-10.5H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V18.75m-7.5-10.5h6.375c.621 0 1.125.504 1.125 1.125v9.375m-8.25-3l1.5 1.5 3-3.75" />
  </svg>
);

const peopleIcon = (
  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
  </svg>
);

const FEATURES: { icon: ReactNode; tint: string; title: string; description: string }[] = [
  {
    icon: docIcon,
    tint: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    title: 'AI-Assisted Assessment Creation',
    description:
      'Generate high-quality, curriculum-aligned questions from your source materials using RAG and advanced AI.',
  },
  {
    icon: shieldIcon,
    tint: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    title: 'Secure and Flexible Examination',
    description:
      'Administer online or offline examinations with identity verification, randomization, and built-in security.',
  },
  {
    icon: peopleIcon,
    tint: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
    title: 'Automated Checking and Analytics',
    description:
      'Auto-score objective items, analyze item performance, identify distractor issues, and improve assessment quality.',
  },
  {
    icon: chartIcon,
    tint: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    title: 'One Connected Workflow',
    description:
      'From source materials to TOS, generation, validation, deployment, results, and analytics — everything in one platform.',
  },
];

const WHY = [
  {
    id: 'faculty',
    title: 'For Faculty',
    body: 'AI proposes; faculty approves. Every draft, modification, and score release is reviewable — never silently committed.',
  },
  {
    id: 'students',
    title: 'For Students',
    body: 'Clear touch targets, low-bandwidth exam UI, offline answer persistence with re-sync when connectivity returns.',
  },
  {
    id: 'security',
    title: 'Security',
    body: 'RLS, answer-key isolation, server-side scoring, audit logs, and optional face/liveness verification for protected exams.',
  },
] as const;

const ABOUT_STATS = [
  { value: '3', label: 'Question Types' },
  { value: '6', label: "Bloom's Levels" },
  { value: '3', label: 'Difficulty Tiers' },
  { value: '100%', label: 'Server-Scored' },
] as const;

const SIDEBAR_ITEMS = [
  'Dashboard',
  'My Subjects',
  'Assessments',
  'Question Bank',
  'Results & Analytics',
  'Notifications',
] as const;

const DASH_STATS = [
  { label: 'My Subjects', value: '4', accent: false },
  { label: 'Assessments', value: '12', accent: true },
  { label: 'Active Exams', value: '3', accent: true },
  { label: 'Pending Review', value: '2', accent: false },
] as const;

const CHART_BARS = [40, 62, 48, 78, 55, 92, 70] as const;

function SectionEyebrow({ children }: { children: ReactNode }): JSX.Element {
  return (
    <p className="mb-3 inline-block rounded-full bg-[var(--color-primary-light)] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-primary)]">
      {children}
    </p>
  );
}

function FeatureCard({
  icon,
  tint,
  title,
  description,
}: {
  icon: ReactNode;
  tint: string;
  title: string;
  description: string;
}): JSX.Element {
  return (
    <div className="h-full rounded-2xl border border-[var(--color-border)]/70 bg-[var(--color-surface)]/90 p-5 shadow-sm backdrop-blur transition-all hover:-translate-y-0.5 hover:border-[var(--color-primary)]/25 hover:shadow-lg">
      <div className="mb-3 flex items-center gap-3">
        <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${tint}`}>
          {icon}
        </span>
        <h3 className="text-[15px] font-semibold leading-snug text-[var(--color-foreground)]">
          {title}
        </h3>
      </div>
      <p className="text-[13px] leading-relaxed text-[var(--color-muted)]">{description}</p>
    </div>
  );
}

function FloatingCard({
  className,
  icon,
  tint,
  label,
}: {
  className: string;
  icon: ReactNode;
  tint: string;
  label: string;
}): JSX.Element {
  return (
    <div
      className={`absolute z-10 hidden w-[88px] flex-col items-center gap-1.5 rounded-2xl border border-[var(--color-border)]/60 bg-[var(--color-surface)]/95 p-2.5 text-center shadow-lg shadow-slate-900/10 backdrop-blur sm:flex sm:w-[100px] lg:w-[110px] ${className}`}
    >
      <span className={`grid h-9 w-9 place-items-center rounded-xl ${tint}`}>{icon}</span>
      <span className="text-[10px] font-semibold leading-tight text-[var(--color-foreground)] lg:text-[11px]">
        {label}
      </span>
    </div>
  );
}

function LaptopMock(): JSX.Element {
  return (
    <div className="relative mx-auto w-[86%]">
      <div className="rounded-t-2xl bg-slate-800 p-2 shadow-2xl shadow-slate-900/30 ring-1 ring-slate-900/10">
        <div className="relative aspect-[16/10] overflow-hidden rounded-t-lg bg-white">
          <div className="flex h-full">
            <div className="hidden w-[26%] shrink-0 flex-col gap-1 border-r border-slate-200 bg-slate-50 p-2 sm:flex">
              <div className="mb-1.5 flex items-center gap-1.5">
                <BrandIcon className="h-4 w-4" alt="" />
                <span className="text-[7px] font-bold text-slate-800">SEAMS AI</span>
              </div>
              {SIDEBAR_ITEMS.map((item, i) => (
                <div
                  key={item}
                  className={
                    i === 0
                      ? 'truncate rounded bg-[#2563eb] px-1.5 py-[3px] text-[6px] font-semibold text-white'
                      : 'truncate px-1.5 py-[3px] text-[6px] text-slate-500'
                  }
                >
                  {item}
                </div>
              ))}
            </div>

            <div className="min-w-0 flex-1 bg-white">
              <div className="flex items-center justify-between border-b border-slate-200 px-2 py-1.5">
                <div className="h-2 w-20 rounded-full bg-slate-100" />
                <div className="flex items-center gap-1">
                  <span className="h-3 w-3 rounded-full bg-slate-100" />
                  <span className="h-3 w-3 rounded-full bg-slate-100" />
                  <span className="grid h-3.5 w-3.5 place-items-center rounded-full bg-[#2563eb] text-[5px] font-bold text-white">
                    JC
                  </span>
                </div>
              </div>

              <div className="space-y-2 p-2">
                <div className="text-[9px] font-bold text-slate-800">Dashboard</div>

                <div className="grid grid-cols-4 gap-1.5">
                  {DASH_STATS.map((stat) => (
                    <div key={stat.label} className="rounded-md border border-slate-200 p-1.5">
                      <div className="truncate text-[5.5px] text-slate-500">{stat.label}</div>
                      <div
                        className={
                          stat.accent
                            ? 'text-[11px] font-bold text-[#2563eb]'
                            : 'text-[11px] font-bold text-slate-800'
                        }
                      >
                        {stat.value}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-1.5">
                  <div className="rounded-md border border-slate-200 p-1.5">
                    <div className="mb-1.5 text-[6px] font-semibold text-slate-600">
                      Recent Activity
                    </div>
                    <div className="space-y-1.5">
                      {[0, 1, 2, 3].map((row) => (
                        <div key={row} className="flex items-center gap-1.5">
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#2563eb]/70" />
                          <span className="h-1.5 flex-1 rounded-full bg-slate-100" />
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-md border border-slate-200 p-1.5">
                    <div className="mb-1.5 text-[6px] font-semibold text-slate-600">
                      Assessment Performance
                    </div>
                    <div className="flex h-[52px] items-end gap-1">
                      {CHART_BARS.map((height, i) => (
                        <span
                          key={i}
                          style={{ height: `${height}%` }}
                          className={
                            i % 2 === 0
                              ? 'flex-1 rounded-t-sm bg-[#2563eb]/80'
                              : 'flex-1 rounded-t-sm bg-[#22c55e]/80'
                          }
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="relative mx-auto h-2.5 w-full rounded-b-lg bg-gradient-to-b from-slate-300 to-slate-400 shadow-md">
        <span className="absolute left-1/2 top-0 h-1 w-[16%] -translate-x-1/2 rounded-b-sm bg-slate-400" />
      </div>
      <div className="mx-auto h-1 w-[94%] rounded-b-md bg-slate-400/60" />
    </div>
  );
}
