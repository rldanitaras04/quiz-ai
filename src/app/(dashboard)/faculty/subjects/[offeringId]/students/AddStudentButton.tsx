'use client';

import { useState, type JSX } from 'react';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import { addStudentToOffering } from './actions';

interface AddStudentButtonProps {
  offeringId: string;
}

export default function AddStudentButton({ offeringId }: AddStudentButtonProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [studentNumber, setStudentNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const result = await addStudentToOffering(offeringId, studentNumber);
      if (result.error) {
        setError(result.error);
      } else {
        setSuccess(true);
        setStudentNumber('');
        setTimeout(() => {
          setOpen(false);
          setSuccess(false);
          window.location.reload();
        }, 1000);
      }
    } catch {
      setError('An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}>Add Student</Button>
      <Modal
        open={open}
        onClose={() => { setOpen(false); setError(null); setSuccess(false); }}
        title="Add Student to Offering"
        actions={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} loading={loading} disabled={success}>
              {success ? 'Added!' : 'Add Student'}
            </Button>
          </>
        }
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Student Number"
            value={studentNumber}
            onChange={(e) => setStudentNumber(e.target.value)}
            placeholder="e.g. 2024-00001"
            required
          />
          {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
          {success && <p className="text-sm text-[var(--color-success)]">Student added successfully!</p>}
        </form>
      </Modal>
    </>
  );
}
