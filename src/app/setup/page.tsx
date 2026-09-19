'use client';

import { useState } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';

interface SetupStep {
  id: string;
  title: string;
  status: 'pending' | 'active' | 'done' | 'error';
}

/**
 * The authoritative schema lives in supabase/migrations/. This page used to
 * embed a hand-copied snapshot of it, which had drifted badly (no
 * show_explanations / assessment_version_id / verification_status columns, and
 * narrower CHECK constraints than the application writes) — following it
 * produced a database the app could not run against. It now directs operators
 * to the migration files instead of duplicating them.
 */
const MIGRATION_FILES = [
  '20260917000000_initial_schema.sql',
  '20260918000000_security_hardening.sql',
  '20260919000000_exam_integrity.sql',
  '20260919100000_avatar_storage_policies.sql',
] as const;

export default function SetupPage() {
  const [steps, setSteps] = useState<SetupStep[]>([
    { id: 'env', title: 'Environment Configuration', status: 'active' },
    { id: 'migration', title: 'Database Migration', status: 'pending' },
    { id: 'admin', title: 'Create Admin Account', status: 'pending' },
    { id: 'seed', title: 'Seed Data', status: 'pending' },
  ]);
  const [envStatus, setEnvStatus] = useState<'checking' | 'valid' | 'invalid'>('checking');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminResult, setAdminResult] = useState<string | null>(null);

  const checkEnv = async () => {
    setEnvStatus('checking');
    try {
      const res = await fetch('/api/admin/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'check_env' }),
      });
      setEnvStatus(res.ok ? 'valid' : 'invalid');
      if (res.ok) {
        setSteps((prev) => prev.map((s) => (s.id === 'env' ? { ...s, status: 'done' } : s)));
        setSteps((prev) => prev.map((s) => (s.id === 'migration' ? { ...s, status: 'active' } : s)));
      }
    } catch {
      setEnvStatus('invalid');
    }
  };

  const createAdmin = async () => {
    try {
      const res = await fetch('/api/admin/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_admin',
          email: adminEmail,
          password: adminPassword,
          fullName: adminName,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setAdminResult(`Admin created successfully! User ID: ${data.user.id}`);
        setSteps((prev) => prev.map((s) => (s.id === 'admin' ? { ...s, status: 'done' } : s)));
      } else {
        setAdminResult(`Error: ${data.error}`);
      }
    } catch (err) {
      setAdminResult(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--color-background)] p-4 md:p-8">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-[var(--color-foreground)]">
            MiMo Setup
          </h1>
          <p className="text-[var(--color-muted)] mt-1">
            Follow these steps to configure your assessment system
          </p>
        </div>

        {/* Progress */}
        <ol className="flex flex-wrap gap-2 text-xs">
          {steps.map((step, i) => (
            <li
              key={step.id}
              className={`px-2 py-1 rounded-full border ${
                step.status === 'done'
                  ? 'border-[var(--color-success)]/40 text-[var(--color-success)]'
                  : step.status === 'active'
                    ? 'border-[var(--color-primary)]/40 text-[var(--color-primary)]'
                    : 'border-[var(--color-border)] text-[var(--color-muted)]'
              }`}
            >
              {i + 1}. {step.title}
            </li>
          ))}
        </ol>

        {/* Step 1: Environment */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <span className="font-semibold">1. Environment Configuration</span>
              {envStatus === 'valid' && <Badge variant="success">Valid</Badge>}
              {envStatus === 'invalid' && <Badge variant="danger">Invalid</Badge>}
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-[var(--color-muted)] mb-3">
              Verify your Supabase credentials in <code>.env.local</code> are correct.
            </p>
            <Button onClick={checkEnv} variant="secondary" size="sm">
              Check Environment
            </Button>
          </CardContent>
        </Card>

        {/* Step 2: Migration */}
        <Card>
          <CardHeader>
            <span className="font-semibold">2. Database Migration</span>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-[var(--color-muted)]">
              Apply the migrations in <code>supabase/migrations/</code>
              {', '}
              in filename order — via the Supabase CLI (<code>supabase db push</code>) or by
              pasting each file into the Supabase SQL Editor. Do not hand-write the schema:
              the migrations are the single source of truth for tables, constraints, RLS
              policies and the storage bucket rules the application depends on.
            </p>
            <ol className="text-sm text-[var(--color-foreground)] space-y-1 list-decimal list-inside">
              {MIGRATION_FILES.map((file) => (
                <li key={file}>
                  <code className="text-xs">supabase/migrations/{file}</code>
                </li>
              ))}
            </ol>
            <p className="text-xs text-[var(--color-muted)]">
              After running the migrations, click the button below to continue.
            </p>
            <Button
              onClick={() => {
                setSteps((prev) => prev.map((s) => (s.id === 'migration' ? { ...s, status: 'done' } : s)));
                setSteps((prev) => prev.map((s) => (s.id === 'admin' ? { ...s, status: 'active' } : s)));
              }}
              variant="secondary"
              size="sm"
            >
              Migrations applied - Continue
            </Button>
          </CardContent>
        </Card>

        {/* Step 3: Admin Account */}
        <Card>
          <CardHeader>
            <span className="font-semibold">3. Create Admin Account</span>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-[var(--color-muted)]">
              This is only possible while no administrator exists yet. Once one does, the
              bootstrap endpoint refuses to mint more.
            </p>
            <Input
              label="Full Name"
              value={adminName}
              onChange={(e) => setAdminName(e.target.value)}
              placeholder="John Admin"
            />
            <Input
              label="Email"
              type="email"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              placeholder="admin@example.com"
            />
            <Input
              label="Password"
              type="password"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              placeholder="Min 8 characters"
            />
            <Button
              onClick={createAdmin}
              variant="primary"
              size="sm"
              disabled={!adminEmail || !adminPassword || !adminName}
            >
              Create Admin
            </Button>
            {adminResult && (
              <p className={`text-sm ${adminResult.startsWith('Error') ? 'text-[var(--color-danger)]' : 'text-[var(--color-success)]'}`}>
                {adminResult}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Step 4: Seed Data */}
        <Card>
          <CardHeader>
            <span className="font-semibold">4. Seed Data (Optional)</span>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-[var(--color-muted)]">
              After creating your admin account, you can seed default academic data
              (years, semesters, programs) by running the SQL in <code>supabase/seed.sql</code>
              in your SQL Editor.
            </p>
          </CardContent>
        </Card>

        <div className="text-center text-sm text-[var(--color-muted)]">
          <p>After completing setup, go to <a href="/login" className="text-[var(--color-primary)] hover:underline">/login</a></p>
        </div>
      </div>
    </div>
  );
}
