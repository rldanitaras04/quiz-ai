'use client';

/**
 * Consent → capture → settle flow for /student/verify (scope §5).
 *
 * - Explicit consent checkbox BEFORE any camera/token work; the server
 *   action records `verification_consent_at` and the adapter refuses to
 *   verify without it.
 * - Capture runs on-device in `CaptureStage` (MediaPipe); only coarse
 *   evidence is settled through `completeIdentityVerification`.
 * - The manual fallback is reachable in-app too: "Request manual
 *   verification" notifies the student's instructors
 *   (`requestManualVerification`), who grant the status from the roster.
 * - No adapter configured → faculty manual fallback copy (scope keeps that
 *   path active alongside any provider).
 */

import { useCallback, useState, type JSX } from 'react';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { notifyError, notifySuccess } from '@/components/ui/alerts';
import CaptureStage, { type EvidencePayload } from './CaptureStage';
import {
  completeIdentityVerification,
  requestManualVerification,
  startIdentityVerification,
} from './actions';

type Phase = 'idle' | 'starting' | 'capturing' | 'submitting' | 'done';

interface VerifyIdentityClientProps {
  status: string;
  provider: string | null;
  verifiedAt: string | null;
  /** When the student last asked an instructor to verify them manually. */
  requestedAt: string | null;
  /** Cooldown elapsed (computed server-side; flipped locally after resend). */
  resendAllowed: boolean;
}

const PROVIDER_LABELS: Record<string, string> = {
  mediapipe: 'Face liveness (MediaPipe, on-device)',
};

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}

function VerifiedCard({
  provider,
  verifiedAt,
}: {
  provider: string | null;
  verifiedAt: string | null;
}): JSX.Element {
  return (
    <Card className="max-w-xl">
      <CardHeader>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          Identity verified
          <Badge variant="success">verified</Badge>
        </h2>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-[var(--color-muted)]">
          Your identity has been verified{provider ? ` (${PROVIDER_LABELS[provider] ?? provider})` : ''}
          {verifiedAt ? ` on ${formatDate(verifiedAt)}` : ''}. You can start
          identity-gated exams now.
        </p>
        <div className="flex gap-3">
          <Link href="/student/assessments">
            <Button>Go to my assessments</Button>
          </Link>
          <Link href="/profile">
            <Button variant="secondary">Back to profile</Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

export default function VerifyIdentityClient({
  status,
  provider,
  verifiedAt,
  requestedAt: initialRequestedAt,
  resendAllowed: initialResendAllowed,
}: VerifyIdentityClientProps): JSX.Element {
  const [phase, setPhase] = useState<Phase>('idle');
  const [consented, setConsented] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [session, setSession] = useState<{ token: string; challenges: string[] } | null>(null);
  const [requestedAt, setRequestedAt] = useState<string | null>(initialRequestedAt);
  const [resendAllowed, setResendAllowed] = useState(initialResendAllowed);
  const [requesting, setRequesting] = useState(false);

  const handleRequestManual = useCallback(async () => {
    setRequesting(true);
    try {
      const res = await requestManualVerification();
      if (res.ok) {
        setRequestedAt(res.requestedAt ?? new Date().toISOString());
        setResendAllowed(false);
        notifySuccess(
          'Request sent',
          res.alreadyRequested
            ? 'Your instructors were already notified — give them a moment to check.'
            : 'Your instructors will see the request on their course roster.'
        );
      } else {
        notifyError('Could not send the request', res.error ?? 'Please try again.');
      }
    } catch {
      notifyError('Could not send the request', 'Please try again.');
    } finally {
      setRequesting(false);
    }
  }, []);

  const handleStart = useCallback(async () => {
    setPhase('starting');
    setError(null);
    setNotConfigured(false);
    try {
      const res = await startIdentityVerification();
      if (res.notConfigured) {
        setNotConfigured(true);
        setError(res.error ?? null);
        setPhase('idle');
        return;
      }
      if (!res.ok || !res.token || !Array.isArray(res.challenges) || res.challenges.length === 0) {
        setError(res.error ?? 'Could not start verification.');
        setPhase('idle');
        return;
      }
      setSession({ token: res.token, challenges: res.challenges });
      setPhase('capturing');
    } catch {
      setError('Could not start verification. Please try again.');
      setPhase('idle');
    }
  }, []);

  const handleCaptured = useCallback(
    async (evidence: EvidencePayload) => {
      if (!session) return;
      setPhase('submitting');
      setError(null);
      try {
        const res = await completeIdentityVerification(
          session.token,
          evidence as unknown as Record<string, unknown>
        );
        if (res.ok || res.alreadyVerified) {
          setPhase('done');
          return;
        }
        setError(res.error ?? 'Verification failed. Please try again.');
        setSession(null);
        setPhase('idle');
      } catch {
        setError('Verification failed. Please try again.');
        setSession(null);
        setPhase('idle');
      }
    },
    [session]
  );

  const handleCancel = useCallback(() => {
    setSession(null);
    setError(null);
    setPhase('idle');
  }, []);

  if (status === 'verified' || phase === 'done') {
    return <VerifiedCard provider={provider} verifiedAt={verifiedAt} />;
  }

  return (
    <div className="space-y-4">
      <Card className="max-w-xl">
        <CardHeader>
          <h2 className="text-lg font-semibold">Verify your identity</h2>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p className="text-[var(--color-muted)]">
            Some instructors require identity verification before you can start
            an exam. You will be guided through a few quick liveness challenges
            in front of your camera.
          </p>

          <div className="space-y-2 rounded-md bg-[var(--color-surface)] border border-[var(--color-border)] p-3">
            <p className="font-medium">Your privacy</p>
            <ul className="list-disc space-y-1 pl-5 text-[var(--color-muted)]">
              <li>
                Face tracking runs entirely in your browser (MediaPipe, on
                device). No photo, video, or face data is uploaded or stored.
              </li>
              <li>
                We store only the result, the time, which checks ran, and
                coarse timing — nothing that can reconstruct your face.
              </li>
              <li>
                Prefer not to? You can ask your instructor to verify your
                identity manually instead.
              </li>
            </ul>
          </div>

          {phase !== 'capturing' && phase !== 'submitting' && (
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-1"
                checked={consented}
                onChange={(e) => setConsented(e.target.checked)}
              />
              <span>
                I have read the privacy notice above and consent to this face
                verification check.
              </span>
            </label>
          )}

          {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}

          {notConfigured ? (
            <div className="space-y-3">
              <p className="text-sm text-[var(--color-muted)]">
                Ask your instructor to verify your identity from the course
                roster — the faculty-authorized manual check works the same way.
              </p>
              <Link href="/student/assessments">
                <Button variant="secondary">Back to my assessments</Button>
              </Link>
            </div>
          ) : phase === 'capturing' && session ? (
            <CaptureStage
              token={session.token}
              challenges={session.challenges}
              onCaptured={handleCaptured}
              onCancel={handleCancel}
            />
          ) : phase === 'submitting' ? (
            <p className="text-sm text-[var(--color-muted)]">
              Submitting your verification result…
            </p>
          ) : (
            <div className="flex gap-3">
              <Button onClick={handleStart} disabled={!consented} loading={phase === 'starting'}>
                {phase === 'starting' ? 'Preparing…' : 'Start verification'}
              </Button>
              <Link href="/profile">
                <Button variant="ghost">Not now</Button>
              </Link>
            </div>
          )}
        </CardContent>
      </Card>

      {status !== 'verified' && (
        <Card className="max-w-xl">
          <CardHeader>
            <h2 className="text-lg font-semibold">Prefer a manual check?</h2>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {requestedAt && !resendAllowed ? (
              <>
                <p>
                  Manual verification requested on {formatDate(requestedAt)} —
                  waiting for your instructor.
                </p>
                <p className="text-[var(--color-muted)]">
                  Once they confirm your institutional ID on the course roster,
                  you can start exams that require verification.
                </p>
              </>
            ) : (
              <>
                <p className="text-[var(--color-muted)]">
                  {requestedAt
                    ? `Your last request was sent on ${formatDate(requestedAt)}. Send it again if your instructor has not seen it.`
                    : 'Ask your instructor to check your institutional ID in person — no camera needed. They verify you from the course roster.'}
                </p>
                <Button variant="outline" loading={requesting} onClick={handleRequestManual}>
                  Request manual verification
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
