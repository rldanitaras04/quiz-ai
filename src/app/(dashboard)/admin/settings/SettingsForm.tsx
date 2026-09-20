'use client';

import { useState, type JSX } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { notifyError, notifySuccess } from '@/components/ui/alerts';
import { SETTING_DEFS, SETTING_KEYS, type AppSettings, type SettingKey } from '@/lib/constants';
import { updateSettings } from './actions';

interface SettingsFormProps {
  settings: AppSettings;
}

/**
 * Editor for the values in `system_settings`. The ranges, steps and labels come
 * from `SETTING_DEFS`, which the server action validates against, so the form
 * cannot submit something the action will reject for a reason other than a
 * genuine race.
 */
export default function SettingsForm({ settings }: SettingsFormProps): JSX.Element {
  const router = useRouter();

  const [values, setValues] = useState<Record<SettingKey, string>>(
    () =>
      Object.fromEntries(SETTING_KEYS.map((key) => [key, String(settings[key])])) as Record<
        SettingKey,
        string
      >
  );
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<SettingKey, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  function setValue(key: SettingKey, value: string): void {
    setValues((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  /** Mirrors the server action's checks so mistakes surface without a round trip. */
  function validate(): Partial<Record<SettingKey, string>> {
    const errors: Partial<Record<SettingKey, string>> = {};

    for (const key of SETTING_KEYS) {
      const def = SETTING_DEFS[key];
      const raw = values[key].trim();
      const value = Number(raw);

      if (raw === '' || !Number.isFinite(value)) {
        errors[key] = 'Enter a number.';
      } else if (def.integer && !Number.isInteger(value)) {
        errors[key] = 'Whole numbers only.';
      } else if (value < def.min || value > def.max) {
        errors[key] = `Must be between ${def.min} and ${def.max}.`;
      }
    }

    return errors;
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setSaved(false);

    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setBusy(true);
    const payload = Object.fromEntries(
      SETTING_KEYS.map((key) => [key, Number(values[key])])
    ) as Record<SettingKey, number>;

    const result = await updateSettings(payload);
    setBusy(false);

    if ('error' in result) {
      setError(result.error);
      notifyError('Could not save the settings', result.error);
      return;
    }

    setSaved(true);
    notifySuccess('Settings saved');
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <h2 className="text-lg font-semibold text-[var(--color-foreground)]">
          Application Settings
        </h2>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {SETTING_KEYS.map((key) => {
            const def = SETTING_DEFS[key];
            return (
              <div key={key} className="max-w-sm">
                <Input
                  id={key}
                  label={def.label}
                  type="number"
                  inputMode={def.integer ? 'numeric' : 'decimal'}
                  min={def.min}
                  max={def.max}
                  step={def.step}
                  value={values[key]}
                  onChange={(e) => setValue(key, e.target.value)}
                  error={fieldErrors[key]}
                  required
                />
                <p className="mt-1.5 text-xs text-[var(--color-muted)]">{def.description}</p>
                <p className="mt-1 text-xs text-[var(--color-muted-light)]">
                  Default: {def.default}
                </p>
              </div>
            );
          })}

          {error && (
            <p className="text-sm text-[var(--color-danger)]" role="alert">
              {error}
            </p>
          )}
          {saved && (
            <p className="text-sm text-[var(--color-success)]" role="status">
              Settings saved.
            </p>
          )}

          <div className="flex items-center gap-3">
            <Button type="submit" loading={busy}>
              Save Settings
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setValues(
                  Object.fromEntries(
                    SETTING_KEYS.map((key) => [key, String(SETTING_DEFS[key].default)])
                  ) as Record<SettingKey, string>
                );
                setFieldErrors({});
                setError(null);
                setSaved(false);
              }}
            >
              Restore defaults
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
