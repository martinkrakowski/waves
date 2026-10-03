import { describe, expect, it } from "vitest";

import { sendStatus } from "../src/application/status.js";
import type { Command } from "../src/domain/args.js";
import {
  CONFIG_DIR,
  PROJECT,
  PROJECT_TOKEN,
  harness,
  network,
  reply,
} from "./support/harness.js";

type StatusCommand = Extract<Command, { readonly kind: "status" }>;

const tokenPath = `${CONFIG_DIR}/${PROJECT}.token`;
const ACCEPTED = '{"receivedAt":"2026-02-03T04:05:07.001Z"}';

const COMMAND: StatusCommand = {
  kind: "status",
  source: { kind: "stdin" },
  intervalSeconds: null,
};

/** A project that is alive and has news: one unread PR row and a plan. */
const STATUS = JSON.stringify({
  prs: { skipped: 2 },
  backlog: { state: "recorded", at: "2026-10-03T07:55:00Z" },
});

function harnessFor(script: readonly ReturnType<typeof reply>[]) {
  return harness({
    script,
    stdin: STATUS,
    files: { [tokenPath]: { text: PROJECT_TOKEN, mode: 0o600 } },
  });
}

/**
 * The retry policy, which a status shares with a push and now runs through one
 * function: two budgets, a 429 waited for as the server asked, and every other
 * ending a failure that is never repeated.
 */
describe("the retry policy of a status", () => {
  it("waits for Retry-After when the server throttles it", async () => {
    const built = harnessFor([
      reply(429, '{"error":"slow down"}', { "retry-after": "1" }),
      reply(200, ACCEPTED),
    ]);

    expect(await sendStatus(COMMAND, built.deps)).toBe(0);
    expect(built.waits).toEqual([1000]);
    expect(built.sent()).toBe(2);
  });

  it("gives up after three throttles", async () => {
    const throttled = reply(429, "", { "retry-after": "1" });
    const built = harnessFor([throttled, throttled, throttled, throttled]);

    await expect(sendStatus(COMMAND, built.deps)).rejects.toThrow(
      "status failed: 429 Too Many Requests",
    );
    expect(built.sent()).toBe(4);
    expect(built.waits).toEqual([1000, 1000, 1000]);
  });

  it("retries a 5xx and then gives up, naming it", async () => {
    const broken = reply(503, "");
    const built = harnessFor([broken, broken, broken]);

    await expect(sendStatus(COMMAND, built.deps)).rejects.toThrow(
      "status failed: 503 Service Unavailable",
    );
    expect(built.sent()).toBe(3);
    expect(built.waits).toEqual([1000, 2000]);
  });

  it("retries a request that got no answer at all", async () => {
    const built = harnessFor([network("socket hang up"), reply(200, ACCEPTED)]);

    expect(await sendStatus(COMMAND, built.deps)).toBe(0);
    expect(built.waits).toEqual([1000]);
    expect(built.sent()).toBe(2);
  });

  it("never repeats a request the server refused, and prints its reason", async () => {
    const built = harnessFor([
      reply(401, '{"error":"unauthorized"}', {
        "www-authenticate": 'Bearer realm="waves"',
      }),
      reply(200, ACCEPTED),
    ]);

    await expect(sendStatus(COMMAND, built.deps)).rejects.toThrow(
      "status failed: 401 Unauthorized\n  unauthorized",
    );
    expect(built.sent()).toBe(1);
    expect(built.waits).toEqual([]);
  });
});
