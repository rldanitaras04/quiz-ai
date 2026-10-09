/**
 * In-process sliding-window rate limiter shared by the AI routes.
 *
 * Scope and honesty about what this is:
 *  - It is **best effort and per instance**. Serverless and multi-instance
 *    deployments give each instance its own counters, so the effective limit
 *    is (configured max × instance count). It exists to blunt accidental
 *    hammering and runaway client retry loops, not to enforce a billing
 *    boundary. If a hard global limit is ever required, the counter has to
 *    live in Postgres (see the note in `docs/`), not here.
 *  - Memory is **bounded**, which the two hand-rolled limiters this replaces
 *    were not: a key's history never exceeds `max` timestamps, and the number
 *    of tracked keys is capped at `maxKeys` with least-recently-used eviction.
 *    Without that cap, every distinct user id that ever called a route stayed
 *    in the map for the life of the process.
 *
 * Dependency-free on purpose so `tests/rate-limit.test.mjs` can import it
 * directly under `node --test` (the unit suite runs with no bundler, no
 * environment and no database) and so it can be reused from any runtime.
 */

export interface RateLimiterOptions {
  /** Length of the sliding window, in milliseconds. */
  windowMs: number;
  /** Requests permitted per key per window. */
  max: number;
  /**
   * Hard ceiling on tracked keys. When exceeded, the least-recently-used key
   * is dropped. Defaults to a few thousand keys; a key costs at most `max`
   * numbers, so the default keeps worst-case memory in the low megabytes.
   */
  maxKeys?: number;
  /** Clock injection for tests. Defaults to `Date.now`. */
  now?: () => number;
}

export interface RateLimiter {
  /**
   * Records one request for `key` and reports whether it is allowed.
   * Returns `false` once the key has used `max` requests in the window;
   * denied requests are not recorded, so a client that keeps hammering does
   * not extend its own lockout beyond the window.
   */
  check(key: string): boolean;
  /** Number of keys currently tracked (test/diagnostics helper). */
  size(): number;
}

const DEFAULT_MAX_KEYS = 5_000;

export function createRateLimiter({
  windowMs,
  max,
  maxKeys = DEFAULT_MAX_KEYS,
  now = Date.now,
}: RateLimiterOptions): RateLimiter {
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error('createRateLimiter: windowMs must be a positive number');
  }
  if (!Number.isFinite(max) || max < 1) {
    throw new Error('createRateLimiter: max must be at least 1');
  }
  if (!Number.isFinite(maxKeys) || maxKeys < 1) {
    throw new Error('createRateLimiter: maxKeys must be at least 1');
  }

  /** Insertion order is recency order: every check re-inserts its key. */
  const buckets = new Map<string, number[]>();

  function evictLeastRecentlyUsed(): void {
    while (buckets.size > maxKeys) {
      const oldest = buckets.keys().next();
      if (oldest.done) break;
      buckets.delete(oldest.value);
    }
  }

  return {
    check(key: string): boolean {
      const current = now();
      const cutoff = current - windowMs;

      const previous = buckets.get(key);
      // Re-insert so Map order tracks recency for eviction. This must happen
      // before any early return, otherwise a key that is being rate-limited
      // would look cold and get evicted while it is still active.
      buckets.delete(key);

      let stamps = previous ?? [];
      if (stamps.length > 0 && stamps[0] <= cutoff) {
        // The window has started rolling; drop everything that fell out.
        stamps = stamps.filter((stamp) => stamp > cutoff);
      }

      const allowed = stamps.length < max;
      if (allowed) stamps.push(current);

      buckets.set(key, stamps);
      evictLeastRecentlyUsed();

      return allowed;
    },

    size(): number {
      return buckets.size;
    },
  };
}
