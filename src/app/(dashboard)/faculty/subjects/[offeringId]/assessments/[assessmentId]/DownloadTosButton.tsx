'use client';

import { useState, type JSX } from 'react';
import Button from '@/components/ui/Button';
import { notifyError, notifySuccess } from '@/components/ui/alerts';
// The DOCX builders (and the `docx` library behind them, ~370 KB minified) are
// imported on demand inside the click handler so they never enter the initial
// client bundle of every page that renders this button.
import { getAssessmentTosExport } from '@/app/(dashboard)/faculty/subjects/[offeringId]/assessments/actions/export-tos';

interface DownloadTosButtonProps {
  assessmentId: string;
  assessmentTitle: string;
  size?: 'sm' | 'md' | 'lg';
}

/** Fetches the derived TOS for the assessment and downloads it as DOCX. */
export default function DownloadTosButton({
  assessmentId,
  assessmentTitle,
  size = 'sm',
}: DownloadTosButtonProps): JSX.Element {
  const [loading, setLoading] = useState(false);

  const handleDownload = async () => {
    setLoading(true);
    try {
      const result = await getAssessmentTosExport(assessmentId);
      if (result.error || !result.data) {
        notifyError('Could not generate TOS', result.error ?? 'No data returned.');
        return;
      }
      if (result.data.totalItems === 0) {
        notifyError('TOS is empty', 'Add questions to this assessment before downloading a TOS.');
        return;
      }
      const [docx, { buildTosDocument }] = await Promise.all([
        import('@/lib/export/docx'),
        import('@/lib/export/tos-doc'),
      ]);
      await docx.downloadDocx(
        buildTosDocument(result.data),
        docx.safeDocxFilename(assessmentTitle, 'tos')
      );
      notifySuccess('TOS downloaded', `${result.data.totalItems} items exported.`);
    } catch (error) {
      notifyError(
        'Could not generate TOS',
        error instanceof Error ? error.message : 'Unexpected error.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button variant="secondary" size={size} loading={loading} onClick={handleDownload}>
      Download TOS
    </Button>
  );
}
