'use client';

import { useEffect, useState } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { JSX } from 'react';
import PageHeader from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table';
import SourceUploadSimple from '@/components/sources/SourceUploadSimple';
import { getSettings } from '@/lib/settings';
import DeleteSourceButton from './DeleteSourceButton';
import { FileText, Article, ClipboardText } from '@phosphor-icons/react';
import { notifyError } from '@/components/ui/alerts';

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

const TypeIcon = ({ sourceType }: { sourceType: 'file' | 'text' | 'url' | string }): JSX.Element => {
  switch (sourceType) {
    case 'file': return <FileText className="h-5 w-5 text-[var(--color-muted)]" weight="regular" />;
    case 'text': return <Article className="h-5 w-5 text-[var(--color-muted)]" weight="regular" />;
    case 'url': return <FileText className="h-5 w-5 text-[var(--color-muted)]" weight="regular" />;
    default: return <FileText className="h-5 w-5 text-[var(--color-muted)]" weight="regular" />;
  };
};

export default function SourcesPage({ params }: Props) {
  const [offeringId, setOfferingId] = useState<string>('');
  const supabase = createClient();
  const [sources, setSources] = useState<SourceMaterialRow[]>([]);
  const [offering, setOffering] = useState<OfferingHeading | null>(null);
  const [maxSizeMb, setMaxSizeMb] = useState(50);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const resolvedParams = await params;
        const offeringIdValue = resolvedParams.offeringId;
        setOfferingId(offeringIdValue);

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          redirect('/login');
          return;
        }

        const { data: offeringData } = await supabase
          .from('subject_offerings')
          .select('id, subject:subjects(id, code, title), section:sections(id, name)')
          .eq('id', offeringIdValue)
          .single();

        if (!offeringData) {
          redirect('/faculty/subjects');
          return;
        }

        setOffering(offeringData as unknown as OfferingHeading);

        const { data: settings } = await supabase
          .from('system_settings')
          .select('max_upload_size_mb')
          .single();
        if (settings?.max_upload_size_mb) {
          setMaxSizeMb(settings.max_upload_size_mb);
        }

        const { data: sourcesData } = await supabase
          .from('source_materials')
          .select('id, title, source_type, processing_status, file_size, original_filename, mime_type, created_at')
          .eq('subject_offering_id', offeringIdValue)
          .order('created_at', { ascending: false });

        setSources(sourcesData as unknown as SourceMaterialRow[]);
      } catch (err) {
        notifyError('Failed to load', err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [params, supabase]);

  const statusVariant = (status: string): 'success' | 'warning' | 'danger' | 'info' => {
    switch (status) {
      case 'ready': return 'success';
      case 'processing': return 'info';
      case 'pending': return 'warning';
      case 'failed': return 'danger';
      default: return 'info';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--color-primary)]" />
      </div>
    );
  }

  const o = offering as unknown as OfferingHeading | null;

  return (
    <div>
      <PageHeader
        breadcrumbs={[
          { label: 'Faculty', href: '/faculty' },
          { label: 'My Subjects', href: '/faculty/subjects' },
          { label: `${o?.subject?.code} - ${o?.subject?.title}`, href: `/faculty/subjects/${offeringId}` },
          { label: 'Source Materials' },
        ]}
        title="Source Materials"
        description="Upload and manage course materials for AI-powered question generation"
        actions={<SourceUploadSimple offeringId={offeringId} maxSizeMb={maxSizeMb} />}
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
                      <span className="flex-shrink-0" aria-hidden="true">
                        <TypeIcon sourceType={s.source_type} />
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
          description="Add course materials (PDF, DOCX, TXT, or direct text input) to enable AI-powered question generation."
        />
      )}
    </div>
  );
}