/** How many times a failing or unanswered request is repeated. */
export const MAX_RETRIES = 2;

/**
 * How many times a throttled request is repeated. Its own budget, because a
 * server that answers 429 with a Retry-After is telling the client to come
 * back, and a client that gives up after two seconds of politeness would fail
 * the very pushes it is being asked to slow down for.
 */
export const MAX_THROTTLE_RETRIES = 3;

export const FIRST_BACKOFF_MS = 1000;
export const SECOND_BACKOFF_MS = 2000;

/** The longest a server may hold a retry back, whatever its Retry-After says. */
export const MAX_RETRY_AFTER_SECONDS = 60;

const SECONDS = 1000;
const DELTA_SECONDS = /^\d{1,9}$/;

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
  | {
      readonly kind: "throttled";
      readonly retryAfter: string | undefined;
      /** The client's own clock, so an HTTP-date can be read as a delay. */
      readonly now: number;
    }
  | { readonly kind: "network" }
  | { readonly kind: "server" }
  | { readonly kind: "refused" };

export type RetryDecision =
  | { readonly kind: "wait"; readonly ms: number }
  | { readonly kind: "tooLong"; readonly seconds: number }
  | { readonly kind: "stop" };

/**
 * What to do after `retries` retries have already happened — `retries` is 0 for
 * the decision about the first repeat. `tooLong` is its own answer because a
 * server that asks for a longer wait than the cap must not be retried early:
 * the only correct reply is to stop and say what it asked for.
 */
export function decideRetry(
  outcome: RetryOutcome,
  retries: number,
): RetryDecision {
  if (outcome.kind === "refused") {
    return { kind: "stop" };
  }
  if (outcome.kind === "throttled") {
    if (retries >= MAX_THROTTLE_RETRIES) {
      return { kind: "stop" };
    }
    const seconds = askedToWait(outcome.retryAfter, outcome.now);
    if (seconds !== undefined) {
      if (seconds > MAX_RETRY_AFTER_SECONDS) {
        return { kind: "tooLong", seconds };
      }
      return { kind: "wait", ms: seconds * SECONDS };
    }
    return { kind: "wait", ms: backoffMs(retries) };
  }
  if (retries >= MAX_RETRIES) {
    return { kind: "stop" };
  }
  return { kind: "wait", ms: backoffMs(retries) };
}

/**
 * The seconds `Retry-After` asks for, or `undefined` when it names nothing this
 * client can read. Both forms of the header are accepted: delta-seconds, and an
 * HTTP-date read against the clock.
 */
export function askedToWait(
  header: string | undefined,
  now: number,
): number | undefined {
  if (header === undefined) {
    return undefined;
  }
  if (DELTA_SECONDS.test(header)) {
    return Number(header);
  }
  const date = Date.parse(header);
  if (Number.isNaN(date)) {
    return undefined;
  }
  return Math.max(0, Math.ceil((date - now) / SECONDS));
}

/** The backoff is one second, then two. `retries` is below the budget here. */
function backoffMs(retries: number): number {
  return retries === 0 ? FIRST_BACKOFF_MS : SECOND_BACKOFF_MS;
}
