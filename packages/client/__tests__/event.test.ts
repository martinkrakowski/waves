import { describe, expect, it } from "vitest";

import type { Command } from "../src/domain/args.js";
import { sendEvent } from "../src/application/event.js";
import {
  CONFIG_DIR,
  PROJECT,
  PROJECT_TOKEN,
  harness,
  network,
  reply,
  type HarnessInput,
} from "./support/harness.js";

type EventCommand = Extract<Command, { readonly kind: "event" }>;

const tokenPath = `${CONFIG_DIR}/${PROJECT}.token`;
const EVENTS_URL = `http://127.0.0.1:8080/api/v1/projects/${PROJECT}/events`;
const ACCEPTED = JSON.stringify({ id: "evt-1", dropped: false });

function command(overrides: Partial<EventCommand> = {}): EventCommand {
  return {
    kind: "event",
    topic: "relay",
    text: "Round 4 sent to five sessions",
    ...overrides,
  };
}

function harnessFor(input: HarnessInput = {}) {
  return harness({
    files: { [tokenPath]: { text: PROJECT_TOKEN, mode: 0o600 } },
    ...input,
  });
}

describe("event", () => {
  it("records an event and prints its id", async () => {
    const built = harnessFor({ script: [reply(201, ACCEPTED)] });

    expect(await sendEvent(command(), built.deps)).toBe(0);
    expect(built.out).toEqual([`event evt-1 recorded for ${PROJECT}`]);
    expect(built.err).toEqual([]);
    expect(built.sent()).toBe(1);
  });

  it("POSTs the validated event on the events route, with the project's token", async () => {
    const built = harnessFor({ script: [reply(201, ACCEPTED)] });

    await sendEvent(command(), built.deps);

    const request = built.requests[0];
    expect(request?.method).toBe("POST");
    expect(request?.url).toBe(EVENTS_URL);
    expect(request?.bearer).toBe(PROJECT_TOKEN);

    const body = JSON.parse(request?.body ?? "{}");
    expect(body).toMatchObject({
      schema: "waves-notice/v1",
      kind: "event",
      project: PROJECT,
      topic: "relay",
      text: "Round 4 sent to five sessions",
    });
  });

  it("includes detail only when --detail is given", async () => {
    const built = harnessFor({ script: [reply(201, ACCEPTED)] });

    await sendEvent(command({ detail: "five sessions" }), built.deps);

    const body = JSON.parse(built.requests[0]?.body ?? "{}");
    expect(body.detail).toBe("five sessions");

    const noDetail = harnessFor({ script: [reply(201, ACCEPTED)] });
    await sendEvent(command(), noDetail.deps);
    expect(
      JSON.parse(noDetail.requests[0]?.body ?? "{}").detail,
    ).toBeUndefined();
  });

  it("refuses a local validation failure, prints issues and sends nothing", async () => {
    const built = harnessFor();
    const exitCode = await sendEvent(
      command({ topic: "Relay" }), // uppercase: fails the topic pattern
      built.deps,
    );
    expect(exitCode).toBe(2);
    expect(built.err).toEqual([
      "waves event: /topic: expected to match ^[a-z][a-z-]{0,31}$",
      "waves event: not recorded; fix the event, or ask in the terminal",
    ]);
    expect(built.out).toEqual([]);
    expect(built.sent()).toBe(0);
  });

  it("refuses a 201 with an unusable body", async () => {
    const built = harnessFor({ script: [reply(201, "{}")] });
    await expect(sendEvent(command(), built.deps)).rejects.toThrow(
      "the server sent an unusable body",
    );
    expect(built.out).toEqual([]);
  });

  it("does not retry a write after the body may have been sent", async () => {
    const built = harnessFor({
      script: [network("socket hang up", false), reply(201, ACCEPTED)],
    });
    await expect(sendEvent(command(), built.deps)).rejects.toThrow(
      "socket hang up; not recorded, ask in the terminal",
    );
    expect(built.sent()).toBe(1);
  });

  it("retries a network failure before the body was sent, then succeeds", async () => {
    const built = harnessFor({
      script: [network("socket hang up", true), reply(201, ACCEPTED)],
    });
    expect(await sendEvent(command(), built.deps)).toBe(0);
    expect(built.sent()).toBe(2);
    expect(built.waits).toEqual([1000]);
  });

  it("gives up after two retries on a pre-body network failure", async () => {
    const built = harnessFor({
      script: [network("x", true), network("x", true), network("x", true)],
    });
    await expect(sendEvent(command(), built.deps)).rejects.toThrow(
      "x; not recorded, ask in the terminal",
    );
    expect(built.sent()).toBe(3);
    expect(built.waits).toEqual([1000, 2000]);
  });

  it("refuses a 429 that asks for more than a minute to wait", async () => {
    const built = harnessFor({
      script: [reply(429, "", { "retry-after": "120" })],
    });
    await expect(sendEvent(command(), built.deps)).rejects.toThrow(
      "429 Too Many Requests; the server asked to wait 120s; not recorded, ask in the terminal",
    );
    expect(built.sent()).toBe(1);
  });

  it("waits as long as a 429 asked, then retries and succeeds", async () => {
    const built = harnessFor({
      script: [reply(429, "", { "retry-after": "1" }), reply(201, ACCEPTED)],
    });
    expect(await sendEvent(command(), built.deps)).toBe(0);
    expect(built.waits).toEqual([1000]);
  });

  it("refuses a 429 after three retries", async () => {
    const built = harnessFor({
      script: [reply(429), reply(429), reply(429), reply(429)],
    });
    await expect(sendEvent(command(), built.deps)).rejects.toThrow(
      "429 Too Many Requests; not recorded, ask in the terminal",
    );
    expect(built.sent()).toBe(4);
    expect(built.out).toEqual([]);
  });

  it("refuses a 401 without retrying", async () => {
    const built = harnessFor({ script: [reply(401, "")] });
    await expect(sendEvent(command(), built.deps)).rejects.toThrow(
      "401 Unauthorized; not recorded, ask in the terminal",
    );
    expect(built.sent()).toBe(1);
    expect(built.waits).toEqual([]);
  });

  it("refuses a 500 without retrying", async () => {
    const built = harnessFor({ script: [reply(500, "")] });
    await expect(sendEvent(command(), built.deps)).rejects.toThrow(
      "500 Internal Server Error; not recorded, ask in the terminal",
    );
    expect(built.sent()).toBe(1);
  });

  it("wants a project and a token before it sends anything", async () => {
    const noProject = harnessFor({ vars: { WAVES_PROJECT: undefined } });
    await expect(sendEvent(command(), noProject.deps)).rejects.toThrow(
      "WAVES_PROJECT is required",
    );

    const noToken = harness();
    await expect(sendEvent(command(), noToken.deps)).rejects.toThrow(
      `no token for ${PROJECT} at ${tokenPath}`,
    );
  });
});
