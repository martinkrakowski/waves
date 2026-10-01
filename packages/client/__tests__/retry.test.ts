import { describe, expect, it } from "vitest";

import {
  FIRST_BACKOFF_MS,
  MAX_RETRIES,
  MAX_RETRY_AFTER_MS,
  SECOND_BACKOFF_MS,
  retryDelay,
} from "../src/domain/retry.js";

describe("retryDelay", () => {
  it("never repeats a request the server refused", () => {
    expect(retryDelay({ kind: "refused" }, 0)).toBeUndefined();
  });

  it("stops after two retries whatever the reason", () => {
    expect(retryDelay({ kind: "network" }, MAX_RETRIES)).toBeUndefined();
    expect(retryDelay({ kind: "server" }, MAX_RETRIES)).toBeUndefined();
    expect(
      retryDelay({ kind: "throttled", retryAfter: "1" }, MAX_RETRIES),
    ).toBe(undefined);
  });

  it("backs off one second and then two", () => {
    expect(retryDelay({ kind: "network" }, 0)).toBe(FIRST_BACKOFF_MS);
    expect(retryDelay({ kind: "network" }, 1)).toBe(SECOND_BACKOFF_MS);
    expect(retryDelay({ kind: "server" }, 0)).toBe(FIRST_BACKOFF_MS);
    expect(retryDelay({ kind: "server" }, 1)).toBe(SECOND_BACKOFF_MS);
  });

  it("waits exactly as long as Retry-After asks", () => {
    expect(retryDelay({ kind: "throttled", retryAfter: "3" }, 0)).toBe(3000);
    expect(retryDelay({ kind: "throttled", retryAfter: "0" }, 0)).toBe(0);
  });

  it("refuses to wait longer than five seconds", () => {
    expect(retryDelay({ kind: "throttled", retryAfter: "60" }, 0)).toBe(
      MAX_RETRY_AFTER_MS,
    );
  });

  it("falls back to the backoff when Retry-After is missing or not a number", () => {
    expect(retryDelay({ kind: "throttled", retryAfter: undefined }, 0)).toBe(
      FIRST_BACKOFF_MS,
    );
    expect(retryDelay({ kind: "throttled", retryAfter: undefined }, 1)).toBe(
      SECOND_BACKOFF_MS,
    );
    expect(
      retryDelay(
        { kind: "throttled", retryAfter: "Wed, 21 Oct 2026 07:28:00 GMT" },
        0,
      ),
    ).toBe(FIRST_BACKOFF_MS);
  });
});
