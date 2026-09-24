'use client';

import { useState, type JSX } from 'react';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import BulkEnrollPanel from './BulkEnrollPanel';

interface EnrollBulkButtonProps {
  offeringId: string;
  sectionName: string;
  onChanged?: () => void;
}

/**
 * Bulk enrollment for one offering: section checklist with select-all, plus
 * directory search for irregular students outside the section.
 */
export default function EnrollBulkButton({
  offeringId,
  sectionName,
  onChanged,
}: EnrollBulkButtonProps): JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Bulk Enroll
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Bulk Enroll Students"
        actions={
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Close
          </Button>
        }
      >
        <BulkEnrollPanel
          offeringId={offeringId}
          sectionName={sectionName}
          onChanged={onChanged}
        />
      </Modal>
    </>
  );
}
