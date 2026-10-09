import { describe, expect, it } from "vitest";
import { validateDecision } from "@hexagen-monaco/waves-contract";

import type { Command, InputSource } from "../src/domain/args.js";
import { raise } from "../src/application/raise.js";
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

type RaiseCommand = Extract<
  Command,
  { readonly kind: "decision"; readonly action: "raise" }
>;

const tokenPath = `${CONFIG_DIR}/${PROJECT}.token`;
const DECISION_URL = `http://127.0.0.1:8080/api/v1/projects/${PROJECT}/decisions/d1`;

const MINIMAL_DECISION = JSON.stringify({
  id: "d1",
  question: "What should we do?",
  options: [
    { key: "a", text: "A", cost: "C1" },
    { key: "b", text: "B", cost: "C2" },
  ],
  hardToUndo: { value: false },
  decider: "owner",
  raisedBy: "session",
});

const SHA = "a".repeat(64);

const ACCEPTED = JSON.stringify({
  revision: 1,
  textSha256: SHA,
  created: true,
  entries: 0,
});

function command(source: InputSource = { kind: "stdin" }): RaiseCommand {
  return { kind: "decision", action: "raise", source };
}

function harnessFor(input: HarnessInput = {}) {
  return harness({
    files: { [tokenPath]: { text: PROJECT_TOKEN, mode: 0o600 } },
    ...input,
  });
}

describe("raise", () => {
  it("raises a decision and prints the revision, hash and entry count", async () => {
    const built = harnessFor({
      script: [reply(200, ACCEPTED)],
      stdin: MINIMAL_DECISION,
    });

    expect(await raise(command(), built.deps)).toBe(0);
    expect(built.out).toEqual([
      `raised ${PROJECT}/d1: revision 1 (new), textSha256 ${SHA}, entries 0`,
    ]);
    expect(built.err).toEqual([]);
    expect(built.sent()).toBe(1);
  });

  it("says unchanged when the server did not make a new revision", async () => {
    const built = harnessFor({
      script: [
        reply(
          200,
          JSON.stringify({
            revision: 3,
            textSha256: "b".repeat(64),
            created: false,
            entries: 5,
          }),
        ),
      ],
      stdin: MINIMAL_DECISION,
    });

    expect(await raise(command(), built.deps)).toBe(0);
    expect(built.out).toEqual([
      `raised ${PROJECT}/d1: revision 3 (unchanged), textSha256 ${"b".repeat(64)}, entries 5`,
    ]);
  });

  it("puts it on the decision route, with the project's token and validated body", async () => {
    const built = harnessFor({
      script: [reply(200, ACCEPTED)],
      stdin: MINIMAL_DECISION,
    });

    await raise(command(), built.deps);

    const request = built.requests[0];
    expect(request?.method).toBe("PUT");
    expect(request?.url).toBe(DECISION_URL);
    expect(bearerOf(request)).toBe(PROJECT_TOKEN);
    // What went out is the contract's own value, so what the server stores
    // is a document that passed validation and not the draft.
    const body = JSON.parse(request?.body ?? "{}");
    expect(validateDecision(body).ok).toBe(true);
    expect(body).toMatchObject({
      schema: "waves-notice/v1",
      kind: "decision",
      project: PROJECT,
      id: "d1",
      shape: "choice",
    });
  });

  it("reads the decision from a file the project gave", async () => {
    const built = harnessFor({
      script: [reply(200, ACCEPTED)],
      files: {
        "/tmp/decision.json": { text: MINIMAL_DECISION, mode: 0o644 },
        [tokenPath]: { text: PROJECT_TOKEN, mode: 0o600 },
      },
    });

    expect(
      await raise(
        command({ kind: "file", path: "/tmp/decision.json" }),
        built.deps,
      ),
    ).toBe(0);
  });

  it("refuses a foreign project before it sends anything", async () => {
    const foreign = JSON.stringify({
      ...JSON.parse(MINIMAL_DECISION),
      project: "someone-else",
    });
    const built = harnessFor({ stdin: foreign });

    expect(await raise(command(), built.deps)).toBe(2);
    expect(built.err).toEqual([
      "waves decision raise: the document names another project than WAVES_PROJECT",
      "waves decision raise: not raised; fix the document, or ask in the terminal",
    ]);
    expect(built.sent()).toBe(0);
  });

  it("refuses input that is not a JSON object", async () => {
    const built = harnessFor({ stdin: "[]" });
    expect(await raise(command(), built.deps)).toBe(2);
    expect(built.err).toEqual([
      "waves decision raise: the input is not a JSON object",
      "waves decision raise: not raised; fix the document, or ask in the terminal",
    ]);
    expect(built.sent()).toBe(0);
  });

  it("refuses a file it cannot read, and sends nothing", async () => {
    const built = harnessFor({
      stdin: "",
      files: { [tokenPath]: { text: PROJECT_TOKEN, mode: 0o600 } },
    });
    expect(
      await raise(
        command({ kind: "file", path: "/no/such/file.json" }),
        built.deps,
      ),
    ).toBe(2);
    expect(built.err).toEqual([
      "waves decision raise: cannot read /no/such/file.json",
      "waves decision raise: not raised; fix the document, or ask in the terminal",
    ]);
    expect(built.sent()).toBe(0);
  });

  it("refuses a file that is not JSON, and sends nothing", async () => {
    const built = harnessFor({
      stdin: "",
      files: {
        [tokenPath]: { text: PROJECT_TOKEN, mode: 0o600 },
        "/tmp/decision.json": { text: "not json", mode: 0o644 },
      },
    });
    expect(
      await raise(
        command({ kind: "file", path: "/tmp/decision.json" }),
        built.deps,
      ),
    ).toBe(2);
    expect(built.err).toEqual([
      "waves decision raise: the input is not valid JSON",
      "waves decision raise: not raised; fix the document, or ask in the terminal",
    ]);
    expect(built.sent()).toBe(0);
  });

  it("propagates a non-usage error reading the input", async () => {
    const built = harnessFor({ stdin: "" });
    const deps = {
      ...built.deps,
      input: { read: async () => Promise.reject(new Error("EPIPE")) },
    };
    await expect(raise(command(), deps)).rejects.toThrow("EPIPE");
    expect(built.sent()).toBe(0);
  });

  it("refuses a document the contract will not take, and sends nothing", async () => {
    // A choice with one option fails the shape rule.
    const bad = JSON.stringify({
      id: "d1",
      question: "What should we do?",
      options: [{ key: "a", text: "A", cost: "C1" }],
      hardToUndo: { value: false },
      decider: "owner",
      raisedBy: "session",
    });
    const built = harnessFor({ stdin: bad });

    expect(await raise(command(), built.deps)).toBe(2);
    expect(built.err).toEqual([
      "waves decision raise: /options: expected at least 2 options for a choice",
      "waves decision raise: not raised; fix the document, or ask in the terminal",
    ]);
    expect(built.out).toEqual([]);
    expect(built.sent()).toBe(0);
  });

  it("fails with exit 1 on a 409 and prints the server's error", async () => {
    const built = harnessFor({
      script: [reply(409, '{"error":"too many decisions for this project"}')],
      stdin: MINIMAL_DECISION,
    });

    expect(await raise(command(), built.deps)).toBe(1);
    expect(built.err).toEqual([
      "waves decision raise: too many decisions for this project; not raised, ask in the terminal",
    ]);
    expect(built.out).toEqual([]);
  });

  it("fails with exit 1 on a 409 that carries no error", async () => {
    const built = harnessFor({
      script: [reply(409, "")],
      stdin: MINIMAL_DECISION,
    });

    expect(await raise(command(), built.deps)).toBe(1);
    expect(built.err).toEqual([
      "waves decision raise: refused (409); not raised, ask in the terminal",
    ]);
    expect(built.out).toEqual([]);
  });

  it("fails with exit 1 on a 200 the server broke", async () => {
    const built = harnessFor({
      script: [reply(200, "{}")],
      stdin: MINIMAL_DECISION,
    });
    await expect(raise(command(), built.deps)).rejects.toThrow(
      "the server sent an unusable body; not raised, ask in the terminal",
    );
    expect(built.out).toEqual([]);
  });

  it("gives up after two retries on a network failure", async () => {
    const lost = network("socket hang up");
    const built = harnessFor({
      script: [lost, lost, lost],
      stdin: MINIMAL_DECISION,
    });
    await expect(raise(command(), built.deps)).rejects.toThrow(
      "socket hang up; not raised, ask in the terminal",
    );
    expect(built.sent()).toBe(3);
    expect(built.waits).toEqual([1000, 2000]);
    expect(built.out).toEqual([]);
  });

  it("retries a network failure once and then succeeds", async () => {
    const built = harnessFor({
      script: [network("socket hang up"), reply(200, ACCEPTED)],
      stdin: MINIMAL_DECISION,
    });
    expect(await raise(command(), built.deps)).toBe(0);
    expect(built.sent()).toBe(2);
    expect(built.waits).toEqual([1000]);
  });

  it("refuses a 401 without retrying", async () => {
    const built = harnessFor({
      script: [reply(401, "")],
      stdin: MINIMAL_DECISION,
    });
    await expect(raise(command(), built.deps)).rejects.toThrow(
      "401 Unauthorized; not raised, ask in the terminal",
    );
    expect(built.sent()).toBe(1);
    expect(built.waits).toEqual([]);
  });

  it("retries a 5xx twice and then gives up", async () => {
    const built = harnessFor({
      script: [reply(503), reply(503), reply(503)],
      stdin: MINIMAL_DECISION,
    });
    await expect(raise(command(), built.deps)).rejects.toThrow(
      "503 Service Unavailable; not raised, ask in the terminal",
    );
    expect(built.sent()).toBe(3);
    expect(built.waits).toEqual([1000, 2000]);
  });

  it("retries a 5xx once and then succeeds", async () => {
    const built = harnessFor({
      script: [reply(503), reply(200, ACCEPTED)],
      stdin: MINIMAL_DECISION,
    });
    expect(await raise(command(), built.deps)).toBe(0);
    expect(built.out).toEqual([
      `raised ${PROJECT}/d1: revision 1 (new), textSha256 ${SHA}, entries 0`,
    ]);
    expect(built.waits).toEqual([1000]);
  });

  it("waits as long as a 429 asked, then retries and succeeds", async () => {
    const built = harnessFor({
      script: [reply(429, "", { "retry-after": "1" }), reply(200, ACCEPTED)],
      stdin: MINIMAL_DECISION,
    });
    expect(await raise(command(), built.deps)).toBe(0);
    expect(built.waits).toEqual([1000]);
  });

  it("refuses a 429 that asks for more than a minute to wait", async () => {
    const built = harnessFor({
      script: [reply(429, "", { "retry-after": "120" })],
      stdin: MINIMAL_DECISION,
    });
    await expect(raise(command(), built.deps)).rejects.toThrow(
      "429 Too Many Requests; the server asked to wait 120s; not raised, ask in the terminal",
    );
    expect(built.sent()).toBe(1);
  });

  it("refuses a 429 after three retries", async () => {
    const built = harnessFor({
      script: [reply(429), reply(429), reply(429), reply(429)],
      stdin: MINIMAL_DECISION,
    });
    await expect(raise(command(), built.deps)).rejects.toThrow(
      "429 Too Many Requests; not raised, ask in the terminal",
    );
    expect(built.sent()).toBe(4);
    expect(built.out).toEqual([]);
  });

  it("ends a configuration failure with a line that says to ask in the terminal", async () => {
    const noProject = harnessFor({
      vars: { WAVES_PROJECT: undefined },
      stdin: MINIMAL_DECISION,
    });
    expect(await raise(command(), noProject.deps)).toBe(2);
    expect(noProject.err).toEqual([
      "waves decision raise: WAVES_PROJECT is required",
      "waves decision raise: not raised; fix the configuration, or ask in the terminal",
    ]);
    expect(noProject.sent()).toBe(0);

    const noToken = harness({ stdin: MINIMAL_DECISION });
    expect(await raise(command(), noToken.deps)).toBe(2);
    expect(noToken.err).toEqual([
      `waves decision raise: no token for ${PROJECT} at ${tokenPath}; run waves register first`,
      "waves decision raise: not raised; fix the configuration, or ask in the terminal",
    ]);
    expect(noToken.sent()).toBe(0);
  });

  it("ends a bad WAVES_URL with a line that says to ask in the terminal", async () => {
    const built = harnessFor({
      vars: { WAVES_URL: "not-a-url" },
      stdin: MINIMAL_DECISION,
    });
    expect(await raise(command(), built.deps)).toBe(2);
    expect(built.err).toEqual([
      "waves decision raise: WAVES_URL must be an absolute URL",
      "waves decision raise: not raised; fix the configuration, or ask in the terminal",
    ]);
    expect(built.sent()).toBe(0);
  });
});
