'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { recordAuditLog } from '@/lib/audit';
import { isFacultyOfOffering } from '@/lib/auth';

const SOURCE_BUCKET = 'source-materials';

/**
 * Remove a source material: its stored file (if any) and its database row
 * (chunks cascade), as required for "remove/replace sources before assessment
 * finalization".
 *
 * Refuses when generated questions still trace back to this material, so
 * source provenance (`question_sources`) is never silently destroyed.
 * Authorization comes from RLS: the row is only readable/deletable by faculty
 * assigned to the owning offering.
 */
export async function deleteSourceMaterial(
  sourceMaterialId: string,
  offeringId: string
): Promise<{ success?: boolean; error?: string }> {
  if (typeof sourceMaterialId !== 'string' || !sourceMaterialId) {
    return { error: 'Invalid source material' };
  }

  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { error: 'Not authenticated' };

  const { data: source } = await supabase
    .from('source_materials')
    .select('id, title, storage_path, subject_offering_id')
    .eq('id', sourceMaterialId)
    .maybeSingle();

  if (!source) return { error: 'Source material not found' };
  if (offeringId && source.subject_offering_id !== offeringId) {
    return { error: 'Source material does not belong to this offering' };
  }

  // RLS scopes the read above to offerings the caller is assigned to; asserting
  // it here keeps the failure explicit instead of surfacing as 'not found'.
  if (!(await isFacultyOfOffering(supabase, user.id, source.subject_offering_id))) {
    return { error: 'Not authorized for this offering' };
  }

  // Provenance guard: are any chunks of this material cited by a question?
  const { data: chunks } = await supabase
    .from('source_chunks')
    .select('id')
    .eq('source_material_id', sourceMaterialId);

  const chunkIds = (chunks ?? []).map((c) => c.id as string);

  if (chunkIds.length > 0) {
    const { count } = await supabase
      .from('question_sources')
      .select('id', { count: 'exact', head: true })
      .in('source_chunk_id', chunkIds);

    if (count && count > 0) {
      return {
        error:
          'This material is cited by generated questions. Delete or regenerate those questions first so source traceability is preserved.',
      };
    }
  }

  if (source.storage_path) {
    const { error: storageError } = await supabase.storage
      .from(SOURCE_BUCKET)
      .remove([source.storage_path]);

    // The row is what users see; a storage failure leaves an unreferenced
    // object rather than a source material that cannot be removed.
    if (storageError) {
      console.error('Failed to remove stored source object:', storageError.message);
    }
  }

  const { data: deleted, error: deleteError } = await supabase
    .from('source_materials')
    .delete()
    .eq('id', sourceMaterialId)
    .select('id')
    .maybeSingle();

  if (deleteError) return { error: deleteError.message };
  if (!deleted) return { error: 'That source material no longer exists or you cannot delete it' };

  await recordAuditLog({
    actorUserId: user.id,
    action: 'delete',
    entityType: 'source_material',
    entityId: sourceMaterialId,
    metadata: {
      subject_offering_id: source.subject_offering_id,
      title: source.title,
    },
  });

  revalidatePath(`/faculty/subjects/${source.subject_offering_id}/sources`);
  return { success: true };
}
