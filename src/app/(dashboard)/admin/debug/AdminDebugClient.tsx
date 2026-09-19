'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import Button from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';

export default function AdminDebugClient() {
  const router = useRouter();
  const supabase = createClient();
  const [diagnosis, setDiagnosis] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [promoting, setPromoting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    async function diagnose() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setMessage('Not authenticated');
        setLoading(false);
        return;
      }

      const res = await fetch('/api/admin/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'diagnose', userId: user.id }),
      });
      const data = await res.json();
      setDiagnosis({ ...data, authUser: { id: user.id, email: user.email } });
      setLoading(false);
    }
    diagnose();
  }, [supabase]);

  const promoteToAdmin = async () => {
    setPromoting(true);
    setMessage(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setMessage('Not authenticated');
      setPromoting(false);
      return;
    }

    const res = await fetch('/api/admin/bootstrap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'promote_to_admin', userId: user.id }),
    });
    const data = await res.json();

    if (data.success) {
      setMessage('Promoted to super_admin! Redirecting...');
      setTimeout(() => router.push('/admin'), 1500);
    } else {
      setMessage(`Error: ${data.error}`);
    }
    setPromoting(false);
  };

  if (loading) return <div className="p-8 text-center">Loading...</div>;

  const roles = (diagnosis?.roles as Array<{ role: string }> | null) ?? [];
  const hasAdmin = roles.some((r) => r.role === 'super_admin');

  return (
    <div>
      <PageHeader title="Debug: Role Diagnosis" description="Check and fix role assignment issues" />

      <div className="space-y-4 max-w-2xl">
        <Card>
          <CardContent className="space-y-3">
            <h3 className="font-semibold">Auth User</h3>
            <pre className="text-xs bg-[var(--color-surface)] p-3 rounded overflow-auto">
              {JSON.stringify(diagnosis?.authUser, null, 2)}
            </pre>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3">
            <h3 className="font-semibold">Profile</h3>
            <pre className="text-xs bg-[var(--color-surface)] p-3 rounded overflow-auto">
              {JSON.stringify(diagnosis?.profile ?? diagnosis?.profileError, null, 2)}
            </pre>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3">
            <h3 className="font-semibold">Roles</h3>
            <pre className="text-xs bg-[var(--color-surface)] p-3 rounded overflow-auto">
              {JSON.stringify(diagnosis?.roles ?? diagnosis?.rolesError, null, 2)}
            </pre>
            {!hasAdmin && (
              <Button onClick={promoteToAdmin} disabled={promoting} variant="primary" size="sm">
                {promoting ? 'Promoting...' : 'Promote to super_admin'}
              </Button>
            )}
            {hasAdmin && <p className="text-sm text-[var(--color-success)]">Already a super_admin</p>}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3">
            <h3 className="font-semibold">Admin Client URL</h3>
            <p className="text-xs text-[var(--color-muted)]">
              {String(diagnosis?.adminClientUrl ?? 'unknown')}
            </p>
            {String(diagnosis?.adminClientUrl ?? '').includes('grjhikarppjgnhlyyjah') && (
              <p className="text-xs text-[var(--color-danger)]">
                WARNING: Service role key is from a different project! Update SUPABASE_SERVICE_ROLE_KEY in .env.local
              </p>
            )}
          </CardContent>
        </Card>

        {message && (
          <p className={`text-sm p-3 rounded ${message.startsWith('Error') ? 'bg-[var(--color-danger-light)] text-[var(--color-danger)]' : 'bg-[var(--color-success-light)] text-[var(--color-success)]'}`}>
            {message}
          </p>
        )}
      </div>
    </div>
  );
}
