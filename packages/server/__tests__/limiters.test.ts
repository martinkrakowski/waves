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
    const time = clock();
    const failures = createFailureLimiter(time.now);
    // The map is brought to one below its bound with the eight in front of it
    // live, then made exactly full, so the refresh under test happens at the bound
    // without anything having been evicted to get there.
    for (let index = 0; index < EXPIRY_PROBES; index += 1) {
      failures.fail(`live-${index}`);
    }
    for (
      let index = 0;
      index < MAX_LIMITER_KEYS - 1 - EXPIRY_PROBES;
      index += 1
    ) {
      failures.fail(`filler-${index}`);
    }
    time.pass(FAILURE_WINDOW_MS);
    for (let index = 0; index < EXPIRY_PROBES; index += 1) {
      for (let attempt = 0; attempt < FAILURE_LIMIT; attempt += 1) {
        failures.fail(`live-${index}`);
      }
    }
    failures.fail("newcomer");
    expect(failures.lockedOut("live-0")).toBe(true);

    // One refresh of a key that is there but whose window has passed, with the
    // map exactly full. Refreshing a key the map already holds must not need room:
    // if it did, the sweep would find nothing live among the eight it looks at and
    // would drop the oldest live entry, which is a locked out address.
    failures.fail("filler-1");

    expect(failures.lockedOut("live-0")).toBe(true);
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

    failures.fail("newcomer");

    // The insert needed room, and an entry nothing is counting is worth nothing:
    // the live address in front of it stayed. An eviction that took the oldest
    // live entry instead would be caught here, because that address would be
    // gone; whether the expired one behind it went is not observable, and so is
    // not asserted.
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
    const time = clock();
    const rate = createRateLimiter(time.now);
    // The map is brought to one below its bound with the eight in front of it
    // live, then made exactly full, so the refresh under test happens at the bound
    // without anything having been evicted to get there.
    for (let index = 0; index < EXPIRY_PROBES; index += 1) {
      rate.take(`live-${index}`);
    }
    for (
      let index = 0;
      index < MAX_LIMITER_KEYS - 1 - EXPIRY_PROBES;
      index += 1
    ) {
      rate.take(`filler-${index}`);
    }
    time.pass(PROJECT_INTERVAL_MS);
    for (let index = 0; index < EXPIRY_PROBES; index += 1) {
      expect(rate.take(`live-${index}`)).toBe(true);
    }
    expect(rate.take("newcomer")).toBe(true);
    expect(rate.take("live-0")).toBe(false);

    // One refresh of a key that is there but whose interval has passed, with the
    // map exactly full. Refreshing a key the map already holds must not need room:
    // if it did, the sweep would find nothing live among the eight it looks at and
    // would drop the oldest live entry, which is a project mid-interval.
    rate.take("filler-1");

    expect(rate.take("live-0")).toBe(false);
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

    // The live key in front of the expired one is still holding that project off.
    // Whether the expired one behind it went is not observable — an expired key is
    // allowed to go again either way — so it is not asserted.
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
