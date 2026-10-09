import { logger } from './logger.ts';

/**
 * Client-safe body for an unexpected failure.
 *
 * The original error (a provider message, a Postgres complaint, a stack trace)
 * stays in the server log; the client receives a stable generic message plus a
 * correlation id, so internals never cross the wire and support can still match
 * a user's report to the exact log line.
 */
export interface InternalErrorBody {
  error: string;
  requestId: string;
}

/**
 * Logs `error` with a fresh correlation id and returns the payload to send.
 *
 * Use for anything unexpected (5xx). Deliberate, validated 4xx messages that
 * describe the caller's own input are fine to return as-is — this is about
 * accident, not about every error.
 */
export function toInternalError(error: unknown, context: string): InternalErrorBody {
  const requestId = crypto.randomUUID();
  logger.error(`${context} failed [requestId=${requestId}]:`, error);
  return { error: 'Internal server error', requestId };
}
