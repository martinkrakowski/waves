import { describe, expect, it } from "vitest";

import type { Command } from "../src/domain/args.js";
import { exportDecisions } from "../src/application/export.js";
import {
  PROJECT,
  bearerOf,
  harness,
  network,
  reply,
  type HarnessInput,
} from "./support/harness.js";

type ExportCommand = Extract<
  Command,
  { readonly kind: "decisions"; readonly action: "export" }
>;

const DECISIONS_URL = `http://127.0.0.1:8080/api/v1/projects/${PROJECT}/decisions`;
const SHA = "a".repeat(64);
const SHA2 = "b".repeat(64);

const HEADS = JSON.stringify({
  project: PROJECT,
  counts: { open: 1, approved: 2 },
  decisions: [
    {
      id: "d1",
      question: "What should we do?",
      state: "approved",
      source: "reported",
      at: "2026-10-08T10:00:00Z",
      revision: 1,
      textSha256: SHA,
      entries: 1,
    },
    {
      id: "d2",
      question: "Is 1 | 2?",
      state: "approved",
      source: "reported",
      at: "2026-10-06T10:00:00Z",
      revision: 1,
      textSha256: SHA2,
      entries: 1,
    },
    {
      id: "d3",
      question: "Another question?",
      state: "open",
      source: undefined,
      at: "2026-10-08T10:00:00Z",
      revision: 1,
      textSha256: "c".repeat(64),
      entries: 0,
    },
  ],
});

const D1 = JSON.stringify({
  head: {
    id: "d1",
    question: "What should we do?",
    state: "approved",
    source: "reported",
    at: "2026-10-08T10:00:00Z",
    revision: 1,
    textSha256: SHA,
  },
  entries: [
    {
      state: "approved",
      source: "reported",
      at: "2026-10-08T10:00:00Z",
      receivedAt: "2026-10-08T10:00:01Z",
      words: "go with B",
      option: "b",
      revision: 1,
      textSha256: SHA,
    },
  ],
});

const D2 = JSON.stringify({
  head: {
    id: "d2",
    question: "Is 1 | 2?",
    state: "approved",
    source: "reported",
    at: "2026-10-06T10:00:00Z",
    revision: 1,
    textSha256: SHA2,
  },
  entries: [
    {
      state: "approved",
      source: "reported",
      at: "2026-10-06T10:00:00Z",
      words: "yes",
      option: undefined,
      revision: 1,
      textSha256: SHA2,
    },
  ],
});

const HEADS_NONE = JSON.stringify({
  project: PROJECT,
  counts: { open: 1 },
  decisions: [
    {
      id: "d1",
      question: "q",
      state: "open",
      source: undefined,
      at: "2026-10-08T00:00:00Z",
      revision: 1,
      textSha256: SHA,
      entries: 0,
    },
  ],
});

function command(overrides: Partial<ExportCommand> = {}): ExportCommand {
  return { kind: "decisions", action: "export", since: null, ...overrides };
}

function harnessFor(input: HarnessInput = {}) {
  return harness(input);
}

describe("decisions export", () => {
  it("prints a markdown table of reported answers", async () => {
    const built = harnessFor({
      script: [reply(200, HEADS), reply(200, D1), reply(200, D2)],
    });

    expect(await exportDecisions(command(), built.deps)).toBe(0);
    expect(built.out).toHaveLength(1);
    expect(built.out[0]).toContain(
      "## Reported answers (reported, not signed)",
    );
    expect(built.out[0]).toContain("reported, not signed | d1 |");
    expect(built.out[0]).toContain("approved (b) | go with B");
    expect(built.out[0]).toContain("reported, not signed | d2 |");
    // A pipe inside a cell is escaped so the row stays one line.
    expect(built.out[0]).toContain("Is 1 \\| 2?");
    expect(built.sent()).toBe(3);
  });

  it("sends GETs with no token, on the decisions route", async () => {
    const built = harnessFor({
      script: [reply(200, HEADS), reply(200, D1), reply(200, D2)],
    });

    await exportDecisions(command(), built.deps);

    expect(built.requests[0]?.method).toBe("GET");
    expect(built.requests[0]?.url).toBe(DECISIONS_URL);
    expect(bearerOf(built.requests[0])).toBeUndefined();
  });

  it("filters answers by the entry's receivedAt with --since", async () => {
    const built = harnessFor({
      script: [reply(200, HEADS), reply(200, D1), reply(200, D2)],
    });

    expect(
      await exportDecisions(command({ since: "2026-10-07" }), built.deps),
    ).toBe(0);
    expect(built.out[0]).toContain("reported, not signed | d1 |");
    expect(built.out[0]).not.toContain("d2");
    // The since filter uses the entry's receivedAt, which is read only after the
    // decision is fetched, so d2 is fetched and then dropped.
    expect(built.sent()).toBe(3);
  });

  it("fails on a list response that is not a decisions list", async () => {
    const built = harnessFor({
      script: [reply(200, '{"project":"waves-demo"}')],
    });
    await expect(exportDecisions(command(), built.deps)).rejects.toThrow(
      "the server sent an unusable body",
    );
    expect(built.out).toEqual([]);
    expect(built.sent()).toBe(1);
  });

  it("skips another project's decision marked with a from key", async () => {
    const heads = JSON.stringify({
      project: PROJECT,
      counts: { approved: 1 },
      decisions: [
        {
          id: "d1",
          from: "waves-other",
          question: "q",
          state: "approved",
          source: "reported",
          revision: 1,
          textSha256: SHA,
          entries: 1,
        },
      ],
    });
    const built = harnessFor({ script: [reply(200, heads)] });
    expect(await exportDecisions(command(), built.deps)).toBe(0);
    expect(built.out[0]).toBe(
      "## Reported answers (reported, not signed)\n\nNone.",
    );
    expect(built.sent()).toBe(1);
  });

  it("leaves out a decision that stopped being a reported answer between list and fetch", async () => {
    const heads = JSON.stringify({
      project: PROJECT,
      counts: { approved: 1 },
      decisions: [
        {
          id: "d1",
          question: "q",
          state: "approved",
          source: "reported",
          revision: 1,
          textSha256: SHA,
          entries: 1,
        },
      ],
    });
    const changed = JSON.stringify({
      head: {
        id: "d1",
        question: "q",
        state: "open",
        source: undefined,
        at: "2026-10-08T10:00:00Z",
        revision: 1,
        textSha256: SHA,
      },
      entries: [
        {
          state: "open",
          source: undefined,
          at: "2026-10-08T10:00:00Z",
          receivedAt: "2026-10-08T10:00:01Z",
          words: "x",
          option: undefined,
          revision: 1,
          textSha256: SHA,
        },
      ],
    });
    const built = harnessFor({
      script: [reply(200, heads), reply(200, changed)],
    });
    expect(await exportDecisions(command(), built.deps)).toBe(0);
    expect(built.out[0]).toBe(
      "## Reported answers (reported, not signed)\n\nNone.",
    );
    expect(built.sent()).toBe(2);
  });

  it("leaves out an answer whose entry no longer matches its head", async () => {
    const heads = JSON.stringify({
      project: PROJECT,
      counts: { approved: 1 },
      decisions: [
        {
          id: "d1",
          question: "q",
          state: "approved",
          source: "reported",
          revision: 1,
          textSha256: SHA,
          entries: 1,
        },
      ],
    });
    const mismatch = JSON.stringify({
      head: {
        id: "d1",
        question: "q",
        state: "approved",
        source: "reported",
        at: "2026-10-08T10:00:00Z",
        revision: 1,
        textSha256: SHA,
      },
      entries: [
        {
          state: "approved",
          source: "reported",
          at: "2026-10-08T10:00:00Z",
          receivedAt: "2026-10-08T10:00:01Z",
          words: "x",
          option: undefined,
          revision: 1,
          textSha256: "different",
        },
      ],
    });
    const built = harnessFor({
      script: [reply(200, heads), reply(200, mismatch)],
    });
    expect(
      await exportDecisions(command({ since: "2026-10-07" }), built.deps),
    ).toBe(0);
    expect(built.out[0]).toBe(
      "## Reported answers (reported, not signed)\n\nNone.",
    );
    expect(built.sent()).toBe(2);
  });

  it("prints None. when no decision is a reported answer", async () => {
    const built = harnessFor({ script: [reply(200, HEADS_NONE)] });

    expect(await exportDecisions(command(), built.deps)).toBe(0);
    expect(built.out[0]).toBe(
      "## Reported answers (reported, not signed)\n\nNone.",
    );
    expect(built.sent()).toBe(1);
  });

  it("is empty on stdout when a request fails", async () => {
    const built = harnessFor({
      script: [reply(200, HEADS), reply(404, '{"error":"not found"}')],
    });
    await expect(exportDecisions(command(), built.deps)).rejects.toThrow(
      "404 Not Found",
    );
    expect(built.out).toEqual([]);
  });

  it("reports a network failure on a decision fetch", async () => {
    const built = harnessFor({
      script: [reply(200, HEADS), network("socket hang up")],
    });
    await expect(exportDecisions(command(), built.deps)).rejects.toThrow(
      "socket hang up",
    );
    expect(built.out).toEqual([]);
  });

  it("refuses an unusable body on a decision fetch", async () => {
    const built = harnessFor({
      script: [reply(200, HEADS), reply(200, "not json")],
    });
    await expect(exportDecisions(command(), built.deps)).rejects.toThrow(
      "the server sent an unusable body",
    );
    expect(built.out).toEqual([]);
  });

  it("fails on the heads list, before any decision is fetched", async () => {
    const built = harnessFor({ script: [reply(401, "")] });
    await expect(exportDecisions(command(), built.deps)).rejects.toThrow(
      "401 Unauthorized",
    );
    expect(built.sent()).toBe(1);
  });

  it("reports a network failure on the list fetch", async () => {
    const built = harnessFor({
      script: [network("connect ECONNREFUSED")],
    });
    await expect(exportDecisions(command(), built.deps)).rejects.toThrow(
      "connect ECONNREFUSED",
    );
    expect(built.out).toEqual([]);
  });

  it("wants a project before it sends anything", async () => {
    const built = harnessFor({ vars: { WAVES_PROJECT: undefined } });
    await expect(exportDecisions(command(), built.deps)).rejects.toThrow(
      "WAVES_PROJECT is required",
    );
    expect(built.sent()).toBe(0);
  });
});
