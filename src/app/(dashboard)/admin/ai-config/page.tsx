import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';

export default async function AIConfigPage() {
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect('/login');

  const { data: roles } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id);

  if (!roles?.some((r) => r.role === 'super_admin')) redirect('/');

  const { count: usageCount } = await supabase
    .from('ai_usage_logs')
    .select('id', { count: 'exact', head: true });

  const { data: recentUsage } = await supabase
    .from('ai_usage_logs')
    .select('provider, model, operation, status, created_at')
    .order('created_at', { ascending: false })
    .limit(10);

  const openaiConfigured = !!process.env.OPENAI_API_KEY;
  const groqConfigured = !!process.env.GROQ_API_KEY;
  const huggingfaceConfigured = !!process.env.HUGGINGFACE_API_KEY;

  return (
    <div>
      <PageHeader title="AI Configuration" description="Manage AI provider settings and view usage" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <Card>
          <CardHeader>Provider Status</CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-3 rounded-lg border border-[var(--color-border)]">
              <div>
                <p className="text-sm font-medium text-[var(--color-foreground)]">OpenAI</p>
                <p className="text-xs text-[var(--color-muted)]">GPT-4o for generation, text-embedding-3-small for embeddings</p>
              </div>
              {openaiConfigured ? (
                <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-[var(--color-success-light)] text-[var(--color-success)]">
                  Configured
                </span>
              ) : (
                <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-[var(--color-warning-light)] text-[var(--color-warning)]">
                  Not configured
                </span>
              )}
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg border border-[var(--color-border)]">
              <div>
                <p className="text-sm font-medium text-[var(--color-foreground)]">Groq</p>
                <p className="text-xs text-[var(--color-muted)]">openai/gpt-oss-120b for generation</p>
              </div>
              {groqConfigured ? (
                <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-[var(--color-success-light)] text-[var(--color-success)]">
                  Configured
                </span>
              ) : (
                <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-[var(--color-surface-hover)] text-[var(--color-muted)]">
                  Not configured
                </span>
              )}
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg border border-[var(--color-border)]">
              <div>
                <p className="text-sm font-medium text-[var(--color-foreground)]">Hugging Face</p>
                <p className="text-xs text-[var(--color-muted)]">all-MiniLM-L6-v2 for embeddings (free)</p>
              </div>
              {huggingfaceConfigured ? (
                <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-[var(--color-success-light)] text-[var(--color-success)]">
                  Configured
                </span>
              ) : (
                <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-[var(--color-surface-hover)] text-[var(--color-muted)]">
                  Not configured
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>Usage Summary</CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm text-[var(--color-muted)]">Total API Calls</p>
              <p className="text-3xl font-bold text-[var(--color-foreground)]">{usageCount ?? 0}</p>
            </div>
            <div>
              <p className="text-sm text-[var(--color-muted)]">Active Provider</p>
              <p className="text-sm font-medium text-[var(--color-foreground)]">
                {groqConfigured ? 'Groq (preferred)' : openaiConfigured ? 'OpenAI' : 'None configured'}
              </p>
            </div>
            <div>
              <p className="text-sm text-[var(--color-muted)]">Embedding Provider</p>
              <p className="text-sm font-medium text-[var(--color-foreground)]">
                {huggingfaceConfigured ? 'Hugging Face (free)' : openaiConfigured ? 'OpenAI' : 'None configured'}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>Recent AI Usage</CardHeader>
        <CardContent>
          {recentUsage && recentUsage.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)]">
                    <th className="text-left py-2 text-[var(--color-muted)] font-medium">Provider</th>
                    <th className="text-left py-2 text-[var(--color-muted)] font-medium">Model</th>
                    <th className="text-left py-2 text-[var(--color-muted)] font-medium">Operation</th>
                    <th className="text-left py-2 text-[var(--color-muted)] font-medium">Status</th>
                    <th className="text-left py-2 text-[var(--color-muted)] font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {recentUsage.map((log) => (
                    <tr key={log.created_at} className="border-b border-[var(--color-border)] last:border-0">
                      <td className="py-2 text-[var(--color-foreground)]">{log.provider}</td>
                      <td className="py-2 text-[var(--color-foreground)]">{log.model}</td>
                      <td className="py-2 text-[var(--color-foreground)]">{log.operation}</td>
                      <td className="py-2">
                        <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                          log.status === 'success'
                            ? 'bg-[var(--color-success-light)] text-[var(--color-success)]'
                            : 'bg-[var(--color-danger-light)] text-[var(--color-danger)]'
                        }`}>
                          {log.status}
                        </span>
                      </td>
                      <td className="py-2 text-[var(--color-muted)]">
                        {new Date(log.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-[var(--color-muted)]">No AI usage recorded yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
