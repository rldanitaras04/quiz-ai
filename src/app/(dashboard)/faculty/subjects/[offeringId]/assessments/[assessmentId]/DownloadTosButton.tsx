'use client';

import { useState, type JSX } from 'react';
import Button from '@/components/ui/Button';
import { notifyError, notifySuccess } from '@/components/ui/alerts';
import { downloadDocx, safeDocxFilename } from '@/lib/export/docx';
import { buildTosDocument } from '@/lib/export/tos-doc';
import { getAssessmentTosExport } from '@/app/(dashboard)/faculty/subjects/[offeringId]/assessments/actions';

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
      await downloadDocx(
        buildTosDocument(result.data),
        safeDocxFilename(assessmentTitle, 'tos')
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
