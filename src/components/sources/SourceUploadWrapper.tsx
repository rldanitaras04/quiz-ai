'use client';

import dynamic from 'next/dynamic';

const SourceUpload = dynamic(
  () => import('@/components/sources/SourceUploadSimple').then((mod) => mod.default),
  { ssr: false, loading: () => <button className="px-4 py-2 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] text-sm text-[var(--color-muted)] animate-pulse">Loading...</button> }
);

interface SourceUploadWrapperProps {
  offeringId: string;
  maxSizeMb: number;
}

export default function SourceUploadWrapper({ offeringId, maxSizeMb }: SourceUploadWrapperProps) {
  return <SourceUpload offeringId={offeringId} maxSizeMb={maxSizeMb} />;
}