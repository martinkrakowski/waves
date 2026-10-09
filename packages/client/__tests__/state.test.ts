import { describe, expect, it } from "vitest";

import type { Command } from "../src/domain/args.js";
import { state } from "../src/application/state.js";
import {
  CONFIG_DIR,
  PROJECT,
  PROJECT_TOKEN,
  bearerOf,
  harness,
  network,
  reply,
  type HarnessInput,
} from "./support/harness.js";

type StateCommand = Extract<
  Command,
  { readonly kind: "decision"; readonly action: "state" }
>;

const tokenPath = `${CONFIG_DIR}/${PROJECT}.token`;
const STATES_URL = `http://127.0.0.1:8080/api/v1/projects/${PROJECT}/decisions/d1/states`;
const SHA = "a".repeat(64);
const ACCEPTED = JSON.stringify({ index: 0 });

function command(overrides: Partial<StateCommand> = {}): StateCommand {
  return {
    kind: "decision",
    action: "state",
    id: "d1",
    state: "withdrawn",
    revision: 1,
    textSha256: SHA,
    entries: 0,
    reason: "fixed another way",
    ...overrides,
  };
}

function harnessFor(input: HarnessInput = {}) {
  return harness({
    files: { [tokenPath]: { text: PROJECT_TOKEN, mode: 0o600 } },
    ...input,
  });
}

describe("state", () => {
  it("records a session state change and prints the entry index", async () => {
    const built = harnessFor({ script: [reply(201, ACCEPTED)] });

    expect(await state(command(), built.deps)).toBe(0);
    expect(built.out).toEqual([
      `recorded ${PROJECT}/d1: withdrawn, session, entry 0`,
    ]);
    expect(built.err).toEqual([]);
    expect(built.sent()).toBe(1);
  });

  it("POSTs the validated entry on the project's own route, with its token", async () => {
    const built = harnessFor({ script: [reply(201, ACCEPTED)] });

    await state(command(), built.deps);

    const request = built.requests[0];
    expect(request?.method).toBe("POST");
    expect(request?.url).toBe(STATES_URL);
    expect(bearerOf(request)).toBe(PROJECT_TOKEN);
  });

  it("builds by as the project session when --by is absent", async () => {
    const built = harnessFor({ script: [reply(201, ACCEPTED)] });

    await state(command(), built.deps);

    const body = JSON.parse(built.requests[0]?.body ?? "{}");
    expect(body.by).toBe(`${PROJECT} session`);
    expect(body.source).toBe("session");
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

    expect(await state(command(), built.deps)).toBe(5);
    expect(built.err).toEqual([
      `waves decision state: stale; current revision 2, textSha256 ${"b".repeat(64)}, entries 3; read again`,
    ]);
    expect(built.out).toEqual([]);
  });

  it("refuses a 409 with an unusable body with exit 5", async () => {
    const built = harnessFor({ script: [reply(409, "{}")] });
    expect(await state(command(), built.deps)).toBe(5);
    expect(built.err).toEqual(["waves decision state: stale; read again"]);
    expect(built.out).toEqual([]);
    expect(built.sent()).toBe(1);
  });

  it("refuses a 409 with an empty body with exit 5", async () => {
    const built = harnessFor({ script: [reply(409, "")] });
    expect(await state(command(), built.deps)).toBe(5);
    expect(built.err).toEqual(["waves decision state: stale; read again"]);
    expect(built.out).toEqual([]);
    expect(built.sent()).toBe(1);
  });

  it("refuses a 201 with an unusable body, saying it may have been recorded", async () => {
    const built = harnessFor({ script: [reply(201, "{}")] });
    await expect(state(command(), built.deps)).rejects.toThrow(
      "the server sent an unusable body; it may or may not have been recorded: read the decision before writing again",
    );
    expect(built.out).toEqual([]);
  });

  it("refuses a local validation failure, prints issues and sends nothing", async () => {
    const built = harnessFor();
    // delegated requires an option or words.
    const exitCode = await state(
      command({ state: "delegated", words: undefined, option: undefined }),
      built.deps,
    );
    expect(exitCode).toBe(2);
    expect(built.err).toEqual([
      "waves decision state: /option: expected option or words for a delegated state",
      "waves decision state: not recorded; fix the entry, or ask in the terminal",
    ]);
    expect(built.out).toEqual([]);
    expect(built.sent()).toBe(0);
  });

  it("says it may have been recorded after a post-body network failure", async () => {
    const built = harnessFor({
      script: [network("socket hang up", false), reply(201, ACCEPTED)],
    });
    await expect(state(command(), built.deps)).rejects.toThrow(
      "socket hang up; it may or may not have been recorded: read the decision before writing again",
    );
    expect(built.sent()).toBe(1);
  });

  it("retries a network failure before the body was sent, then succeeds", async () => {
    const built = harnessFor({
      script: [network("socket hang up", true), reply(201, ACCEPTED)],
    });
    expect(await state(command(), built.deps)).toBe(0);
    expect(built.sent()).toBe(2);
    expect(built.waits).toEqual([1000]);
  });

  it("gives up after two retries on a pre-body network failure", async () => {
    const built = harnessFor({
      script: [network("x", true), network("x", true), network("x", true)],
    });
    await expect(state(command(), built.deps)).rejects.toThrow(
      "x; not recorded, ask in the terminal",
    );
    expect(built.sent()).toBe(3);
    expect(built.waits).toEqual([1000, 2000]);
  });

  it("refuses a 429 that asks for more than a minute to wait", async () => {
    const built = harnessFor({
      script: [reply(429, "", { "retry-after": "120" })],
    });
    await expect(state(command(), built.deps)).rejects.toThrow(
      "429 Too Many Requests; the server asked to wait 120s; not recorded, ask in the terminal",
    );
    expect(built.sent()).toBe(1);
  });

  it("waits as long as a 429 asked, then retries and succeeds", async () => {
    const built = harnessFor({
      script: [reply(429, "", { "retry-after": "1" }), reply(201, ACCEPTED)],
    });
    expect(await state(command(), built.deps)).toBe(0);
    expect(built.sent()).toBe(2);
    expect(built.waits).toEqual([1000]);
  });

  it("refuses a 429 after three retries", async () => {
    const built = harnessFor({
      script: [reply(429), reply(429), reply(429), reply(429)],
    });
    await expect(state(command(), built.deps)).rejects.toThrow(
      "429 Too Many Requests; not recorded, ask in the terminal",
    );
    expect(built.sent()).toBe(4);
    expect(built.out).toEqual([]);
  });

  it("refuses a 401 without retrying", async () => {
    const built = harnessFor({ script: [reply(401, "")] });
    await expect(state(command(), built.deps)).rejects.toThrow(
      "401 Unauthorized; not recorded, ask in the terminal",
    );
    expect(built.sent()).toBe(1);
    expect(built.waits).toEqual([]);
  });

  it("says a 500 may have been recorded rather than not recorded", async () => {
    const built = harnessFor({
      script: [reply(500, "")],
    });
    await expect(state(command(), built.deps)).rejects.toThrow(
      "500 Internal Server Error; it may or may not have been recorded: read the decision before writing again",
    );
    expect(built.sent()).toBe(1);
    expect(built.waits).toEqual([]);
  });

  it("wants a project and a token before it sends anything", async () => {
    const noProject = harnessFor({ vars: { WAVES_PROJECT: undefined } });
    await expect(state(command(), noProject.deps)).rejects.toThrow(
      "WAVES_PROJECT is required",
    );

    const noToken = harness();
    await expect(state(command(), noToken.deps)).rejects.toThrow(
      `no token for ${PROJECT} at ${tokenPath}`,
    );
  });
});
