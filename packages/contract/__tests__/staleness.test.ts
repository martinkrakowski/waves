import { describe, expect, it } from "vitest";

import { isRetained, isStale, staleAfterMs } from "../src/index.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_MS = 14 * DAY_MS;
const LAST_PUSH_MS = 1_767_225_600_000;

describe("staleAfterMs", () => {
  it("triples the interval", () => {
    expect(staleAfterMs(1)).toBe(3_000);
    expect(staleAfterMs(10)).toBe(30_000);
  });

  it("caps the window at 300 seconds", () => {
    expect(staleAfterMs(100)).toBe(300_000);
    expect(staleAfterMs(300)).toBe(300_000);
  });

  it("uses 300 seconds when there is no interval", () => {
    expect(staleAfterMs(null)).toBe(300_000);
  });
});

describe("isStale", () => {
  it("is not stale exactly on the boundary for an interval of 10", () => {
    expect(isStale(LAST_PUSH_MS, 10, LAST_PUSH_MS + 30_000)).toBe(false);
    expect(isStale(LAST_PUSH_MS, 10, LAST_PUSH_MS + 30_001)).toBe(true);
  });

  it("is not stale exactly on the boundary for an interval of 300", () => {
    expect(isStale(LAST_PUSH_MS, 300, LAST_PUSH_MS + 300_000)).toBe(false);
    expect(isStale(LAST_PUSH_MS, 300, LAST_PUSH_MS + 300_001)).toBe(true);
  });

  it("is not stale exactly on the boundary without an interval", () => {
    expect(isStale(LAST_PUSH_MS, null, LAST_PUSH_MS + 300_000)).toBe(false);
    expect(isStale(LAST_PUSH_MS, null, LAST_PUSH_MS + 300_001)).toBe(true);
  });

  it("is not stale before a fresh push", () => {
    expect(isStale(LAST_PUSH_MS, 10, LAST_PUSH_MS)).toBe(false);
  });
});

describe("isRetained", () => {
  it("retains a snapshot exactly 14 days old", () => {
    expect(isRetained(LAST_PUSH_MS, LAST_PUSH_MS + RETENTION_MS)).toBe(true);
  });

  it("drops a snapshot one millisecond past 14 days", () => {
    expect(isRetained(LAST_PUSH_MS, LAST_PUSH_MS + RETENTION_MS + 1)).toBe(
      false,
    );
  });

  it("retains a snapshot younger than 14 days", () => {
    expect(isRetained(LAST_PUSH_MS, LAST_PUSH_MS + RETENTION_MS - 1)).toBe(
      true,
    );
    expect(isRetained(LAST_PUSH_MS, LAST_PUSH_MS)).toBe(true);
  });
});
