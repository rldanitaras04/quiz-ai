import { createAdminClient } from '@/lib/supabase/admin';
import type { AuditAction } from '@/lib/types';

/**
 * Records a security-relevant operation.
 *
 * `audit_logs` carries only a SELECT policy and the authenticated role has no
 * INSERT grant, so the write goes through the service-role client. The actor id
 * is always taken from the authenticated session by the caller — never from
 * client input — and every business operation must already have been authorized
 * before it is logged.
 *
 * Audit failures must never break the operation that succeeded, so the insert
 * is best-effort.
 *
 * Lives in `lib/` rather than one of the `'use server'` action modules so
 * faculty, student and admin actions all share one implementation.
 */
export async function recordAuditLog(entry: {
  actorUserId: string;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from('audit_logs').insert({
      actor_user_id: entry.actorUserId,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId ?? null,
      metadata: entry.metadata ?? {},
    });
  } catch {
    // Swallow: the mutation already committed.
  }
}
