import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import PageHeader from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table';
import SourceUpload from '@/components/sources/SourceUpload';
import { getSettings } from '@/lib/settings';
import DeleteSourceButton from './DeleteSourceButton';

interface Props {
  params: Promise<{ offeringId: string }>;
}

interface OfferingHeading {
  id: string;
  subject: { id: string; code: string; title: string } | null;
  section: { id: string; name: string } | null;
}

interface SourceMaterialRow {
  id: string;
  title: string;
  source_type: string;
  processing_status: string;
  file_size: number | null;
  original_filename: string | null;
  mime_type: string | null;
  created_at: string;
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

  const o = offering as unknown as OfferingHeading;

  // Administrator-configured upload ceiling, so the client hint and the
  // pre-check agree with what /api/sources/upload will accept.
  const { max_upload_size_mb } = await getSettings();

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
        actions={<SourceUpload offeringId={offeringId} maxSizeMb={max_upload_size_mb} />}
      />

      {sources && sources.length > 0 ? (
        <Card>
          <Table caption="Source materials uploaded for this offering">
            <THead>
              <TR>
                <TH>Title</TH>
                <TH>File</TH>
                <TH align="right">Size</TH>
                <TH>Uploaded</TH>
                <TH>Processing</TH>
                <TH align="right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {(sources as unknown as SourceMaterialRow[]).map((s) => (
                <TR key={s.id} className="hover:bg-[var(--color-surface-hover)]">
                  <TD>
                    <span className="flex items-center gap-2">
                      <span className="text-lg flex-shrink-0" aria-hidden="true">
                        {typeIcon(s.source_type)}
                      </span>
                      <span className="font-medium text-[var(--color-foreground)]">
                        {s.title}
                      </span>
                    </span>
                  </TD>
                  <TD className="text-[var(--color-muted)]">
                    {s.original_filename || s.source_type}
                  </TD>
                  <TD numeric className="text-[var(--color-muted)]">
                    {formatFileSize(s.file_size)}
                  </TD>
                  <TD className="text-xs text-[var(--color-muted)]">
                    {new Date(s.created_at).toLocaleDateString()}
                  </TD>
                  <TD>
                    <Badge variant={statusVariant(s.processing_status)}>
                      {s.processing_status}
                    </Badge>
                  </TD>
                  <TD>
                    <div className="flex justify-end">
                      <DeleteSourceButton
                        sourceMaterialId={s.id}
                        offeringId={offeringId}
                        title={s.title}
                      />
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      ) : (
        <EmptyState
          title="No source materials"
          description="Upload course materials (PDF, DOCX, TXT) to enable AI-powered question generation."
        />
      )}
    </div>
  );
}
