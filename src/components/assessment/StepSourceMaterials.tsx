'use client';

import { useState, useEffect, useRef, useCallback, type JSX } from 'react';
import Spinner from '@/components/ui/Spinner';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { getSourceMaterials, deleteSourceMaterial, retrySourceMaterial } from '@/app/(dashboard)/faculty/subjects/[offeringId]/assessments/actions';
import { notifySuccess, notifyError } from '@/components/ui/alerts';
import { confirmAction } from '@/components/ui/alerts';
import { useSupabase } from '@/lib/hooks';
import type { SourceMaterial } from '@/lib/types';

const SOURCE_TYPE_LABELS: Record<string, string> = {
  file: 'File',
  text: 'Text',
  url: 'URL',
};

const ACCEPT = '.pdf,.docx,.txt,.md';

type UploadMode = 'file' | 'text';

interface StepSourceMaterialsProps {
  state: {
    selectedSourceIds: string[];
    sourceMaterials: SourceMaterial[];
  };
  onUpdate: (updates: { selectedSourceIds?: string[]; sourceMaterials?: SourceMaterial[] }) => void;
  offeringId: string;
  errors: Record<string, string>;
}

export default function StepSourceMaterials({
  state,
  onUpdate,
  offeringId,
  errors,
}: StepSourceMaterialsProps): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadTitle, setUploadTitle] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [mode, setMode] = useState<UploadMode>('file');
  const [textContent, setTextContent] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dragCounterRef = useRef(0);
  const supabase = useSupabase();
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  const loadMaterials = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const materials = await getSourceMaterials(offeringId);
      onUpdateRef.current({ sourceMaterials: materials });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load materials');
    } finally {
      setLoading(false);
    }
  }, [offeringId]);

  useEffect(() => {
    loadMaterials();
  }, [loadMaterials]);

  // Auto-refresh: poll every 3s while any material is still processing
  useEffect(() => {
    const hasProcessing = state.sourceMaterials.some((m) => m.processing_status === 'processing');
    if (!hasProcessing) return;

    const interval = setInterval(() => {
      loadMaterials();
    }, 3000);
    return () => clearInterval(interval);
  }, [state.sourceMaterials, loadMaterials]);

  const handleFileSelect = (file: File) => {
    setSelectedFile(file);
    if (!uploadTitle) {
      setUploadTitle(file.name.replace(/\.[^.]+$/, ''));
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (file) handleFileSelect(file);
  };

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes('Files')) {
      setDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setDragging(false);

    const file = e.dataTransfer.files?.[0] ?? null;
    if (file) {
      const validExts = ['.pdf', '.docx', '.txt', '.md'];
      const ext = '.' + file.name.split('.').pop()?.toLowerCase();
      if (!validExts.includes(ext)) {
        notifyError('Invalid file type', `Supported: ${validExts.join(', ')}`);
        return;
      }
      handleFileSelect(file);
    }
  }, []);

  const handleUpload = async () => {
    if (!selectedFile || !uploadTitle.trim()) return;

    setUploading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        throw new Error('Your session has expired. Please sign in again.');
      }

      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('subjectOfferingId', offeringId);
      formData.append('title', uploadTitle.trim());

      const res = await fetch('/api/sources/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Upload failed');
      }

      notifySuccess('File uploaded', 'Your source material is being processed.');

      setSelectedFile(null);
      setUploadTitle('');
      if (fileInputRef.current) fileInputRef.current.value = '';

      await loadMaterials();
    } catch (err) {
      notifyError('Upload failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setUploading(false);
    }
  };

  const handleTextUpload = async () => {
    if (!textContent.trim() || !uploadTitle.trim()) return;

    setUploading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        throw new Error('Your session has expired. Please sign in again.');
      }

      const formData = new FormData();
      formData.append('textContent', textContent);
      formData.append('sourceType', 'text');
      formData.append('subjectOfferingId', offeringId);
      formData.append('title', uploadTitle.trim());

      const res = await fetch('/api/sources/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Upload failed');
      }

      notifySuccess('Text uploaded', 'Your source material is being processed.');

      setTextContent('');
      setUploadTitle('');

      await loadMaterials();
    } catch (err) {
      notifyError('Upload failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setUploading(false);
    }
  };

  const toggleSource = (id: string) => {
    const next = state.selectedSourceIds.includes(id)
      ? state.selectedSourceIds.filter((sid) => sid !== id)
      : [...state.selectedSourceIds, id];
    onUpdate({ selectedSourceIds: next });
  };

  const toggleAll = () => {
    if (state.selectedSourceIds.length === state.sourceMaterials.length) {
      onUpdate({ selectedSourceIds: [] });
    } else {
      onUpdate({ selectedSourceIds: state.sourceMaterials.map((s) => s.id) });
    }
  };

  const handleDelete = async (id: string, title: string) => {
    const confirmed = await confirmAction({
      title: 'Delete source material',
      text: `Are you sure you want to delete "${title}"? This cannot be undone.`,
      destructive: true,
    });
    if (!confirmed) return;

    try {
      await deleteSourceMaterial(id);
      const next = state.sourceMaterials.filter((s) => s.id !== id);
      const nextSelected = state.selectedSourceIds.filter((sid) => sid !== id);
      onUpdate({ sourceMaterials: next, selectedSourceIds: nextSelected });
      notifySuccess('Deleted', `"${title}" has been removed.`);
    } catch (err) {
      notifyError('Delete failed', err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const handleRetry = async (id: string, title: string) => {
    try {
      await retrySourceMaterial(id);
      const next = state.sourceMaterials.map((s) =>
        s.id === id ? { ...s, processing_status: 'processing' as const } : s
      );
      onUpdate({ sourceMaterials: next });
      notifySuccess('Retrying', `"${title}" is being reprocessed.`);
    } catch (err) {
      notifyError('Retry failed', err instanceof Error ? err.message : 'Unknown error');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-[var(--color-foreground)] mb-1">
          Source Materials
        </h2>
        <p className="text-sm text-[var(--color-muted)]">
          Upload source materials or paste text content, then select which ones the AI should use to generate questions.
        </p>
      </div>

      {/* Mode selector */}
      <div className="flex gap-2 border border-[var(--color-border)] rounded-[var(--radius-md)] p-1">
        <button
          type="button"
          onClick={() => {
            setMode('file');
            setSelectedFile(null);
            setTextContent('');
            setError(null);
            if (fileInputRef.current) fileInputRef.current.value = '';
          }}
          className={`flex-1 px-3 py-2 text-sm font-medium rounded-[var(--radius-sm)] transition-colors ${
            mode === 'file'
              ? 'bg-[var(--color-primary)] text-white'
              : 'text-[var(--color-muted)] hover:bg-[var(--color-surface-hover)]'
          }`}
        >
          File Upload
        </button>
        <button
          type="button"
          onClick={() => {
            setMode('text');
            setSelectedFile(null);
            setTextContent('');
            setError(null);
            if (fileInputRef.current) fileInputRef.current.value = '';
            setTimeout(() => textareaRef.current?.focus(), 0);
          }}
          className={`flex-1 px-3 py-2 text-sm font-medium rounded-[var(--radius-sm)] transition-colors ${
            mode === 'text'
              ? 'bg-[var(--color-primary)] text-white'
              : 'text-[var(--color-muted)] hover:bg-[var(--color-surface-hover)]'
          }`}
        >
          Text Input
        </button>
      </div>

      {/* File Upload Mode */}
      {mode === 'file' && (
        <div
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`relative border-2 border-dashed rounded-[var(--radius-md)] p-6 text-center cursor-pointer transition-colors ${
            dragging
              ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5'
              : selectedFile
                ? 'border-[var(--color-success)] bg-[var(--color-success)]/5'
                : 'border-[var(--color-border)] hover:border-[var(--color-primary)]/50 bg-[var(--color-surface-hover)]'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT}
            onChange={handleFileInput}
            className="hidden"
          />
          <div className="flex flex-col items-center gap-2">
            {uploading ? (
              <Spinner size="md" />
            ) : dragging ? (
              <svg className="w-10 h-10 text-[var(--color-primary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            ) : selectedFile ? (
              <svg className="w-10 h-10 text-[var(--color-success)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ) : (
              <svg className="w-10 h-10 text-[var(--color-muted-light)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            )}
            <p className="text-sm font-medium text-[var(--color-foreground)]">
              {dragging
                ? 'Drop file here'
                : selectedFile
                  ? selectedFile.name
                  : 'Drag & drop a file or click to browse'}
            </p>
            <p className="text-xs text-[var(--color-muted)]">
              PDF, DOCX, TXT, MD up to 50MB
            </p>
          </div>
        </div>
      )}

      {/* Text Input Mode */}
      {mode === 'text' && (
        <div className="space-y-2">
          <label className="block text-sm font-medium text-[var(--color-foreground)]">
            Text Content
          </label>
          <textarea
            ref={textareaRef}
            value={textContent}
            onChange={(e) => setTextContent(e.target.value)}
            placeholder="Paste or type your source material here..."
            rows={10}
            className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-foreground)] placeholder:text-[var(--color-muted-light)] focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-focus-ring)] focus:outline-none resize-y"
          />
          <p className="text-xs text-[var(--color-muted)]">
            {textContent.length} characters
          </p>
        </div>
      )}

      {/* Title + Upload Button */}
      {(selectedFile || (mode === 'text' && textContent.trim())) && (
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-[var(--color-foreground)] mb-1">
              Material Title
            </label>
            <input
              type="text"
              value={uploadTitle}
              onChange={(e) => setUploadTitle(e.target.value)}
              placeholder="e.g. Chapter 1 - Introduction to OOP"
              className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-foreground)] placeholder:text-[var(--color-muted-light)]"
            />
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="primary"
              size="sm"
              onClick={mode === 'file' ? handleUpload : handleTextUpload}
              loading={uploading}
              disabled={!uploadTitle.trim()}
            >
              {mode === 'file' ? 'Upload' : 'Save Text'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSelectedFile(null);
                setTextContent('');
                setUploadTitle('');
                if (fileInputRef.current) fileInputRef.current.value = '';
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Error + Retry */}
      {error && (
        <div className="flex items-center gap-3 p-3 rounded-[var(--radius-md)] bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/20">
          <p className="text-sm text-[var(--color-danger)] flex-1">{error}</p>
          <Button variant="ghost" size="sm" onClick={loadMaterials}>
            Retry
          </Button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-6">
          <Spinner size="md" />
          <p className="mt-2 text-sm text-[var(--color-muted)]">Loading source materials...</p>
        </div>
      )}

      {/* Materials List */}
      {!loading && state.sourceMaterials.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={state.selectedSourceIds.length === state.sourceMaterials.length}
                onChange={toggleAll}
                className="h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-primary)] focus:ring-[var(--color-focus-ring)]"
              />
              <span className="text-sm font-medium text-[var(--color-foreground)]">
                Select all ({state.sourceMaterials.length})
              </span>
            </label>
            <span className="text-xs text-[var(--color-muted)]">
              {state.selectedSourceIds.length} of {state.sourceMaterials.length} selected
            </span>
          </div>

          {errors.sources && (
            <p className="text-sm text-[var(--color-danger)]">{errors.sources}</p>
          )}

          <div className="space-y-2">
            {state.sourceMaterials.map((material) => {
              const isSelected = state.selectedSourceIds.includes(material.id);
              return (
                <div
                  key={material.id}
                  className={`flex items-start gap-3 p-4 rounded-[var(--radius-md)] border transition-colors ${
                    isSelected
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5'
                      : 'border-[var(--color-border)] hover:border-[var(--color-primary)]/50'
                  }`}
                >
                  <label className="flex items-start gap-3 flex-1 min-w-0 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSource(material.id)}
                      className="mt-0.5 h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-primary)] focus:ring-[var(--color-focus-ring)]"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium text-[var(--color-foreground)] truncate">
                          {material.title}
                        </span>
                        <Badge variant="outline">
                          {SOURCE_TYPE_LABELS[material.source_type] || material.source_type}
                        </Badge>
                        {material.processing_status === 'ready' && (
                          <Badge variant="success">Ready</Badge>
                        )}
                        {material.processing_status === 'processing' && (
                          <Badge variant="warning">Processing</Badge>
                        )}
                        {material.processing_status === 'failed' && (
                          <Badge variant="danger">Failed</Badge>
                        )}
                      </div>
                      {material.original_filename && (
                        <p className="text-xs text-[var(--color-muted)] truncate">
                          {material.original_filename}
                        </p>
                      )}
                      {(material as any).processing_error && (
                        <p className="text-xs text-[var(--color-danger)] mt-1">
                          {(material as any).processing_error}
                        </p>
                      )}
                    </div>
                  </label>
                  <div className="flex items-center gap-1 mt-0.5 shrink-0">
                    {material.processing_status === 'failed' && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRetry(material.id, material.title);
                        }}
                        className="p-1 rounded text-[var(--color-muted)] hover:text-[var(--color-primary)] hover:bg-[var(--color-primary)]/10 transition-colors"
                        title="Retry processing"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(material.id, material.title);
                      }}
                      className="p-1 rounded text-[var(--color-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10 transition-colors"
                      title="Delete"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {!loading && state.sourceMaterials.length === 0 && !error && (
        <div className="text-center py-6">
          <p className="text-sm text-[var(--color-muted)]">
            No source materials yet. Upload a file or paste text above to get started.
          </p>
        </div>
      )}
    </div>
  );
}
