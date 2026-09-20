import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import {
  DEFAULT_SETTINGS,
  SETTING_DEFS,
  SETTING_KEYS,
  type AppSettings,
  type SettingKey,
} from '@/lib/constants';

/**
 * Runtime configuration stored in `system_settings` and edited by a super
 * administrator at /admin/settings.
 *
 * The read is deliberately forgiving: the constants in `src/lib/constants.ts`
 * are the fallback whenever a row is missing, a stored value is out of range, or
 * the table cannot be reached at all. Uploads and AI generation therefore keep
 * working on a database that predates the migration, and a bad row can never
 * take those paths down.
 *
 * Sensitive rows are never surfaced: `is_sensitive` marks values that the admin
 * UI must not display, and secrets belong in environment management anyway.
 */

/** Validates one stored value against its definition; null when unusable. */
export function coerceSetting(key: SettingKey, value: unknown): number | null {
  const def = SETTING_DEFS[key];
  const numeric = typeof value === 'number' ? value : Number(value);

  if (!Number.isFinite(numeric)) return null;
  if (def.integer && !Number.isInteger(numeric)) return null;
  if (numeric < def.min || numeric > def.max) return null;

  return numeric;
}

/** Merges stored rows over the defaults, ignoring unknown keys and bad values. */
export function resolveSettings(
  rows: readonly { key: string; value: unknown }[]
): AppSettings {
  const settings: AppSettings = { ...DEFAULT_SETTINGS };

  for (const row of rows) {
    if (!(SETTING_KEYS as string[]).includes(row.key)) continue;
    const key = row.key as SettingKey;
    const value = coerceSetting(key, row.value);
    if (value !== null) settings[key] = value;
  }

  return settings;
}

/**
 * Every setting, resolved. Memoized per request so a page that reads settings
 * for its copy and again for its controls still issues one query.
 */
export const getSettings = cache(async (): Promise<AppSettings> => {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('system_settings')
      .select('key, value')
      .in('key', SETTING_KEYS)
      .eq('is_sensitive', false);

    if (error) {
      console.warn('system_settings read failed; using defaults:', error.message);
      return { ...DEFAULT_SETTINGS };
    }

    return resolveSettings(data ?? []);
  } catch (error) {
    // Also covers non-request contexts (scripts, build) where no session client
    // can be created.
    console.warn('system_settings unavailable; using defaults:', error);
    return { ...DEFAULT_SETTINGS };
  }
});

export type { AppSettings, SettingKey };
