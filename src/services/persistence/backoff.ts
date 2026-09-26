/**
 * Cloud retry backoff (plan05 §6): 1, 2, 4, 8, 16 s, then capped at 30 s.
 *
 * API:
 *   RETRY_BASE_MS = 1_000, RETRY_MAX_MS = 30_000
 *   backoffDelayMs(failureCount: number): number
 *     failureCount is the number of consecutive failures so far (1 = first failure).
 */
export const RETRY_BASE_MS = 1_000;
export const RETRY_MAX_MS = 30_000;

export function backoffDelayMs(failureCount: number): number {
  if (!Number.isFinite(failureCount) || failureCount < 1) return RETRY_BASE_MS;
  // 2^5 * 1 s = 32 s is already above the cap, so avoid huge exponents.
  const exponent = Math.min(Math.floor(failureCount) - 1, 5);
  return Math.min(RETRY_BASE_MS * 2 ** exponent, RETRY_MAX_MS);
}
