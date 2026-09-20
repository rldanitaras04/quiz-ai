'use server';

import { revalidatePath } from 'next/cache';
import { requireAdminUser, type ActionResult } from '../actions';
import { recordAuditLog } from '@/lib/audit';
import { SETTING_DEFS, SETTING_KEYS, type SettingKey } from '@/lib/constants';
import { resolveSettings } from '@/lib/settings';

/**
 * System-wide configuration (features/scope §2.1: the super administrator
 * configures "system-wide settings, AI providers, limits, security,
 * notifications, and operational settings").
 *
 * The action follows the same rules as the rest of the admin surface: the
 * caller is re-authorized from session state (`requireAdminUser`) and the write
 * uses the session client, so the `Admin can manage system settings` RLS policy
 * stays authoritative. Ranges come from `SETTING_DEFS`, the same definitions the
 * form renders, so client and server cannot disagree about what is allowed.
 */

function friendlyError(message: string | undefined, fallback: string): string {
  const m = message ?? '';
  if (/permission denied|row-level security/i.test(m)) {
    return 'You do not have permission to change these settings.';
  }
  if (/relation .* does not exist|schema cache/i.test(m)) {
    return 'The settings store is missing. Apply the latest database migration and try again.';
  }
  return fallback;
}

export async function updateSettings(input: Record<string, unknown>): Promise<ActionResult> {
  const { supabase, userId } = await requireAdminUser();

  const submitted = input && typeof input === 'object' ? input : {};
  const updates: Array<{ key: SettingKey; value: number }> = [];

  for (const [rawKey, rawValue] of Object.entries(submitted)) {
    if (!(SETTING_KEYS as string[]).includes(rawKey)) {
      return { error: `Unknown setting: ${rawKey}` };
    }

    const key = rawKey as SettingKey;
    const def = SETTING_DEFS[key];
    const value = Number(rawValue);

    if (rawValue === '' || rawValue === null || !Number.isFinite(value)) {
      return { error: `${def.label} is required and must be a number.` };
    }
    if (def.integer && !Number.isInteger(value)) {
      return { error: `${def.label} must be a whole number.` };
    }
    if (value < def.min || value > def.max) {
      return { error: `${def.label} must be between ${def.min} and ${def.max}.` };
    }

    updates.push({ key, value });
  }

  if (updates.length === 0) return { error: 'No settings were submitted.' };

  // Existing values are needed twice: to resolve the "before" side of the audit
  // entry, and to skip a write when nothing actually changed.
  const { data: current, error: readError } = await supabase
    .from('system_settings')
    .select('key, value')
    .in('key', updates.map((u) => u.key));

  if (readError) {
    return { error: friendlyError(readError.message, 'Failed to read the current settings.') };
  }

  const before = resolveSettings(current ?? []);
  const changed = updates.filter((update) => before[update.key] !== update.value);

  if (changed.length === 0) return { success: true };

  const now = new Date().toISOString();
  const { error } = await supabase.from('system_settings').upsert(
    changed.map((change) => ({ key: change.key, value: change.value, updated_at: now })),
    { onConflict: 'key' }
  );

  if (error) return { error: friendlyError(error.message, 'Failed to save the settings.') };

  await recordAuditLog({
    actorUserId: userId,
    action: 'update',
    entityType: 'system_settings',
    entityId: null,
    metadata: Object.fromEntries(
      changed.map((change) => [change.key, { from: before[change.key], to: change.value }])
    ),
  });

  revalidatePath('/admin/settings');
  // The upload ceiling and list size are read by other routes.
  revalidatePath('/admin/audit-logs');
  revalidatePath('/admin');

  return { success: true };
}
