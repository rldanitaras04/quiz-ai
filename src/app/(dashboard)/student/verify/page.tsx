import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { isManualRequestResendable } from '@/lib/identity-verification';
import PageHeader from '@/components/ui/PageHeader';
import VerifyIdentityClient from './VerifyIdentityClient';

export const dynamic = 'force-dynamic';

/**
 * Student identity verification (scope §5): explicit privacy/consent
 * notice, on-device MediaPipe challenge-response liveness (see
 * CaptureStage.tsx), settle through the shared adapter contract. The
 * faculty-authorized manual fallback stays available either way.
 */
export default async function StudentVerifyPage() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) redirect('/login');

  const { data: profile } = await supabase
    .from('student_profiles')
    .select('verification_status, verification_provider, verification_verified_at, verification_requested_at')
    .eq('user_id', user.id)
    .maybeSingle();

  const requestedAt = (profile?.verification_requested_at as string | null) ?? null;
  // Cooldown decision evaluated per request (see isManualRequestResendable);
  // after an in-page resend the client flips its local copy to false, and a
  // later page load re-evaluates expiry.
  const resendAllowed = isManualRequestResendable(requestedAt);

  return (
    <div>
      <PageHeader
        title="Identity Verification"
        description="Verify your identity for exams that require it"
      />
      <VerifyIdentityClient
        status={(profile?.verification_status as string | null) ?? 'pending'}
        provider={(profile?.verification_provider as string | null) ?? null}
        verifiedAt={(profile?.verification_verified_at as string | null) ?? null}
        requestedAt={requestedAt}
        resendAllowed={resendAllowed}
      />
    </div>
  );
}
