import { describe, expect, it } from "vitest";

import type { Command } from "../src/domain/args.js";
import { readDecision } from "../src/application/read.js";
import { PROJECT, harness, network, reply } from "./support/harness.js";

type ReadCommand = Extract<
  Command,
  { readonly kind: "decision"; readonly action: "read" }
>;

const DECISION_URL = `http://127.0.0.1:8080/api/v1/projects/${PROJECT}/decisions/d1`;

function command(id = "d1"): ReadCommand {
  return { kind: "decision", action: "read", id };
}

function record(id = "d1"): string {
  return JSON.stringify({
    head: { project: PROJECT, id, question: "What should we do?" },
    revisions: [],
    entries: [],
  });
}

describe("read", () => {
  it("prints the record the server answered and exits 0", async () => {
    const body = record();
    const built = harness({ script: [reply(200, body)] });

    expect(await readDecision(command(), built.deps)).toBe(0);
    expect(built.out).toEqual([body]);
    expect(built.err).toEqual([]);
    expect(built.sent()).toBe(1);
  });

  it("sends a GET with no token, on the decision route", async () => {
    const built = harness({ script: [reply(200, record())] });

    await readDecision(command(), built.deps);

    const request = built.requests[0];
    expect(request?.method).toBe("GET");
    expect(request?.url).toBe(DECISION_URL);
    expect(request?.bearer).toBeUndefined();
    expect(request?.body).toBeUndefined();
  });

  it("says the record was read, not that it was answered", async () => {
    const built = harness({
      script: [
        reply(
          200,
          JSON.stringify({
            head: { id: "d1", state: "approved", source: "reported" },
            revisions: [],
            entries: [{ state: "approved", words: "yes" }],
          }),
        ),
      ],
    });

    expect(await readDecision(command(), built.deps)).toBe(0);
    // Exit 0 means the record was read; it says nothing about the answer.
  });

  it("refuses a 200 body that is HTML", async () => {
    const built = harness({
      script: [reply(200, "<html>is this a decision?</html>")],
    });
    await expect(readDecision(command(), built.deps)).rejects.toThrow(
      "the server sent an unusable body",
    );
    expect(built.out).toEqual([]);
  });

  it("refuses a 200 body that is empty", async () => {
    const built = harness({ script: [reply(200, "")] });
    await expect(readDecision(command(), built.deps)).rejects.toThrow(
      "the server sent an unusable body",
    );
    expect(built.out).toEqual([]);
  });

  it("refuses a 200 body that is an empty object", async () => {
    const built = harness({ script: [reply(200, "{}")] });
    await expect(readDecision(command(), built.deps)).rejects.toThrow(
      "the server sent an unusable body",
    );
    expect(built.out).toEqual([]);
  });

  it("refuses a 200 record for another decision's id", async () => {
    const built = harness({ script: [reply(200, record("d999"))] });
    await expect(readDecision(command(), built.deps)).rejects.toThrow(
      "the server sent an unusable body",
    );
    expect(built.out).toEqual([]);
  });

  it("reports a decision that is not there", async () => {
    const built = harness({
      script: [reply(404, '{"error":"not found"}')],
    });
    await expect(readDecision(command(), built.deps)).rejects.toThrow(
      "no such decision d1",
    );
    expect(built.out).toEqual([]);
  });

  it("reports a refusal it cannot explain", async () => {
    const built = harness({
      script: [reply(401, "")],
    });
    await expect(readDecision(command(), built.deps)).rejects.toThrow(
      "401 Unauthorized",
    );
    expect(built.out).toEqual([]);
  });

  it("reports a server error", async () => {
    const built = harness({
      script: [reply(500, '{"error":"internal"}')],
    });
    await expect(readDecision(command(), built.deps)).rejects.toThrow(
      "500 Internal Server Error",
    );
    expect(built.out).toEqual([]);
  });

  it("reports a network failure", async () => {
    const built = harness({
      script: [network("connect ECONNREFUSED")],
    });
    await expect(readDecision(command(), built.deps)).rejects.toThrow(
      "connect ECONNREFUSED",
    );
    expect(built.out).toEqual([]);
  });

  it("wants a project before it sends anything", async () => {
    const built = harness({
      vars: { WAVES_PROJECT: undefined },
    });
    await expect(readDecision(command(), built.deps)).rejects.toThrow(
      "WAVES_PROJECT is required",
    );
    expect(built.sent()).toBe(0);
  });
});
