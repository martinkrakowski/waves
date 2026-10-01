import { describe, expect, it } from "vitest";

import {
  FIRST_BACKOFF_MS,
  MAX_RETRIES,
  MAX_RETRY_AFTER_SECONDS,
  MAX_THROTTLE_RETRIES,
  SECOND_BACKOFF_MS,
  askedToWait,
  decideRetry,
} from "../src/domain/retry.js";

const NOW = Date.parse("2026-02-03T04:05:06.789Z");

describe("askedToWait", () => {
  it("reads delta-seconds", () => {
    expect(askedToWait("3", NOW)).toBe(3);
    expect(askedToWait("0", NOW)).toBe(0);
  });

  it("reads an HTTP-date against the clock", () => {
    expect(askedToWait("Tue, 03 Feb 2026 04:05:09 GMT", NOW)).toBe(3);
    expect(askedToWait("Tue, 03 Feb 2026 04:05:06 GMT", NOW)).toBe(0);
  });

  it("never asks to wait for less than nothing", () => {
    expect(askedToWait("Tue, 03 Feb 2026 03:00:00 GMT", NOW)).toBe(0);
  });

  it("has nothing to say about a header it cannot read", () => {
    expect(askedToWait(undefined, NOW)).toBeUndefined();
    expect(askedToWait("soon", NOW)).toBeUndefined();
  });
});

describe("decideRetry", () => {
  it("never repeats a request the server refused", () => {
    expect(decideRetry({ kind: "refused" }, 0)).toEqual({ kind: "stop" });
  });

  it("backs off one second and then two", () => {
    expect(decideRetry({ kind: "network" }, 0)).toEqual({
      kind: "wait",
      ms: FIRST_BACKOFF_MS,
    });
    expect(decideRetry({ kind: "network" }, 1)).toEqual({
      kind: "wait",
      ms: SECOND_BACKOFF_MS,
    });
    expect(decideRetry({ kind: "server" }, 0)).toEqual({
      kind: "wait",
      ms: FIRST_BACKOFF_MS,
    });
    expect(decideRetry({ kind: "server" }, 1)).toEqual({
      kind: "wait",
      ms: SECOND_BACKOFF_MS,
    });
  });

  it("stops after two retries of a failed or unanswered request", () => {
    expect(decideRetry({ kind: "network" }, MAX_RETRIES)).toEqual({
      kind: "stop",
    });
    expect(decideRetry({ kind: "server" }, MAX_RETRIES)).toEqual({
      kind: "stop",
    });
  });

  it("waits exactly as long as Retry-After asks, in either form", () => {
    expect(
      decideRetry({ kind: "throttled", retryAfter: "3", now: NOW }, 0),
    ).toEqual({ kind: "wait", ms: 3000 });
    expect(
      decideRetry(
        {
          kind: "throttled",
          retryAfter: "Tue, 03 Feb 2026 04:05:09 GMT",
          now: NOW,
        },
        0,
      ),
    ).toEqual({ kind: "wait", ms: 3000 });
  });

  it("honours a wait up to sixty seconds", () => {
    expect(
      decideRetry(
        {
          kind: "throttled",
          retryAfter: String(MAX_RETRY_AFTER_SECONDS),
          now: NOW,
        },
        0,
      ),
    ).toEqual({ kind: "wait", ms: MAX_RETRY_AFTER_SECONDS * 1000 });
  });

  it("refuses to retry early when the server asks for longer", () => {
    expect(
      decideRetry({ kind: "throttled", retryAfter: "61", now: NOW }, 0),
    ).toEqual({ kind: "tooLong", seconds: 61 });
    expect(
      decideRetry(
        {
          kind: "throttled",
          retryAfter: "Tue, 03 Feb 2026 04:06:07 GMT",
          now: NOW,
        },
        0,
      ),
    ).toEqual({ kind: "tooLong", seconds: 61 });
  });

  it("falls back to the backoff when Retry-After names nothing readable", () => {
    expect(
      decideRetry({ kind: "throttled", retryAfter: undefined, now: NOW }, 0),
    ).toEqual({ kind: "wait", ms: FIRST_BACKOFF_MS });
    expect(
      decideRetry({ kind: "throttled", retryAfter: undefined, now: NOW }, 1),
    ).toEqual({ kind: "wait", ms: SECOND_BACKOFF_MS });
  });

  it("gives a throttled request three retries of its own", () => {
    const throttled = { kind: "throttled", retryAfter: "1", now: NOW } as const;
    expect(decideRetry(throttled, MAX_THROTTLE_RETRIES - 1)).toEqual({
      kind: "wait",
      ms: 1000,
    });
    expect(decideRetry(throttled, MAX_THROTTLE_RETRIES)).toEqual({
      kind: "stop",
    });
  });

  it("stops a throttled request whose budget is spent, whatever it asked for", () => {
    expect(
      decideRetry(
        { kind: "throttled", retryAfter: "600", now: NOW },
        MAX_THROTTLE_RETRIES,
      ),
    ).toEqual({ kind: "stop" });
  });
});
