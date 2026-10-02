import { NextResponse } from 'next/server';
import { runScheduledMaintenance } from '@/lib/scheduler';

/**
 * HTTP entry point for the scheduled-maintenance sweep, for hosts and
 * environments with no pg_cron (see migration 20261006000000). Vercel's cron
 * runner sends `Authorization: Bearer $CRON_SECRET` automatically when a
 * CRON_SECRET environment variable is configured; anything else is refused.
 *
 * With no CRON_SECRET configured the endpoint refuses to run rather than
 * expose an open trigger. That refusal is a 401 (no one can authenticate
 * without a configured secret), not a 503: it keeps route-probe tooling
 * (scripts/check-routes.mjs) from reading an intentionally-disabled cron as a
 * server error. The sweep itself is idempotent and time-gated, so even a
 * called sweep only performs transitions the database clock allows.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured' },
      { status: 401 }
    );
  }

  const authorization = request.headers.get('authorization');
  if (authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await runScheduledMaintenance();
  if (!result) {
    return NextResponse.json({ error: 'Maintenance failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, ...result });
}
