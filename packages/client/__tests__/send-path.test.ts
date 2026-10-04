import { describe, expect, it } from "vitest";

import type { Session } from "../src/application/session.js";
import { sendProjectStatus, sendWave } from "../src/application/send.js";
import {
  GENERATED_AT,
  PROJECT,
  PROJECT_TOKEN,
  harness,
  laneWithTail,
  reply,
} from "./support/harness.js";

const OTHER = "client-portal";
const OTHER_TOKEN = "waves-other-t0ken-4c1d72";
const WAVE = "wv5";
const ACCEPTED = `{"receivedAt":"2026-02-03T04:05:07.001Z"}`;

const session: Session = {
  endpoint: {
    origin: "https://waves.example.com",
    secure: true,
    warnInsecure: false,
  },
  configDir: "/run/waves",
};

/**
 * The project and the token are arguments, so a caller can send for a project
 * that is not the one this client's environment names. These are the two
 * parameters W49 moved out of the environment and into the call: everything else
 * about a wave is unchanged.
 */
describe("sendWave", () => {
  it("sends to the project it was given, with the token it was given", async () => {
    const built = harness({ script: [reply(200, ACCEPTED)] });

    const receivedAt = await sendWave(
      {
        session,
        project: OTHER,
        token: OTHER_TOKEN,
        wave: WAVE,
        lanes: [laneWithTail("noisy\n")],
        intervalSeconds: 60,
        includeTails: false,
      },
      { ...built.deps, transport: built.deps.transport({ origin: "x" }) },
    );

    expect(receivedAt).toBe("2026-02-03T04:05:07.001Z");
    const request = built.requests[0];
    expect(request?.url).toBe(
      `https://waves.example.com/api/v1/projects/${OTHER}/waves/${WAVE}`,
    );
    expect(request?.bearer).toBe(OTHER_TOKEN);
    expect(JSON.parse(request?.body ?? "{}")).toMatchObject({
      project: OTHER,
      wave: WAVE,
      generatedAt: GENERATED_AT,
      intervalSeconds: 60,
    });
    expect(built.out).toEqual([]);
  });

  it("still refuses an envelope the contract would not take", async () => {
    const built = harness();

    await expect(
      sendWave(
        {
          session,
          project: OTHER,
          token: OTHER_TOKEN,
          wave: WAVE,
          lanes: [{ id: "wv5" }],
          intervalSeconds: null,
          includeTails: false,
        },
        { ...built.deps, transport: built.deps.transport({ origin: "x" }) },
      ),
    ).rejects.toThrow(
      "the envelope is not valid:\n  /lanes/0/derived: expected an object",
    );
    expect(built.sent()).toBe(0);
  });

  it("still refuses a 200 without a receivedAt", async () => {
    const built = harness({ script: [reply(200, "{}")] });

    await expect(
      sendWave(
        {
          session,
          project: PROJECT,
          token: PROJECT_TOKEN,
          wave: WAVE,
          lanes: [],
          intervalSeconds: null,
          includeTails: false,
        },
        { ...built.deps, transport: built.deps.transport({ origin: "x" }) },
      ),
    ).rejects.toThrow("push failed: the server sent no receivedAt");
  });
});

describe("sendProjectStatus", () => {
  it("sends to the project it was given, with the token it was given", async () => {
    const built = harness({ script: [reply(200, ACCEPTED)] });

    const receivedAt = await sendProjectStatus(
      {
        session,
        project: OTHER,
        token: OTHER_TOKEN,
        input: { prs: { skipped: 2 } },
        intervalSeconds: 60,
      },
      { ...built.deps, transport: built.deps.transport({ origin: "x" }) },
    );

    expect(receivedAt).toBe("2026-02-03T04:05:07.001Z");
    const request = built.requests[0];
    expect(request?.url).toBe(
      `https://waves.example.com/api/v1/projects/${OTHER}/status`,
    );
    expect(request?.bearer).toBe(OTHER_TOKEN);
    expect(JSON.parse(request?.body ?? "{}")).toMatchObject({
      project: OTHER,
      generatedAt: GENERATED_AT,
      intervalSeconds: 60,
      prs: { skipped: 2 },
    });
  });

  it("still refuses an input that is not a status, and one the contract would not take", async () => {
    const built = harness();

    await expect(
      sendProjectStatus(
        {
          session,
          project: OTHER,
          token: OTHER_TOKEN,
          input: "not an object",
          intervalSeconds: null,
        },
        { ...built.deps, transport: built.deps.transport({ origin: "x" }) },
      ),
    ).rejects.toThrow(
      "the input must be a JSON object with optional prs and backlog",
    );

    await expect(
      sendProjectStatus(
        {
          session,
          project: OTHER,
          token: OTHER_TOKEN,
          input: { backlogg: { state: "recorded" } },
          intervalSeconds: null,
        },
        { ...built.deps, transport: built.deps.transport({ origin: "x" }) },
      ),
    ).rejects.toThrow("the status is not valid:\n");
    expect(built.sent()).toBe(0);
  });

  it("still refuses a 200 without a receivedAt", async () => {
    const built = harness({ script: [reply(200, "{}")] });

    await expect(
      sendProjectStatus(
        {
          session,
          project: PROJECT,
          token: PROJECT_TOKEN,
          input: {},
          intervalSeconds: null,
        },
        { ...built.deps, transport: built.deps.transport({ origin: "x" }) },
      ),
    ).rejects.toThrow("status failed: the server sent no receivedAt");
  });
});
