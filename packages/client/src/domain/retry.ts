/** How many times a throttled, failing or unanswered request is repeated. */
export const MAX_RETRIES = 2;

export const FIRST_BACKOFF_MS = 1000;
export const SECOND_BACKOFF_MS = 2000;

/** The longest a server may hold a retry back, whatever its Retry-After says. */
export const MAX_RETRY_AFTER_MS = 5000;

const SECONDS = 1000;
const INTEGER = /^\d{1,5}$/;

/**
 * What the last attempt came back with, as far as the retry policy cares:
 *
 * - `throttled` — 429, so the server named a delay in `Retry-After`;
 * - `network` — no answer at all, which is often a proxy in the way;
 * - `server` — 5xx, which is the server's problem and may pass;
 * - `refused` — any other 4xx, which is a verdict about this request. Repeating
 *   it would only send the same bad snapshot again.
 */
export type RetryOutcome =
  | { readonly kind: "throttled"; readonly retryAfter: string | undefined }
  | { readonly kind: "network" }
  | { readonly kind: "server" }
  | { readonly kind: "refused" };

/** How long to wait before the retry numbered `retry` (0 is the first), or undefined to give up. */
export function retryDelay(
  outcome: RetryOutcome,
  retry: number,
): number | undefined {
  if (outcome.kind === "refused" || retry >= MAX_RETRIES) {
    return undefined;
  }
  if (outcome.kind === "throttled") {
    return capRetryAfter(
      parseRetryAfter(outcome.retryAfter) ?? backoffMs(retry),
    );
  }
  return backoffMs(retry);
}

/** The backoff is one second, then two. `retry` is below `MAX_RETRIES` here. */
function backoffMs(retry: number): number {
  return retry === 0 ? FIRST_BACKOFF_MS : SECOND_BACKOFF_MS;
}

/** `Retry-After` is delta-seconds; an HTTP-date is not honoured and the backoff stands. */
function parseRetryAfter(header: string | undefined): number | undefined {
  if (header === undefined || !INTEGER.test(header)) {
    return undefined;
  }
  return Number(header) * SECONDS;
}

function capRetryAfter(ms: number): number {
  return Math.min(ms, MAX_RETRY_AFTER_MS);
}
