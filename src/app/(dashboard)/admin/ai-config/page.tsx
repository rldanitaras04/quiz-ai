import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table';

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
            <Table cards caption="Recent AI usage">
              <THead>
                <TR>
                  <TH>Provider</TH>
                  <TH>Model</TH>
                  <TH>Operation</TH>
                  <TH>Status</TH>
                  <TH>Date</TH>
                </TR>
              </THead>
              <TBody>
                {recentUsage.map((log) => (
                  <TR key={log.created_at}>
                    <TD primary label="Provider" className="text-[var(--color-foreground)]">
                      {log.provider}
                    </TD>
                    <TD label="Model" className="text-[var(--color-foreground)]">
                      {log.model}
                    </TD>
                    <TD label="Operation" className="text-[var(--color-foreground)]">
                      {log.operation}
                    </TD>
                    <TD label="Status">
                      <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                        log.status === 'success'
                          ? 'bg-[var(--color-success-light)] text-[var(--color-success)]'
                          : 'bg-[var(--color-danger-light)] text-[var(--color-danger)]'
                      }`}>
                        {log.status}
                      </span>
                    </TD>
                    <TD label="Date" className="text-[var(--color-muted)]">
                      {new Date(log.created_at).toLocaleDateString()}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            <p className="text-sm text-[var(--color-muted)]">No AI usage recorded yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
