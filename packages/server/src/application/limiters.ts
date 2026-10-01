import type { Now } from "./read-model.js";

export const FAILURE_WINDOW_MS = 60_000;
export const FAILURE_LIMIT = 10;
export const PROJECT_INTERVAL_MS = 1_000;

/**
 * The bound on the keys one limiter remembers. A map keyed by a client address
 * is attacker-controlled, so it cannot grow without a limit; the oldest key is
 * dropped to make room, which is why the maps are insertion ordered and why a
 * locked out address can be evicted rather than kept forever.
 */
export const MAX_LIMITER_KEYS = 10_000;

interface Window {
  count: number;
  since: number;
}

export interface FailureLimiter {
  /** True while this address has spent its allowance of failed attempts. */
  lockedOut(address: string): boolean;
  /** Records one failed authentication for this address. */
  fail(address: string): void;
}

export interface RateLimiter {
  /** True when this key may attempt now; records the attempt either way. */
  take(key: string): boolean;
}

function evictOldest(map: Map<string, unknown>): void {
  for (const key of map.keys()) {
    map.delete(key);
    return;
  }
}

function remember<T>(map: Map<string, T>, key: string, value: T): void {
  if (map.size >= MAX_LIMITER_KEYS) {
    evictOldest(map);
  }
  map.set(key, value);
}

/**
 * Failed authentications per client address, in a window that starts at the
 * first failure and is not extended by the failures inside it: ten failures in
 * sixty seconds from one address, and the eleventh attempt is answered 429
 * before any digest is computed. Every entry is one small object, so the
 * memory this can hold is the key count and nothing else.
 */
export function createFailureLimiter(now: Now): FailureLimiter {
  const windows = new Map<string, Window>();

  return {
    lockedOut(address) {
      const window = windows.get(address);
      if (window === undefined || now() - window.since >= FAILURE_WINDOW_MS) {
        return false;
      }
      return window.count >= FAILURE_LIMIT;
    },

    fail(address) {
      const at = now();
      const window = windows.get(address);
      if (window !== undefined && at - window.since < FAILURE_WINDOW_MS) {
        window.count += 1;
        return;
      }
      remember(windows, address, { count: 1, since: at });
    },
  };
}

/**
 * One write per second per project, counting every authenticated attempt and
 * not only the accepted ones: a caller that keeps pushing at a refused token
 * spends the same allowance as one that succeeds, so guessing costs it the same
 * as using. Only the last attempt per key is kept, so the map cannot grow with
 * the number of attempts.
 */
export function createRateLimiter(now: Now): RateLimiter {
  const last = new Map<string, number>();

  return {
    take(key) {
      const at = now();
      const previous = last.get(key);
      if (previous !== undefined && at - previous < PROJECT_INTERVAL_MS) {
        return false;
      }
      remember(last, key, at);

      return true;
    },
  };
}
