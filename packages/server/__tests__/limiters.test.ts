import { describe, expect, it } from "vitest";

import {
  createFailureLimiter,
  createRateLimiter,
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

  it("remembers at most ten thousand addresses, dropping the oldest", () => {
    const failures = createFailureLimiter(() => 0);

    for (let index = 0; index < MAX_LIMITER_KEYS * 2; index += 1) {
      failures.fail(`203.0.113.${index}`);
    }
    for (let index = 0; index < FAILURE_LIMIT; index += 1) {
      failures.fail("203.0.113.0");
    }

    expect(failures.lockedOut("203.0.113.0")).toBe(true);
    expect(failures.lockedOut("203.0.113.19999")).toBe(false);
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

  it("remembers at most ten thousand keys, dropping the oldest", () => {
    const time = clock();
    const rate = createRateLimiter(time.now);

    for (let index = 0; index < MAX_LIMITER_KEYS * 2; index += 1) {
      time.pass(PROJECT_INTERVAL_MS);
      expect(rate.take(`alpha-${index}`)).toBe(true);
    }

    expect(rate.take("alpha-19999")).toBe(false);
    expect(rate.take("alpha-0")).toBe(true);
  });
});
