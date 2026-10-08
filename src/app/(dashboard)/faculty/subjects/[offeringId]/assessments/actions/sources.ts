'use server';

// Source materials attached to an offering.
// Split out of the former single actions.ts; blocks are unchanged.

import { isFacultyOfOffering } from '@/lib/auth';
import { requireUser } from './shared';
import { logger } from '@/lib/logger';

export async function getSourceMaterials(offeringId: string) {
  const { supabase } = await requireUser();

  const { data, error } = await supabase
    .from('source_materials')
    .select('*')
    .eq('subject_offering_id', offeringId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return data || [];
}

export async function retrySourceMaterial(sourceId: string) {
  const { supabase, userId } = await requireUser();

  const { data: source, error: fetchError } = await supabase
    .from('source_materials')
    .select('id, subject_offering_id, storage_path, mime_type, processing_status')
    .eq('id', sourceId)
    .single();

  if (fetchError || !source) throw new Error('Source material not found');
  if (source.processing_status !== 'failed') throw new Error('Only failed materials can be retried');

  if (!(await isFacultyOfOffering(supabase, userId, source.subject_offering_id))) {
    throw new Error('Not authorized');
  }

  if (!source.storage_path) throw new Error('No storage path found');

  const { data: fileData, error: downloadError } = await supabase.storage
    .from('source-materials')
    .download(source.storage_path);

  if (downloadError || !fileData) throw new Error('Failed to download file from storage');

  const arrayBuffer = await fileData.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const { extractAndStoreSource } = await import('@/lib/ai');
  extractAndStoreSource(source.id, buffer, source.mime_type).catch((error) => {
    logger.error('Background reprocessing error:', error);
  });

  return { success: true };
}

export async function deleteSourceMaterial(sourceId: string) {
  const { supabase, userId } = await requireUser();

  const { data: source, error: fetchError } = await supabase
    .from('source_materials')
    .select('id, subject_offering_id, storage_path')
    .eq('id', sourceId)
    .single();

  if (fetchError || !source) throw new Error('Source material not found');

  if (!(await isFacultyOfOffering(supabase, userId, source.subject_offering_id))) {
    throw new Error('Not authorized');
  }

  if (source.storage_path) {
    await supabase.storage.from('source-materials').remove([source.storage_path]);
  }

  const { error } = await supabase
    .from('source_materials')
    .delete()
    .eq('id', sourceId);

  if (error) throw new Error(error.message);
  return { success: true };
}

// ---------------------------------------------------------------------------
// Detail loader
// ---------------------------------------------------------------------------

