import { describe, expect, it } from "vitest";

import { decisionBindingText } from "@hexagen-monaco/waves-contract";

import { eventReply, raiseReply, stateReply } from "../src/index.js";
import { sha256Hex } from "../src/infrastructure/sha256.js";
import { decisionRevision } from "./notice-contract.js";

const HASH = sha256Hex(decisionBindingText(decisionRevision("d1")));

function json(reply: ReturnType<typeof raiseReply>): unknown {
  return JSON.parse(reply.body.toString("utf8"));
}

describe("raiseReply", () => {
  it("maps a stored revision to 200 with the revision, hash, created and entries", () => {
    const reply = raiseReply({
      kind: "stored",
      revision: 2,
      textSha256: HASH,
      created: true,
      entries: 1,
    });
    expect(reply.status).toBe(200);
    expect(json(reply)).toEqual({
      revision: 2,
      textSha256: HASH,
      created: true,
      entries: 1,
    });
  });

  it("maps a ceiling to 409 naming the bound", () => {
    const reply = raiseReply({ kind: "ceiling" });
    expect(reply.status).toBe(409);
    expect(json(reply)).toEqual({
      error: "at most 500 decisions per project",
    });
  });

  it("maps too many revisions to 409 naming the bound", () => {
    const reply = raiseReply({ kind: "tooManyRevisions" });
    expect(reply.status).toBe(409);
    expect(json(reply)).toEqual({
      error: "at most 20 revisions per decision",
    });
  });

  it("maps a lost race to 409", () => {
    const reply = raiseReply({ kind: "conflict" });
    expect(reply.status).toBe(409);
    expect(json(reply)).toEqual({ error: "the decision changed; re-read it" });
  });

  it("maps an invalid body to 400 with the issues", () => {
    const reply = raiseReply({
      kind: "invalid",
      errors: [{ path: "/schema", message: `expected "waves-notice/v1"` }],
    });
    expect(reply.status).toBe(400);
    expect(json(reply)).toEqual({
      errors: [{ path: "/schema", message: `expected "waves-notice/v1"` }],
    });
  });
});

describe("stateReply", () => {
  it("maps a posted entry to 201 with its index", () => {
    const reply = stateReply({ kind: "posted", index: 3 });
    expect(reply.status).toBe(201);
    expect(json(reply)).toEqual({ index: 3 });
  });

  it("maps a missing decision to 404", () => {
    const reply = stateReply({ kind: "notFound" });
    expect(reply.status).toBe(404);
    expect(json(reply)).toEqual({ error: "not found" });
  });

  it("maps a stale pin or lost race to 409 with the current trio", () => {
    const reply = stateReply({
      kind: "conflict",
      error: "the state entry is out of date",
      revision: 1,
      textSha256: HASH,
      entries: 0,
    });
    expect(reply.status).toBe(409);
    expect(json(reply)).toEqual({
      error: "the state entry is out of date",
      revision: 1,
      textSha256: HASH,
      entries: 0,
    });
  });

  it("maps an invalid entry to 400 with the issues", () => {
    const reply = stateReply({
      kind: "invalid",
      errors: [
        {
          path: "/option",
          message: "expected an option key of the current revision",
        },
      ],
    });
    expect(reply.status).toBe(400);
    expect(json(reply)).toEqual({
      errors: [
        {
          path: "/option",
          message: "expected an option key of the current revision",
        },
      ],
    });
  });
});

describe("eventReply", () => {
  it("maps a stored event to 201 with its id and dropped count", () => {
    const reply = eventReply({
      kind: "posted",
      id: "2026-10-08T13:00:00.000Z-1",
      dropped: 2,
    });
    expect(reply.status).toBe(201);
    expect(json(reply)).toEqual({
      id: "2026-10-08T13:00:00.000Z-1",
      dropped: 2,
    });
  });

  it("maps an invalid event to 400 with the issues", () => {
    const reply = eventReply({
      kind: "invalid",
      errors: [
        { path: "/project", message: "expected the project the path names" },
      ],
    });
    expect(reply.status).toBe(400);
    expect(json(reply)).toEqual({
      errors: [
        { path: "/project", message: "expected the project the path names" },
      ],
    });
  });
});
