import type { Now } from "./read-model.js";

export const FAILURE_WINDOW_MS = 60_000;
export const FAILURE_LIMIT = 10;
export const PROJECT_INTERVAL_MS = 1_000;

/**
 * The bound on the keys one limiter remembers. A map keyed by a client address
 * is attacker-controlled, so it cannot grow without a limit; what is dropped to
 * make room is chosen by `remember` below.
 */
export const MAX_LIMITER_KEYS = 10_000;

/**
 * How far into the map an insert looks for an expired entry before giving up and
 * taking the oldest live one. Bounded so one insert costs the same whatever the
 * map holds: 10,000 live entries must not become 10,000 comparisons per request.
 * It is a small number because an entry's window starts when its key is first
 * seen, so the expired ones sit at the oldest end of the map.
 */
export const EXPIRY_PROBES = 8;

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

/**
 * Puts a value in a bounded map, dropping something only when a key that is not
 * already there needs room. A key that is already remembered is refreshed in
 * place and evicts nothing: an address cannot spend another address's lockout
 * by failing again, and a project cannot push another's entry out by pushing.
 *
 * What is dropped is an expired entry first, found within `EXPIRY_PROBES` of
 * the oldest end, because an entry nothing is counting any more is worth
 * nothing. Only when every entry looked at is still live does the oldest one
 * go, which is the price of the bound: a locked out address can be evicted, and
 * so can the next few addresses behind it.
 */
function remember<T>(
  map: Map<string, T>,
  key: string,
  value: T,
  expired: (held: T) => boolean,
): void {
  if (map.has(key)) {
    map.set(key, value);
    return;
  }
  if (map.size >= MAX_LIMITER_KEYS) {
    evictExpired(map, expired);
    if (map.size >= MAX_LIMITER_KEYS) {
      evictOldest(map);
    }
  }
  map.set(key, value);
}

function evictExpired<T>(
  map: Map<string, T>,
  expired: (held: T) => boolean,
): void {
  let probes = EXPIRY_PROBES;
  for (const held of map.keys()) {
    if (expired(map.get(held) as T)) {
      map.delete(held);
      return;
    }
    probes -= 1;
    if (probes === 0) {
      return;
    }
  }
}

function evictOldest(map: Map<string, unknown>): void {
  for (const key of map.keys()) {
    map.delete(key);
    return;
  }
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
      remember(windows, address, { count: 1, since: at }, (held) => {
        return at - held.since >= FAILURE_WINDOW_MS;
      });
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
      remember(last, key, at, (held) => at - held >= PROJECT_INTERVAL_MS);

      return true;
    },
  };
}
