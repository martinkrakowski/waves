import { describe, expect, it } from "vitest";

import type { Command } from "../src/domain/args.js";
import { report } from "../src/application/report.js";
import {
  CONFIG_DIR,
  PROJECT,
  PROJECT_TOKEN,
  harness,
  network,
  reply,
  type HarnessInput,
} from "./support/harness.js";

type ReportCommand = Extract<
  Command,
  { readonly kind: "decision"; readonly action: "report" }
>;

const tokenPath = `${CONFIG_DIR}/${PROJECT}.token`;
const STATES_URL = `http://127.0.0.1:8080/api/v1/projects/${PROJECT}/decisions/d1/states`;
const SHA = "a".repeat(64);
const ACCEPTED = JSON.stringify({ index: 0 });

function command(overrides: Partial<ReportCommand> = {}): ReportCommand {
  return {
    kind: "decision",
    action: "report",
    id: "d1",
    state: "approved",
    words: "go with B",
    revision: 1,
    textSha256: SHA,
    entries: 0,
    ...overrides,
  };
}

function harnessFor(input: HarnessInput = {}) {
  return harness({
    files: { [tokenPath]: { text: PROJECT_TOKEN, mode: 0o600 } },
    ...input,
  });
}

describe("report", () => {
  it("records an answer and prints the entry index", async () => {
    const built = harnessFor({ script: [reply(201, ACCEPTED)] });

    expect(await report(command(), built.deps)).toBe(0);
    expect(built.out).toEqual([
      `recorded ${PROJECT}/d1: approved, reported, entry 0`,
    ]);
    expect(built.err).toEqual([]);
    expect(built.sent()).toBe(1);
  });

  it("POSTs the validated entry on the project's own route, with its token", async () => {
    const built = harnessFor({ script: [reply(201, ACCEPTED)] });

    await report(command(), built.deps);

    const request = built.requests[0];
    expect(request?.method).toBe("POST");
    expect(request?.url).toBe(STATES_URL);
    expect(request?.bearer).toBe(PROJECT_TOKEN);
  });

  it("builds by as the project session when --by is absent", async () => {
    const built = harnessFor({ script: [reply(201, ACCEPTED)] });

    await report(command(), built.deps);

    const body = JSON.parse(built.requests[0]?.body ?? "{}");
    expect(body.by).toBe(`${PROJECT} session`);
    expect(body.source).toBe("reported");
  });

  it("refuses a stale entry with exit 5 and the current triple", async () => {
    const built = harnessFor({
      script: [
        reply(
          409,
          JSON.stringify({
            revision: 2,
            textSha256: "b".repeat(64),
            entries: 3,
          }),
        ),
      ],
    });

    expect(await report(command(), built.deps)).toBe(5);
    expect(built.err).toEqual([
      `waves decision report: stale; current revision 2, textSha256 ${"b".repeat(64)}, entries 3; read again`,
    ]);
    expect(built.out).toEqual([]);
  });

  it("refuses a 409 with an unusable body", async () => {
    const built = harnessFor({ script: [reply(409, "{}")] });
    await expect(report(command(), built.deps)).rejects.toThrow(
      "409; the server sent an unusable body",
    );
    expect(built.sent()).toBe(1);
  });

  it("refuses a 201 with an unusable body", async () => {
    const built = harnessFor({ script: [reply(201, "{}")] });
    await expect(report(command(), built.deps)).rejects.toThrow(
      "the server sent an unusable body",
    );
    expect(built.out).toEqual([]);
  });

  it("refuses a local validation failure, prints issues and sends nothing", async () => {
    const built = harnessFor();
    const exitCode = await report(
      command({ textSha256: "not-a-hash" }),
      built.deps,
    );
    expect(exitCode).toBe(2);
    expect(built.err).toEqual([
      "waves decision report: /textSha256: expected to match ^[0-9a-f]{64}$",
      "waves decision report: not recorded; fix the entry, or ask in the terminal",
    ]);
    expect(built.out).toEqual([]);
    expect(built.sent()).toBe(0);
  });

  it("does not retry a state write after the body may have been sent", async () => {
    const built = harnessFor({
      script: [network("socket hang up", false), reply(201, ACCEPTED)],
    });
    await expect(report(command(), built.deps)).rejects.toThrow(
      "socket hang up; not recorded, ask in the terminal",
    );
    expect(built.sent()).toBe(1);
  });

  it("retries a network failure before the body was sent, then succeeds", async () => {
    const built = harnessFor({
      script: [network("socket hang up", true), reply(201, ACCEPTED)],
    });
    expect(await report(command(), built.deps)).toBe(0);
    expect(built.sent()).toBe(2);
    expect(built.waits).toEqual([1000]);
  });

  it("gives up after two retries on a pre-body network failure", async () => {
    const built = harnessFor({
      script: [network("x", true), network("x", true), network("x", true)],
    });
    await expect(report(command(), built.deps)).rejects.toThrow(
      "x; not recorded, ask in the terminal",
    );
    expect(built.sent()).toBe(3);
    expect(built.waits).toEqual([1000, 2000]);
  });

  it("refuses a 429 that asks for more than a minute to wait", async () => {
    const built = harnessFor({
      script: [reply(429, "", { "retry-after": "120" })],
    });
    await expect(report(command(), built.deps)).rejects.toThrow(
      "429 Too Many Requests; the server asked to wait 120s; not recorded, ask in the terminal",
    );
    expect(built.sent()).toBe(1);
  });

  it("waits as long as a 429 asked, then retries and succeeds", async () => {
    const built = harnessFor({
      script: [reply(429, "", { "retry-after": "1" }), reply(201, ACCEPTED)],
    });
    expect(await report(command(), built.deps)).toBe(0);
    expect(built.sent()).toBe(2);
    expect(built.waits).toEqual([1000]);
  });

  it("refuses a 429 after three retries", async () => {
    const built = harnessFor({
      script: [reply(429), reply(429), reply(429), reply(429)],
    });
    await expect(report(command(), built.deps)).rejects.toThrow(
      "429 Too Many Requests; not recorded, ask in the terminal",
    );
    expect(built.sent()).toBe(4);
    expect(built.out).toEqual([]);
  });

  it("refuses a 401 without retrying", async () => {
    const built = harnessFor({ script: [reply(401, "")] });
    await expect(report(command(), built.deps)).rejects.toThrow(
      "401 Unauthorized; not recorded, ask in the terminal",
    );
    expect(built.sent()).toBe(1);
    expect(built.waits).toEqual([]);
  });

  it("refuses a 500 without retrying", async () => {
    const built = harnessFor({ script: [reply(500, "")] });
    await expect(report(command(), built.deps)).rejects.toThrow(
      "500 Internal Server Error; not recorded, ask in the terminal",
    );
    expect(built.sent()).toBe(1);
  });

  it("wants a project and a token before it sends anything", async () => {
    const noProject = harnessFor({ vars: { WAVES_PROJECT: undefined } });
    await expect(report(command(), noProject.deps)).rejects.toThrow(
      "WAVES_PROJECT is required",
    );

    const noToken = harness();
    await expect(report(command(), noToken.deps)).rejects.toThrow(
      `no token for ${PROJECT} at ${tokenPath}`,
    );
  });
});
