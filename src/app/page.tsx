import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getPrimaryRole } from '@/lib/constants';
import Link from 'next/link';

export default async function Home() {
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
    <div className="min-h-screen bg-[var(--color-background)]">
      <nav className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-[var(--color-primary)] text-white text-sm font-bold">
            M
          </div>
          <span className="text-xl font-bold text-[var(--color-foreground)]">MiMo</span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="px-4 py-2 text-sm font-medium text-[var(--color-foreground)] hover:text-[var(--color-primary)] transition-colors"
          >
            Sign In
          </Link>
          <Link
            href="/register"
            className="px-4 py-2 text-sm font-medium text-white bg-[var(--color-primary)] rounded-lg hover:bg-[var(--color-primary-hover)] transition-colors"
          >
            Get Started
          </Link>
        </div>
      </nav>

      <main>
        <section className="px-6 py-20 md:py-32 max-w-5xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--color-primary-light)] text-[var(--color-primary)] text-xs font-medium mb-6">
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
            </svg>
            AI-Powered Assessment Platform
          </div>

          <h1 className="text-4xl md:text-6xl font-bold text-[var(--color-foreground)] tracking-tight leading-tight mb-6">
            Create Smarter Exams
            <br />
            <span className="text-[var(--color-primary)]">With AI Assistance</span>
          </h1>

          <p className="text-lg md:text-xl text-[var(--color-muted)] max-w-2xl mx-auto mb-10 leading-relaxed">
            Generate assessments from your course materials using AI, securely administer examinations,
            and gain deep insights into student performance — all in one platform.
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

        <section className="px-6 py-16 border-t border-[var(--color-border)]">
          <div className="max-w-5xl mx-auto">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <FeatureCard
                icon={
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
                  </svg>
                }
                title="AI-Generated Questions"
                description="Upload your course materials and let AI generate high-quality multiple choice and identification questions grounded in your content."
              />
              <FeatureCard
                icon={
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                  </svg>
                }
                title="Secure Examination"
                description="Administer exams with randomized questions, timed sessions, auto-save, offline support, and server-side answer key protection."
              />
              <FeatureCard
                icon={
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                  </svg>
                }
                title="Analytics & Insights"
                description="View score distributions, item analysis, and distractor performance. Identify weak areas and improve your assessments over time."
              />
            </div>
          </div>
        </section>

        <section className="px-6 py-16 bg-[var(--color-surface)] border-t border-[var(--color-border)]">
          <div className="max-w-5xl mx-auto">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
              <Stat number="3" label="Question Types" />
              <Stat number="6" label="Bloom's Levels" />
              <Stat number="3" label="Difficulty Tiers" />
              <Stat number="100%" label="Auto-Scored" />
            </div>
          </div>
        </section>

        <section className="px-6 py-20 border-t border-[var(--color-border)]">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-3xl font-bold text-[var(--color-foreground)] mb-4">
              Ready to transform your assessments?
            </h2>
            <p className="text-[var(--color-muted)] mb-8 text-lg">
              Join faculty and students using AI-powered assessment tools.
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

      <footer className="px-6 py-6 border-t border-[var(--color-border)] text-center text-sm text-[var(--color-muted)]">
        <p>MiMo &mdash; AI-Assisted Secure Assessment System</p>
      </footer>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="p-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] hover:shadow-lg hover:border-[var(--color-primary)]/20 transition-all">
      <div className="w-12 h-12 rounded-lg bg-[var(--color-primary-light)] text-[var(--color-primary)] flex items-center justify-center mb-4">
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-[var(--color-foreground)] mb-2">{title}</h3>
      <p className="text-sm text-[var(--color-muted)] leading-relaxed">{description}</p>
    </div>
  );
}

function Stat({ number, label }: { number: string; label: string }) {
  return (
    <div>
      <div className="text-3xl font-bold text-[var(--color-primary)]">{number}</div>
      <div className="text-sm text-[var(--color-muted)] mt-1">{label}</div>
    </div>
  );
}
