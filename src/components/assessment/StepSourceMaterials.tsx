'use client';

import { useState, useEffect, type JSX } from 'react';
import Spinner from '@/components/ui/Spinner';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import { getSourceMaterials } from '@/app/(dashboard)/faculty/subjects/[offeringId]/assessments/actions';
import type { SourceMaterial } from '@/lib/types';

const SOURCE_TYPE_LABELS: Record<string, string> = {
  file: 'File',
  text: 'Text',
  url: 'URL',
};

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
  // Only fetch when the wizard has no materials yet; otherwise this step is
  // already satisfied and nothing has to load. (Loading state is initialised
  // from that condition instead of being set inside the effect, which caused a
  // cascading re-render.)
  const [loading, setLoading] = useState(state.sourceMaterials.length === 0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (state.sourceMaterials.length > 0) return;

    let cancelled = false;

    async function load() {
      try {
        const materials = await getSourceMaterials(offeringId);
        if (!cancelled) onUpdate({ sourceMaterials: materials });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load materials');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [offeringId, state.sourceMaterials.length, onUpdate]);

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

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Spinner size="lg" />
        <p className="mt-3 text-sm text-[var(--color-muted)]">Loading source materials...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-[var(--color-danger)]">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-[var(--color-foreground)] mb-1">
          Source Materials
        </h2>
        <p className="text-sm text-[var(--color-muted)]">
          Select which source materials the AI should use to generate questions.
        </p>
      </div>

      {state.sourceMaterials.length === 0 ? (
        <EmptyState
          title="No source materials"
          description="Upload source materials before generating an assessment."
        />
      ) : (
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
                <label
                  key={material.id}
                  className={`flex items-start gap-3 p-4 rounded-[var(--radius-md)] border cursor-pointer transition-colors ${
                    isSelected
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5'
                      : 'border-[var(--color-border)] hover:border-[var(--color-primary)]/50'
                  }`}
                >
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
                    {material.raw_text && (
                      <p className="text-xs text-[var(--color-muted)] mt-1 line-clamp-2">
                        {material.raw_text.slice(0, 200)}...
                      </p>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
