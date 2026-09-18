import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import SourceUpload from '@/components/sources/SourceUpload';

interface Props {
  params: Promise<{ offeringId: string }>;
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return 'N/A';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function SourcesPage({ params }: Props) {
  const { offeringId } = await params;
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect('/login');

  const { data: offering } = await supabase
    .from('subject_offerings')
    .select('id, subject:subjects(id, code, title), section:sections(id, name)')
    .eq('id', offeringId)
    .single();

  if (!offering) redirect('/faculty/subjects');

  const o = offering as any;

  const { data: sources } = await supabase
    .from('source_materials')
    .select('id, title, source_type, processing_status, file_size, original_filename, mime_type, created_at')
    .eq('subject_offering_id', offeringId)
    .order('created_at', { ascending: false });

  const statusVariant = (status: string): 'success' | 'warning' | 'danger' | 'info' => {
    switch (status) {
      case 'ready': return 'success';
      case 'processing': return 'info';
      case 'pending': return 'warning';
      case 'failed': return 'danger';
      default: return 'info';
    }
  };

  const typeIcon = (type: string) => {
    switch (type) {
      case 'file': return '📄';
      case 'text': return '📝';
      case 'url': return '🔗';
      default: return '📄';
    }
  };

  return (
    <div>
      <PageHeader
        breadcrumbs={[
          { label: 'Faculty', href: '/faculty' },
          { label: 'My Subjects', href: '/faculty/subjects' },
          { label: `${o.subject?.code} - ${o.subject?.title}`, href: `/faculty/subjects/${offeringId}` },
          { label: 'Source Materials' },
        ]}
        title="Source Materials"
        description="Upload and manage course materials for AI-powered question generation"
        actions={<SourceUpload offeringId={offeringId} />}
      />

      {sources && sources.length > 0 ? (
        <div className="space-y-3">
          {sources.map((s: any) => (
            <Card key={s.id}>
              <CardContent className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xl flex-shrink-0">{typeIcon(s.source_type)}</span>
                  <div className="min-w-0">
                    <h3 className="font-medium text-[var(--color-foreground)] truncate">{s.title}</h3>
                    <p className="text-sm text-[var(--color-muted)] truncate">
                      {s.original_filename || s.source_type} | {formatFileSize(s.file_size)}
                    </p>
                    <p className="text-xs text-[var(--color-muted-light)]">
                      Uploaded {new Date(s.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <Badge variant={statusVariant(s.processing_status)}>
                  {s.processing_status}
                </Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No source materials"
          description="Upload course materials (PDF, DOCX, TXT) to enable AI-powered question generation."
        />
      )}
    </div>
  );
}
