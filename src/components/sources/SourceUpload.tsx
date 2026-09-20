'use client';

import { useState, useRef, useCallback, type JSX } from 'react';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import { notifyError, notifySuccess } from '@/components/ui/alerts';
import { useSupabase } from '@/lib/hooks';
import { SUPPORTED_SOURCE_EXTENSIONS } from '@/lib/constants';

function isSupportedExtension(ext: string): boolean {
  return (SUPPORTED_SOURCE_EXTENSIONS as readonly string[]).includes(ext);
}

/**
 * Client-side pre-check; the upload route validates type and size again, against
 * the same administrator-configured ceiling that is passed in here.
 */
function validateFile(f: File, maxSizeMb: number): string | null {
  const ext = '.' + f.name.split('.').pop()?.toLowerCase();
  if (!isSupportedExtension(ext)) {
    return `Unsupported file type. Accepted: ${SUPPORTED_SOURCE_EXTENSIONS.join(', ')}`;
  }
  if (f.size > maxSizeMb * 1024 * 1024) {
    return `File too large. Maximum size: ${maxSizeMb}MB`;
  }
  return null;
}

interface SourceUploadProps {
  offeringId: string;
  /** Ceiling from /admin/settings, so the hint matches what the route accepts. */
  maxSizeMb: number;
}

export default function SourceUpload({ offeringId, maxSizeMb }: SourceUploadProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const supabase = useSupabase();

  const acceptedTypes = SUPPORTED_SOURCE_EXTENSIONS.join(',');

  const handleFile = useCallback(
    (f: File) => {
      const err = validateFile(f, maxSizeMb);
      if (err) {
        setError(err);
        return;
      }
      setError(null);
      setFile(f);
      if (!title) {
        setTitle(f.name.replace(/\.[^/.]+$/, ''));
      }
    },
    [maxSizeMb, title]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      const f = e.dataTransfer.files[0];
      if (f) handleFile(f);
    },
    [handleFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
  }, []);

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('title', title || file.name);
      // The route reads camelCase `subjectOfferingId`; sending
      // `subject_offering_id` made every upload fail validation.
      formData.append('subjectOfferingId', offeringId);

      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        throw new Error('Your session has expired. Please sign in again.');
      }

      const res = await fetch('/api/sources/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Upload failed');
      }

      setSuccess(true);
      notifySuccess('Upload complete', 'Extraction and embedding run in the background.');
      setTimeout(() => {
        setOpen(false);
        setFile(null);
        setTitle('');
        setSuccess(false);
        window.location.reload();
      }, 1000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      setError(message);
      notifyError('Upload failed', message);
    } finally {
      setUploading(false);
    }
  };

  const handleClose = () => {
    setOpen(false);
    setFile(null);
    setTitle('');
    setError(null);
    setSuccess(false);
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}>Upload Material</Button>
      <Modal
        open={open}
        onClose={handleClose}
        title="Upload Source Material"
        actions={
          <>
            <Button variant="ghost" onClick={handleClose}>Cancel</Button>
            <Button onClick={handleUpload} loading={uploading} disabled={!file || success}>
              {success ? 'Uploaded!' : 'Upload'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => inputRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
              dragActive
                ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)]'
                : file
                ? 'border-[var(--color-success)] bg-[var(--color-success-light)]'
                : 'border-[var(--color-border)] hover:border-[var(--color-primary)]'
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              accept={acceptedTypes}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
              className="hidden"
            />
            {file ? (
              <div>
                <p className="font-medium text-[var(--color-foreground)]">{file.name}</p>
                <p className="text-sm text-[var(--color-muted)]">
                  {(file.size / 1024).toFixed(1)} KB
                </p>
              </div>
            ) : (
              <div>
                <p className="text-[var(--color-muted)]">
                  Drag and drop a file here, or click to browse
                </p>
                <p className="text-xs text-[var(--color-muted-light)] mt-1">
                  Supported: {SUPPORTED_SOURCE_EXTENSIONS.join(', ')} (max {maxSizeMb}MB)
                </p>
              </div>
            )}
          </div>

          <div>
            <label className="text-sm font-medium text-[var(--color-foreground)]">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Material title"
              className="mt-1 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-foreground)] focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-focus-ring)] focus:outline-none"
            />
          </div>

          {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
          {success && <p className="text-sm text-[var(--color-success)]">Upload successful!</p>}
        </div>
      </Modal>
    </>
  );
}
