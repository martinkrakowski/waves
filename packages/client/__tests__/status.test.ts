import { describe, expect, it } from "vitest";
import { validateStatus } from "@hexagen-monaco/waves-contract";

import type { Command } from "../src/domain/args.js";
import { sendStatus } from "../src/application/status.js";
import {
  CONFIG_DIR,
  GENERATED_AT,
  PROJECT,
  PROJECT_TOKEN,
  harness,
  reply,
  type HarnessInput,
} from "./support/harness.js";

type StatusCommand = Extract<Command, { readonly kind: "status" }>;

const tokenPath = `${CONFIG_DIR}/${PROJECT}.token`;
const ORIGIN = "http://127.0.0.1:8080";
const STATUS_PATH = `${ORIGIN}/api/v1/projects/${PROJECT}/status`;

const ACCEPTED = '{"receivedAt":"2026-02-03T04:05:07.001Z"}';

/** What a project knows about itself: one unread PR row and a recorded plan. */
const STATUS = JSON.stringify({
  prs: { skipped: 2 },
  backlog: { state: "recorded", at: "2026-10-03T07:55:00Z" },
});

function command(overrides: Partial<StatusCommand> = {}): StatusCommand {
  return {
    kind: "status",
    source: { kind: "stdin" },
    intervalSeconds: null,
    ...overrides,
  };
}

/** A run with the project's token on file, which every one of these needs. */
function harnessFor(input: HarnessInput = {}) {
  return harness({
    files: { [tokenPath]: { text: PROJECT_TOKEN, mode: 0o600 } },
    ...input,
  });
}

function sentBody(built: ReturnType<typeof harnessFor>): unknown {
  return JSON.parse(built.requests[0]?.body ?? "{}");
}

describe("status", () => {
  it("sends a document the contract normalised, and reports when it landed", async () => {
    const built = harnessFor({
      script: [reply(200, ACCEPTED)],
      stdin: STATUS,
    });

    expect(await sendStatus(command(), built.deps)).toBe(0);
    expect(built.out).toEqual([
      `status sent for ${PROJECT} at 2026-02-03T04:05:07.001Z`,
    ]);
    expect(built.err).toEqual([]);
    expect(built.sent()).toBe(1);
    expect(built.waits).toEqual([]);
  });

  it("puts it on the project's own path, with the project's token", async () => {
    const built = harnessFor({
      script: [reply(200, ACCEPTED)],
      stdin: STATUS,
    });

    await sendStatus(command({ intervalSeconds: 120 }), built.deps);

    const request = built.requests[0];
    expect(request?.method).toBe("PUT");
    expect(request?.url).toBe(STATUS_PATH);
    expect(request?.bearer).toBe(PROJECT_TOKEN);
    const body = sentBody(built);
    // What went out is the contract's own value, so what the server will store
    // is a document that passed validation and not a draft of one.
    expect(validateStatus(body).ok).toBe(true);
    expect(body).toMatchObject({
      schema: "waves-status/v1",
      project: PROJECT,
      generatedAt: GENERATED_AT,
      intervalSeconds: 120,
      prs: { skipped: 2 },
      backlog: { state: "recorded", at: "2026-10-03T07:55:00Z" },
    });
  });

  it("replaces the four keys it owns, whatever the input claimed", async () => {
    const built = harnessFor({
      script: [reply(200, ACCEPTED)],
      stdin: JSON.stringify({
        schema: "waves/v1",
        project: "someone-else",
        generatedAt: "2020-01-01T00:00:00.000Z",
        intervalSeconds: 5,
        backlog: { state: "absent" },
      }),
    });

    expect(await sendStatus(command(), built.deps)).toBe(0);
    // A status is about this project, now, not about the moment the file was
    // written: the client owns these four and the input does not.
    expect(sentBody(built)).toMatchObject({
      schema: "waves-status/v1",
      project: PROJECT,
      generatedAt: GENERATED_AT,
      intervalSeconds: null,
    });
  });

  it("carries a document with neither key, which says the project is alive", async () => {
    const built = harnessFor({
      script: [reply(200, ACCEPTED)],
      stdin: "{}",
    });

    expect(await sendStatus(command(), built.deps)).toBe(0);
    expect(validateStatus(sentBody(built)).ok).toBe(true);
  });

  it("carries an unknown key to the contract rather than dropping it", async () => {
    const built = harnessFor({ stdin: '{"backlogg":{"state":"recorded"}}' });

    await expect(sendStatus(command(), built.deps)).rejects.toThrow(
      "the status is not valid:\n  /backlogg: unknown key",
    );
    // Nothing went out: a misspelt key is refused here, not stored as a status
    // with nothing to report.
    expect(built.sent()).toBe(0);
  });

  it("refuses a backlog the contract would not take, and prints the pointers", async () => {
    const built = harnessFor({
      stdin: '{"backlog":{"state":"nope"},"prs":{"skipped":-1}}',
    });

    await expect(sendStatus(command(), built.deps)).rejects.toThrow(
      "the status is not valid:\n" +
        "  /prs/skipped: expected an integer >= 0\n" +
        "  /backlog/state: expected one of recorded, absent, unknown",
    );
    expect(built.sent()).toBe(0);
  });

  it("refuses input that is not JSON, or not an object", async () => {
    const broken = harnessFor({ stdin: "not json" });
    await expect(sendStatus(command(), broken.deps)).rejects.toThrow(
      "the input is not valid JSON",
    );

    const listed = harnessFor({ stdin: '[{"backlog":{"state":"absent"}}]' });
    await expect(sendStatus(command(), listed.deps)).rejects.toThrow(
      "the input must be a JSON object with optional prs and backlog",
    );
    expect(listed.sent()).toBe(0);
  });

  it("reads the status from a file the project gave", async () => {
    const built = harnessFor({
      script: [reply(200, ACCEPTED)],
      files: {
        "/tmp/backlog.json": { text: STATUS, mode: 0o644 },
        [tokenPath]: { text: PROJECT_TOKEN, mode: 0o600 },
      },
    });

    expect(
      await sendStatus(
        command({ source: { kind: "file", path: "/tmp/backlog.json" } }),
        built.deps,
      ),
    ).toBe(0);
    expect(sentBody(built)).toMatchObject({ backlog: { state: "recorded" } });
  });

  it("refuses a status file that is not there", async () => {
    const built = harnessFor();
    await expect(
      sendStatus(
        command({ source: { kind: "file", path: "/tmp/missing.json" } }),
        built.deps,
      ),
    ).rejects.toThrow("cannot read /tmp/missing.json");
    expect(built.sent()).toBe(0);
  });

  it("wants a project and a token before it sends anything", async () => {
    const noProject = harnessFor({
      vars: { WAVES_PROJECT: undefined },
      stdin: STATUS,
    });
    await expect(sendStatus(command(), noProject.deps)).rejects.toThrow(
      "WAVES_PROJECT is required",
    );

    const noToken = harness({ stdin: STATUS });
    await expect(sendStatus(command(), noToken.deps)).rejects.toThrow(
      `no token for ${PROJECT} at ${tokenPath}`,
    );
  });

  it("refuses a 200 without a receivedAt", async () => {
    const built = harnessFor({ script: [reply(200, "{}")], stdin: STATUS });
    await expect(sendStatus(command(), built.deps)).rejects.toThrow(
      "status failed: the server sent no receivedAt",
    );
  });
});
