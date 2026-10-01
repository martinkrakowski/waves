import { describe, expect, it } from "vitest";

import {
  createFailureLimiter,
  createRateLimiter,
  EXPIRY_PROBES,
  FAILURE_LIMIT,
  FAILURE_WINDOW_MS,
  MAX_LIMITER_KEYS,
  PROJECT_INTERVAL_MS,
} from "../src/application/limiters.js";

function clock(startAt = 0): {
  readonly now: () => number;
  readonly pass: (ms?: number) => void;
} {
  let at = startAt;
  return {
    now: () => at,
    pass: (ms = 1_000) => {
      at += ms;
    },
  };
}

/** How many filler keys reach the bound once two have already been recorded. */
const FILLERS = MAX_LIMITER_KEYS - 2;

describe("createFailureLimiter", () => {
  it("locks an address out after ten failures and lets it back after the window", () => {
    const time = clock();
    const failures = createFailureLimiter(time.now);

    for (let attempt = 0; attempt < FAILURE_LIMIT; attempt += 1) {
      expect(failures.lockedOut("203.0.113.7")).toBe(false);
      failures.fail("203.0.113.7");
    }
    expect(failures.lockedOut("203.0.113.7")).toBe(true);
    time.pass(FAILURE_WINDOW_MS - 1);
    expect(failures.lockedOut("203.0.113.7")).toBe(true);
    time.pass(1);
    expect(failures.lockedOut("203.0.113.7")).toBe(false);
  });

  it("keeps one address out without touching another", () => {
    const failures = createFailureLimiter(() => 0);
    for (let attempt = 0; attempt < FAILURE_LIMIT; attempt += 1) {
      failures.fail("203.0.113.7");
    }

    expect(failures.lockedOut("203.0.113.8")).toBe(false);
  });

  it("starts the window again with the first failure after one has passed", () => {
    const time = clock();
    const failures = createFailureLimiter(time.now);
    for (let attempt = 0; attempt < FAILURE_LIMIT; attempt += 1) {
      failures.fail("203.0.113.7");
    }
    time.pass(FAILURE_WINDOW_MS);
    failures.fail("203.0.113.7");

    expect(failures.lockedOut("203.0.113.7")).toBe(false);
    failures.fail("203.0.113.7");
    expect(failures.lockedOut("203.0.113.7")).toBe(false);
  });

  it("drops the oldest address when ten thousand new ones need room", () => {
    // The clock never moves, so no window can pass and the only way
    // `lockedOut` can answer false again is eviction.
    const failures = createFailureLimiter(() => 0);
    for (let attempt = 0; attempt < FAILURE_LIMIT; attempt += 1) {
      failures.fail("203.0.113.7");
    }
    expect(failures.lockedOut("203.0.113.7")).toBe(true);

    for (let index = 0; index < MAX_LIMITER_KEYS; index += 1) {
      failures.fail(`filler-${index}`);
    }

    expect(failures.lockedOut("203.0.113.7")).toBe(false);
  });

  it("spends no one's lockout when a known address is refreshed at the bound", () => {
    const failures = createFailureLimiter(() => 0);
    for (let index = 0; index < MAX_LIMITER_KEYS; index += 1) {
      failures.fail(`filler-${index}`);
    }
    // The first of these takes the oldest filler's place; the one after it is now
    // the oldest. Both are locked out, and both were recorded by keys the map
    // already held afterwards.
    for (let attempt = 0; attempt < FAILURE_LIMIT; attempt += 1) {
      failures.fail("203.0.113.7");
    }
    for (let attempt = 0; attempt < FAILURE_LIMIT; attempt += 1) {
      failures.fail("filler-1");
    }
    expect(failures.lockedOut("filler-1")).toBe(true);
    expect(failures.lockedOut("203.0.113.7")).toBe(true);

    failures.fail("203.0.113.7");

    // Refreshing a key the map already holds takes no room: the oldest address is
    // still the one it was before this insert, rather than the one a
    // refresh-that-evicts would have dropped.
    expect(failures.lockedOut("filler-1")).toBe(true);
    expect(failures.lockedOut("203.0.113.7")).toBe(true);
  });

  it("drops an expired address before a live one", () => {
    const time = clock();
    const failures = createFailureLimiter(time.now);
    failures.fail("live-first");
    failures.fail("expired-second");
    for (let index = 0; index < FILLERS; index += 1) {
      failures.fail(`filler-${index}`);
    }
    time.pass(FAILURE_WINDOW_MS);
    // Every window has passed. Failing again for the oldest address starts a
    // fresh one where it sits, so the oldest entry is live again while the one
    // behind it is still expired.
    for (let attempt = 0; attempt < FAILURE_LIMIT; attempt += 1) {
      failures.fail("live-first");
    }
    expect(failures.lockedOut("live-first")).toBe(true);

    failures.fail("newcomer");

    // The insert needed room, and an entry nothing is counting is worth nothing:
    // the expired one went, and the live one in front of it stayed.
    expect(failures.lockedOut("expired-second")).toBe(false);
    expect(failures.lockedOut("live-first")).toBe(true);
  });
});

describe("createRateLimiter", () => {
  it("allows one attempt per second per key", () => {
    const time = clock();
    const rate = createRateLimiter(time.now);

    expect(rate.take("alpha")).toBe(true);
    expect(rate.take("alpha")).toBe(false);
    expect(rate.take("beta")).toBe(true);
    time.pass(PROJECT_INTERVAL_MS - 1);
    expect(rate.take("alpha")).toBe(false);
    time.pass(1);
    expect(rate.take("alpha")).toBe(true);
  });

  it("counts a refused attempt, so a caller cannot spend its allowance twice", () => {
    const time = clock();
    const rate = createRateLimiter(time.now);

    expect(rate.take("alpha")).toBe(true);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(rate.take("alpha")).toBe(false);
      time.pass(100);
    }
    expect(rate.take("alpha")).toBe(false);
    time.pass(PROJECT_INTERVAL_MS);
    expect(rate.take("alpha")).toBe(true);
  });

  it("drops a key when ten thousand new ones need room, with the clock frozen", () => {
    // Frozen: the interval cannot have passed, so a second `take` that succeeds
    // can only mean the entry is gone.
    const rate = createRateLimiter(() => 0);
    expect(rate.take("alpha")).toBe(true);
    expect(rate.take("alpha")).toBe(false);

    for (let index = 0; index < MAX_LIMITER_KEYS; index += 1) {
      rate.take(`filler-${index}`);
    }

    expect(rate.take("alpha")).toBe(true);
  });

  it("spends no one's interval when a key it already knows is refreshed", () => {
    const rate = createRateLimiter(() => 0);
    for (let index = 0; index < MAX_LIMITER_KEYS; index += 1) {
      rate.take(`filler-${index}`);
    }
    rate.take("alpha");
    rate.take("filler-1");
    expect(rate.take("filler-1")).toBe(false);

    rate.take("alpha");

    expect(rate.take("filler-1")).toBe(false);
    expect(rate.take("alpha")).toBe(false);
  });

  it("drops an expired key before a live one", () => {
    const time = clock();
    const rate = createRateLimiter(time.now);
    rate.take("live-first");
    rate.take("expired-second");
    for (let index = 0; index < FILLERS; index += 1) {
      rate.take(`filler-${index}`);
    }
    time.pass(PROJECT_INTERVAL_MS);
    // The interval has passed, so taking the oldest key again is allowed and
    // makes it live where it sits, in front of an entry that is still expired.
    expect(rate.take("live-first")).toBe(true);

    rate.take("newcomer");

    expect(rate.take("expired-second")).toBe(true);
    expect(rate.take("live-first")).toBe(false);
  });

  it("stops looking for an expired entry where it said it would", () => {
    const time = clock();
    const rate = createRateLimiter(time.now);
    for (let index = 0; index < MAX_LIMITER_KEYS; index += 1) {
      rate.take(`filler-${index}`);
    }
    time.pass(PROJECT_INTERVAL_MS);
    // The first eight entries are live again and sit in front of entries that
    // have expired, so an insert that must look no further than EXPIRY_PROBES
    // takes the oldest live one rather than the expired one behind them.
    for (let index = 0; index < EXPIRY_PROBES; index += 1) {
      expect(rate.take(`filler-${index}`)).toBe(true);
    }

    rate.take("newcomer");

    // The oldest live entry went, not the expired one behind the window an
    // unbounded sweep would have found: an expired key is allowed to go again
    // either way, so the only thing that distinguishes the two is a live key that
    // an unbounded sweep would have kept.
    expect(rate.take("filler-0")).toBe(true);
    expect(rate.take("newcomer")).toBe(false);
  });
});
