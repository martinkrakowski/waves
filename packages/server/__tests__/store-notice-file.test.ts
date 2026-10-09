import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FileNoticeStore } from "../src/infrastructure/file-notice-store.js";
import {
  decisionRevision,
  event,
  storedEntry,
  storedRevision,
} from "./notice-contract.js";

function harness(): {
  store: FileNoticeStore;
  dataDir: string;
  dispose: () => Promise<void>;
} {
  const dataDir = mkdtempSync(join(tmpdir(), "waves-notice-file-"));
  return {
    store: new FileNoticeStore(dataDir),
    dataDir,
    dispose: () => rm(dataDir, { recursive: true, force: true }),
  };
}

function writeDecisionFile(
  dataDir: string,
  project: string,
  id: string,
  contents: string,
): void {
  const dir = join(dataDir, "decisions", project);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, `${id}.json`), contents, { mode: 0o600 });
}

function writeEventsFile(
  dataDir: string,
  project: string,
  contents: string,
): void {
  const dir = join(dataDir, "events");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, `${project}.json`), contents, { mode: 0o600 });
}

describe("FileNoticeStore", () => {
  afterEach(() => {
    // No per-test harness here; each test owns its own dispose.
  });

  it("creates and reads back a decision", async () => {
    const { store, dispose } = harness();
    try {
      const revision = storedRevision(1);
      const outcome = await store.appendRevision("alpha", "d1", revision, 0, 3);
      expect(outcome).toBe("stored");

      const read = await store.getDecision("alpha", "d1");
      expect(read).toEqual({
        project: "alpha",
        id: "d1",
        revisions: [revision],
        entries: [],
      });
    } finally {
      await dispose();
    }
  });

  it("appends a second revision when the count matches", async () => {
    const { store, dispose } = harness();
    try {
      const first = storedRevision(1);
      await store.appendRevision("alpha", "d1", first, 0, 3);

      const second = storedRevision(2);
      const outcome = await store.appendRevision("alpha", "d1", second, 1, 3);
      expect(outcome).toBe("stored");

      const read = await store.getDecision("alpha", "d1");
      expect(read).toMatchObject({ revisions: { length: 2 } });
    } finally {
      await dispose();
    }
  });

  it("answers conflict when the revision count is stale", async () => {
    const { store, dispose } = harness();
    try {
      await store.appendRevision("alpha", "d1", storedRevision(1), 0, 3);

      const outcome = await store.appendRevision(
        "alpha",
        "d1",
        storedRevision(2),
        5,
        3,
      );
      expect(outcome).toBe("conflict");
      const read = await store.getDecision("alpha", "d1");
      expect(read).toMatchObject({ revisions: { length: 1 } });
    } finally {
      await dispose();
    }
  });

  it("answers ceiling when the project is at its decision cap on create", async () => {
    const { store, dispose } = harness();
    try {
      await store.appendRevision("alpha", "d1", storedRevision(1), 0, 2);
      await store.appendRevision("alpha", "d2", storedRevision(1, "d2"), 0, 2);

      const outcome = await store.appendRevision(
        "alpha",
        "d3",
        storedRevision(1),
        0,
        2,
      );
      expect(outcome).toBe("ceiling");
      expect((await store.listDecisions("alpha")).map((d) => d.id)).toEqual([
        "d1",
        "d2",
      ]);
    } finally {
      await dispose();
    }
  });

  it("answers missing when the decision does not exist on appendEntry", async () => {
    const { store, dispose } = harness();
    try {
      const outcome = await store.appendEntry(
        "alpha",
        "d1",
        storedEntry(0),
        0,
        1,
      );
      expect(outcome).toBe("missing");
    } finally {
      await dispose();
    }
  });

  it("appends an entry when the count matches, with its index", async () => {
    const { store, dispose } = harness();
    try {
      await store.appendRevision("alpha", "d1", storedRevision(1), 0, 3);

      const outcome = await store.appendEntry(
        "alpha",
        "d1",
        storedEntry(0, { by: "owner" }),
        0,
        1,
      );
      expect(outcome).toBe("stored");

      const read = await store.getDecision("alpha", "d1");
      expect(read?.entries).toHaveLength(1);
      expect(read?.entries[0]).toMatchObject({ index: 0, by: "owner" });
    } finally {
      await dispose();
    }
  });

  it("answers conflict when the entry count is stale", async () => {
    const { store, dispose } = harness();
    try {
      await store.appendRevision("alpha", "d1", storedRevision(1), 0, 3);
      await store.appendEntry("alpha", "d1", storedEntry(0), 0, 1);

      const outcome = await store.appendEntry(
        "alpha",
        "d1",
        storedEntry(1),
        5,
        1,
      );
      expect(outcome).toBe("conflict");
      const read = await store.getDecision("alpha", "d1");
      expect(read?.entries).toHaveLength(1);
    } finally {
      await dispose();
    }
  });

  it("answers conflict when the revision count is stale on appendEntry", async () => {
    const { store, dispose } = harness();
    try {
      await store.appendRevision("alpha", "d1", storedRevision(1), 0, 3);

      const outcome = await store.appendEntry(
        "alpha",
        "d1",
        storedEntry(0),
        0,
        5,
      );
      expect(outcome).toBe("conflict");
      const read = await store.getDecision("alpha", "d1");
      expect(read).toMatchObject({
        revisions: { length: 1 },
        entries: { length: 0 },
      });
    } finally {
      await dispose();
    }
  });

  it("drops the oldest events past the keep count", async () => {
    const { store, dispose } = harness();
    try {
      const ids: string[] = [];
      for (let at = 0; at < 3; at += 1) {
        const outcome = await store.appendEvent(
          "alpha",
          {
            id: `e${at}`,
            receivedAt: `2026-10-08T13:00:0${at}Z`,
            event: event({ topic: `t${at}` }),
          },
          2,
        );
        ids.push(outcome.id);
        expect(outcome.dropped).toBe(at > 1 ? 1 : 0);
      }

      // The store assigns ids from a per-project sequence, so three same-millisecond
      // writes get three distinct ids and no dropped id is reused.
      expect(ids).toEqual([
        "2026-10-08T13:00:00Z-1",
        "2026-10-08T13:00:01Z-2",
        "2026-10-08T13:00:02Z-3",
      ]);
      expect(new Set(ids).size).toBe(ids.length);

      const listed = await store.listEvents("alpha", 2000);
      expect(listed).toHaveLength(2);
      expect(listed.map((e) => e.id)).toEqual([
        "2026-10-08T13:00:02Z-3",
        "2026-10-08T13:00:01Z-2",
      ]);
    } finally {
      await dispose();
    }
  });

  it("lists decisions ordered by id", async () => {
    const { store, dispose } = harness();
    try {
      await store.appendRevision("alpha", "z", storedRevision(1, "z"), 0, 3);
      await store.appendRevision("alpha", "a", storedRevision(1, "a"), 0, 3);

      const ids = (await store.listDecisions("alpha")).map((d) => d.id);
      expect(ids).toEqual(["a", "z"]);
    } finally {
      await dispose();
    }
  });

  it("lists events newest first, capped by the limit", async () => {
    const { store, dispose } = harness();
    try {
      for (let at = 0; at < 3; at += 1) {
        await store.appendEvent(
          "alpha",
          {
            id: `e${at}`,
            receivedAt: `2026-10-08T13:00:0${at}Z`,
            event: event(),
          },
          2000,
        );
      }

      expect((await store.listEvents("alpha", 2)).map((e) => e.id)).toEqual([
        "2026-10-08T13:00:02Z-3",
        "2026-10-08T13:00:01Z-2",
      ]);
    } finally {
      await dispose();
    }
  });

  it("deletes the notices of a project and leaves another project's", async () => {
    const { store, dispose } = harness();
    try {
      await store.appendRevision("alpha", "d1", storedRevision(1), 0, 3);
      await store.appendRevision(
        "beta",
        "d1",
        storedRevision(1, "d1", "beta"),
        0,
        3,
      );
      await store.appendEvent(
        "alpha",
        {
          id: "e0",
          receivedAt: "2026-10-08T13:00:00Z",
          event: event(),
        },
        2000,
      );

      await store.deleteNotices("alpha");

      expect(await store.getDecision("alpha", "d1")).toBeUndefined();
      expect(await store.listDecisions("alpha")).toEqual([]);
      expect(await store.listEvents("alpha", 10)).toEqual([]);
      expect(await store.getDecision("beta", "d1")).toBeDefined();
    } finally {
      await dispose();
    }
  });

  it("writes every file with mode 0600 and directories 0700", async () => {
    const { store, dataDir, dispose } = harness();
    try {
      await store.appendRevision("alpha", "d1", storedRevision(1), 0, 3);
      await store.appendEvent(
        "alpha",
        {
          id: "e0",
          receivedAt: "2026-10-08T13:00:00Z",
          event: event(),
        },
        2000,
      );

      expect(
        statSync(join(dataDir, "decisions", "alpha", "d1.json")).mode & 0o777,
      ).toBe(0o600);
      expect(statSync(join(dataDir, "events", "alpha.json")).mode & 0o777).toBe(
        0o600,
      );
      expect(statSync(join(dataDir, "decisions")).mode & 0o777).toBe(0o700);
      expect(statSync(join(dataDir, "decisions", "alpha")).mode & 0o777).toBe(
        0o700,
      );
      expect(statSync(join(dataDir, "events")).mode & 0o777).toBe(0o700);
    } finally {
      await dispose();
    }
  });

  it("leaves no temporary file behind after a write", async () => {
    const { store, dataDir, dispose } = harness();
    try {
      await store.appendRevision("alpha", "d1", storedRevision(1), 0, 3);
      await store.appendEvent(
        "alpha",
        {
          id: "e0",
          receivedAt: "2026-10-08T13:00:00Z",
          event: event(),
        },
        2000,
      );

      const entries = readdirSync(join(dataDir, "decisions", "alpha"), {
        recursive: false,
      }).map(String);
      expect(entries.every((name) => !name.includes(".tmp-"))).toBe(true);
    } finally {
      await dispose();
    }
  });

  it("refuses a data directory that is a symbolic link", async () => {
    const root = mkdtempSync(join(tmpdir(), "waves-notice-file-"));
    try {
      const real = join(root, "real");
      mkdirSync(real);
      const link = join(root, "link");
      symlinkSync(real, link);

      await expect(
        new FileNoticeStore(link).appendRevision(
          "alpha",
          "d1",
          storedRevision(1),
          0,
          3,
        ),
      ).rejects.toThrow("is a symbolic link");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses a decisions directory that is a symbolic link", async () => {
    const { store, dataDir, dispose } = harness();
    try {
      const outside = join(dataDir, "outside");
      mkdirSync(outside);
      writeFileSync(join(outside, "canary"), "untouched");
      symlinkSync(outside, join(dataDir, "decisions"));

      await expect(store.getDecision("alpha", "d1")).rejects.toThrow(
        "is a symbolic link",
      );
      expect(readdirSync(outside)).toEqual(["canary"]);
    } finally {
      await dispose();
    }
  });

  it("reads what an earlier instance wrote", async () => {
    const { store, dataDir, dispose } = harness();
    try {
      await store.appendRevision("alpha", "d1", storedRevision(1), 0, 3);
      await store.appendEntry("alpha", "d1", storedEntry(0), 0, 1);

      const reopened = new FileNoticeStore(dataDir);

      const read = await reopened.getDecision("alpha", "d1");
      expect(read).toMatchObject({
        revisions: { length: 1 },
        entries: { length: 1 },
      });
    } finally {
      await dispose();
    }
  });

  it("rejects an invalid project or decision id", async () => {
    const { store, dispose } = harness();
    try {
      await expect(store.getDecision("../escape", "d1")).rejects.toThrow(
        "invalid project id",
      );
      await expect(store.getDecision("alpha", "../escape")).rejects.toThrow(
        "invalid notice id",
      );
    } finally {
      await dispose();
    }
  });
});

describe("FileNoticeStore edge cases", () => {
  it("answers conflict when appendRevision is stale on a missing decision", async () => {
    const { store, dispose } = harness();
    try {
      const outcome = await store.appendRevision(
        "alpha",
        "d1",
        storedRevision(1),
        3,
        3,
      );
      expect(outcome).toBe("conflict");
    } finally {
      await dispose();
    }
  });

  it("creates a missing data directory on write", async () => {
    const root = mkdtempSync(join(tmpdir(), "waves-notice-file-"));
    try {
      const store = new FileNoticeStore(join(root, "data"));
      await store.appendRevision("alpha", "d1", storedRevision(1), 0, 3);

      expect(
        statSync(join(root, "data", "decisions", "alpha")).mode & 0o777,
      ).toBe(0o700);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("surfaces a stat error that is not ENOENT", async () => {
    const root = mkdtempSync(join(tmpdir(), "waves-notice-file-"));
    try {
      writeFileSync(join(root, "file"), "");
      await expect(
        new FileNoticeStore(join(root, "file", "data")).getDecision(
          "alpha",
          "d1",
        ),
      ).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("surfaces a read error that is not ENOENT", async () => {
    const { store, dataDir, dispose } = harness();
    try {
      await store.appendRevision("alpha", "d1", storedRevision(1), 0, 3);
      // Replace the decision file with a directory: readFile on it throws EISDIR.
      await rm(join(dataDir, "decisions", "alpha", "d1.json"));
      mkdirSync(join(dataDir, "decisions", "alpha", "d1.json"));

      await expect(store.getDecision("alpha", "d1")).rejects.toThrow();
    } finally {
      await dispose();
    }
  });

  it("surfaces a readdir error that is not ENOENT", async () => {
    const { store, dataDir, dispose } = harness();
    try {
      await store.appendRevision("alpha", "d1", storedRevision(1), 0, 3);
      chmodSync(join(dataDir, "decisions", "alpha"), 0o000);

      await expect(store.listDecisions("alpha")).rejects.toThrow(/EACCES/);
    } finally {
      chmodSync(join(dataDir, "decisions", "alpha"), 0o700);
      await dispose();
    }
  });

  it("removes the temporary file when the rename fails", async () => {
    const { store, dataDir, dispose } = harness();
    try {
      await store.appendRevision("alpha", "d1", storedRevision(1), 0, 3);
      // Make the target a directory so the atomic rename fails.
      await rm(join(dataDir, "decisions", "alpha", "d1.json"));
      mkdirSync(join(dataDir, "decisions", "alpha", "d1.json"), {
        mode: 0o700,
      });

      await expect(
        store.appendRevision("alpha", "d1", storedRevision(2), 1, 3),
      ).rejects.toThrow();
      // No temp file left behind in the project directory.
      const left = readdirSync(join(dataDir, "decisions", "alpha")).filter(
        (name) => !name.endsWith(".json"),
      );
      expect(left).toEqual([]);
    } finally {
      await dispose();
    }
  });

  it("reads nothing from a data directory that does not exist yet", async () => {
    const { store, dataDir, dispose } = harness();
    try {
      await rm(dataDir, { recursive: true, force: true });
      expect(await store.getDecision("alpha", "d1")).toBeUndefined();
      expect(await store.listDecisions("alpha")).toEqual([]);
      expect(await store.listEvents("alpha", 10)).toEqual([]);
    } finally {
      await dispose();
    }
  });

  it("skips a decision file that is gone by the time it is read", async () => {
    const { store, dataDir, dispose } = harness();
    try {
      await store.appendRevision("alpha", "d1", storedRevision(1), 0, 3);
      symlinkSync(
        join(dataDir, "nowhere.json"),
        join(dataDir, "decisions", "alpha", "ghost.json"),
      );
      const listed = await store.listDecisions("alpha");
      expect(listed.map((decision) => decision.id)).toEqual(["d1"]);
    } finally {
      await dispose();
    }
  });

  it("lists decisions in id order", async () => {
    const { store, dispose } = harness();
    try {
      await store.appendRevision("alpha", "d2", storedRevision(1, "d2"), 0, 3);
      await store.appendRevision("alpha", "d1", storedRevision(1), 0, 3);
      const listed = await store.listDecisions("alpha");
      expect(listed.map((decision) => decision.id)).toEqual(["d1", "d2"]);
    } finally {
      await dispose();
    }
  });
});

describe("corrupted notice files", () => {
  const validDecision = (id: string) =>
    JSON.stringify({
      project: "alpha",
      id,
      revisions: [
        {
          revision: 1,
          textSha256: "0".repeat(64),
          receivedAt: "2026-10-08T12:00:00Z",
          decision: decisionRevision(id, "alpha"),
        },
      ],
      entries: [],
    });

  const goodRev = (id = "d1") => ({
    revision: 1,
    textSha256: "0".repeat(64),
    receivedAt: "2026-10-08T12:00:00Z",
    decision: decisionRevision(id, "alpha"),
  });

  const goodEntry = () => ({
    index: 0,
    revision: 1,
    state: "approved",
    source: "reported",
    textSha256: "0".repeat(64),
    receivedAt: "2026-10-08T12:00:00Z",
    by: "owner",
    at: "2026-10-08T12:00:00Z",
  });

  it.each([
    ["truncated json", "{"],
    ["null", "null"],
    ["a non-object", '"x"'],
    ["an array", "[1]"],
    [
      "missing project",
      JSON.stringify({ id: "d1", revisions: [{}], entries: [] }),
    ],
    [
      "missing id",
      JSON.stringify({ project: "alpha", revisions: [{}], entries: [] }),
    ],
    [
      "missing revisions",
      JSON.stringify({ project: "alpha", id: "d1", entries: [] }),
    ],
    [
      "empty revisions",
      JSON.stringify({
        project: "alpha",
        id: "d1",
        revisions: [],
        entries: [],
      }),
    ],
    [
      "entries not an array",
      JSON.stringify({
        project: "alpha",
        id: "d1",
        revisions: [{}],
        entries: "no",
      }),
    ],
    [
      "a project that does not match",
      JSON.stringify({
        project: "beta",
        id: "d1",
        revisions: [{}],
        entries: [],
      }),
    ],
    [
      "an id that does not match",
      JSON.stringify({
        project: "alpha",
        id: "d2",
        revisions: [{}],
        entries: [],
      }),
    ],
    [
      "a revision that is not an object",
      JSON.stringify({
        project: "alpha",
        id: "d1",
        revisions: [42],
        entries: [],
      }),
    ],
    [
      "a null revision",
      JSON.stringify({
        project: "alpha",
        id: "d1",
        revisions: [null],
        entries: [],
      }),
    ],
    [
      "an empty revision object",
      JSON.stringify({
        project: "alpha",
        id: "d1",
        revisions: [{}],
        entries: [],
      }),
    ],
    [
      "a revision with a decision of the wrong project",
      JSON.stringify({
        project: "alpha",
        id: "d1",
        revisions: [
          {
            ...goodRev("d1"),
            decision: decisionRevision("d1", "beta"),
          },
        ],
        entries: [],
      }),
    ],
    [
      "a revision with a decision of the wrong id",
      JSON.stringify({
        project: "alpha",
        id: "d1",
        revisions: [
          {
            ...goodRev("d2"),
            decision: decisionRevision("d2", "alpha"),
          },
        ],
        entries: [],
      }),
    ],
    [
      "a revision with a non-number revision",
      JSON.stringify({
        project: "alpha",
        id: "d1",
        revisions: [{ ...goodRev(), revision: "1" }],
        entries: [],
      }),
    ],
    [
      "a revision with a non-integer revision",
      JSON.stringify({
        project: "alpha",
        id: "d1",
        revisions: [{ ...goodRev(), revision: 1.5 }],
        entries: [],
      }),
    ],
    [
      "a revision with a zero revision",
      JSON.stringify({
        project: "alpha",
        id: "d1",
        revisions: [{ ...goodRev(), revision: 0 }],
        entries: [],
      }),
    ],
    [
      "a revision with a non-string textSha256",
      JSON.stringify({
        project: "alpha",
        id: "d1",
        revisions: [{ ...goodRev(), textSha256: 123 }],
        entries: [],
      }),
    ],
    [
      "a revision with a malformed textSha256",
      JSON.stringify({
        project: "alpha",
        id: "d1",
        revisions: [{ ...goodRev(), textSha256: "short" }],
        entries: [],
      }),
    ],
    [
      "a revision with a non-string receivedAt",
      JSON.stringify({
        project: "alpha",
        id: "d1",
        revisions: [{ ...goodRev(), receivedAt: 123 }],
        entries: [],
      }),
    ],
    [
      "a non-object entry",
      JSON.stringify({
        project: "alpha",
        id: "d1",
        revisions: [goodRev()],
        entries: [42],
      }),
    ],
    [
      "a null entry",
      JSON.stringify({
        project: "alpha",
        id: "d1",
        revisions: [goodRev()],
        entries: [null],
      }),
    ],
    [
      "an entry with a non-integer index",
      JSON.stringify({
        project: "alpha",
        id: "d1",
        revisions: [goodRev()],
        entries: [{ ...goodEntry(), index: 1.5 }],
      }),
    ],
    [
      "an entry with a non-integer revision",
      JSON.stringify({
        project: "alpha",
        id: "d1",
        revisions: [goodRev()],
        entries: [{ ...goodEntry(), revision: 1.5 }],
      }),
    ],
    [
      "an entry with a non-string state",
      JSON.stringify({
        project: "alpha",
        id: "d1",
        revisions: [goodRev()],
        entries: [{ ...goodEntry(), state: 123 }],
      }),
    ],
    [
      "an entry with a non-string source",
      JSON.stringify({
        project: "alpha",
        id: "d1",
        revisions: [goodRev()],
        entries: [{ ...goodEntry(), source: 123 }],
      }),
    ],
    [
      "an entry with a non-string textSha256",
      JSON.stringify({
        project: "alpha",
        id: "d1",
        revisions: [goodRev()],
        entries: [{ ...goodEntry(), textSha256: 123 }],
      }),
    ],
    [
      "an entry with a non-string receivedAt",
      JSON.stringify({
        project: "alpha",
        id: "d1",
        revisions: [goodRev()],
        entries: [{ ...goodEntry(), receivedAt: 123 }],
      }),
    ],
  ])("getDecision reads %s as undefined", async (_label, raw) => {
    const { store, dataDir, dispose } = harness();
    try {
      writeDecisionFile(dataDir, "alpha", "d1", raw);
      expect(await store.getDecision("alpha", "d1")).toBeUndefined();
    } finally {
      await dispose();
    }
  });

  it("getDecision reads a valid file as its decision", async () => {
    const { store, dataDir, dispose } = harness();
    try {
      writeDecisionFile(dataDir, "alpha", "d1", validDecision("d1"));
      const read = await store.getDecision("alpha", "d1");
      expect(read?.project).toBe("alpha");
      expect(read?.id).toBe("d1");
      expect(read?.revisions).toHaveLength(1);
    } finally {
      await dispose();
    }
  });

  it("skips a malformed decision file in listDecisions", async () => {
    const { store, dataDir, dispose } = harness();
    try {
      await store.appendRevision(
        "alpha",
        "good",
        storedRevision(1, "good"),
        0,
        3,
      );
      writeDecisionFile(dataDir, "alpha", "bad", "{ broken");
      const listed = await store.listDecisions("alpha");
      expect(listed.map((d) => d.id)).toEqual(["good"]);
    } finally {
      await dispose();
    }
  });

  it("answers conflict when appending an entry to an unreadable decision", async () => {
    const { store, dataDir, dispose } = harness();
    try {
      writeDecisionFile(dataDir, "alpha", "d1", "{ broken");
      const outcome = await store.appendEntry(
        "alpha",
        "d1",
        storedEntry(0),
        0,
        1,
      );
      expect(outcome).toBe("conflict");
    } finally {
      await dispose();
    }
  });

  it("answers conflict when revising an unreadable decision", async () => {
    const { store, dataDir, dispose } = harness();
    try {
      writeDecisionFile(dataDir, "alpha", "d1", "{ broken");
      const outcome = await store.appendRevision(
        "alpha",
        "d1",
        storedRevision(2, "d1"),
        1,
        3,
      );
      expect(outcome).toBe("conflict");
    } finally {
      await dispose();
    }
  });

  it("getDecision reads a valid file with a revision and an entry", async () => {
    const { store, dataDir, dispose } = harness();
    try {
      writeDecisionFile(
        dataDir,
        "alpha",
        "d1",
        JSON.stringify({
          project: "alpha",
          id: "d1",
          revisions: [goodRev()],
          entries: [goodEntry()],
        }),
      );
      const read = await store.getDecision("alpha", "d1");
      expect(read?.project).toBe("alpha");
      expect(read?.id).toBe("d1");
      expect(read?.revisions).toHaveLength(1);
      expect(read?.entries).toHaveLength(1);
      expect(read?.entries[0]).toMatchObject({ index: 0, state: "approved" });
    } finally {
      await dispose();
    }
  });

  it("skips a shape-invalid decision file in listDecisions", async () => {
    const { store, dataDir, dispose } = harness();
    try {
      await store.appendRevision(
        "alpha",
        "good",
        storedRevision(1, "good"),
        0,
        3,
      );
      writeDecisionFile(dataDir, "alpha", "bad", validDecision("bad"));
      writeDecisionFile(
        dataDir,
        "alpha",
        "wrongproj",
        JSON.stringify({
          project: "beta",
          id: "wrongproj",
          revisions: [goodRev("wrongproj")],
          entries: [],
        }),
      );
      const listed = await store.listDecisions("alpha");
      expect(listed.map((d) => d.id)).toEqual(["bad", "good"]);
    } finally {
      await dispose();
    }
  });

  it("answers conflict when appending an entry to a shape-invalid decision", async () => {
    const { store, dataDir, dispose } = harness();
    try {
      writeDecisionFile(
        dataDir,
        "alpha",
        "d1",
        JSON.stringify({
          project: "alpha",
          id: "d1",
          revisions: [{}],
          entries: [],
        }),
      );
      const outcome = await store.appendEntry(
        "alpha",
        "d1",
        storedEntry(0),
        0,
        1,
      );
      expect(outcome).toBe("conflict");
    } finally {
      await dispose();
    }
  });

  it("answers conflict when revising a shape-invalid decision", async () => {
    const { store, dataDir, dispose } = harness();
    try {
      writeDecisionFile(
        dataDir,
        "alpha",
        "d1",
        JSON.stringify({
          project: "alpha",
          id: "d1",
          revisions: [{}],
          entries: [],
        }),
      );
      const outcome = await store.appendRevision(
        "alpha",
        "d1",
        storedRevision(2, "d1"),
        1,
        3,
      );
      expect(outcome).toBe("conflict");
    } finally {
      await dispose();
    }
  });

  it("reads an unparseable events file as no events", async () => {
    const { store, dataDir, dispose } = harness();
    try {
      writeEventsFile(dataDir, "alpha", "{ broken");
      expect(await store.listEvents("alpha", 10)).toEqual([]);
    } finally {
      await dispose();
    }
  });

  it("reads a non-array events file as no events", async () => {
    const { store, dataDir, dispose } = harness();
    try {
      writeEventsFile(dataDir, "alpha", JSON.stringify({ not: "an array" }));
      expect(await store.listEvents("alpha", 10)).toEqual([]);
    } finally {
      await dispose();
    }
  });

  it("refuses an append to an invalid events file and leaves it untouched", async () => {
    const { store, dataDir, dispose } = harness();
    try {
      const contents = "{ broken";
      writeEventsFile(dataDir, "alpha", contents);
      await expect(
        store.appendEvent(
          "alpha",
          { id: "e0", receivedAt: "2026-10-08T13:00:00Z", event: event() },
          2000,
        ),
      ).rejects.toThrow();
      expect(readFileSync(join(dataDir, "events", "alpha.json"), "utf8")).toBe(
        contents,
      );
      expect(await store.listEvents("alpha", 10)).toEqual([]);
    } finally {
      await dispose();
    }
  });

  it("refuses an append to a non-array events file and leaves it untouched", async () => {
    const { store, dataDir, dispose } = harness();
    try {
      const contents = JSON.stringify({ not: "an array" });
      writeEventsFile(dataDir, "alpha", contents);
      await expect(
        store.appendEvent(
          "alpha",
          { id: "e0", receivedAt: "2026-10-08T13:00:00Z", event: event() },
          2000,
        ),
      ).rejects.toThrow();
      expect(readFileSync(join(dataDir, "events", "alpha.json"), "utf8")).toBe(
        contents,
      );
    } finally {
      await dispose();
    }
  });
});

describe("FileNoticeStore bounds", () => {
  it.each([
    ["NaN", NaN],
    ["zero", 0],
    ["negative", -1],
    ["non-integer", 1.5],
  ])("appendRevision refuses a %s ceiling", async (_label, bad) => {
    const { store, dispose } = harness();
    try {
      await expect(
        store.appendRevision("alpha", "d1", storedRevision(1, "d1"), 0, bad),
      ).rejects.toThrow(RangeError);
    } finally {
      await dispose();
    }
  });

  it.each([
    ["NaN", NaN],
    ["zero", 0],
    ["negative", -1],
    ["non-integer", 1.5],
  ])("appendEvent refuses a %s keep", async (_label, bad) => {
    const { store, dispose } = harness();
    try {
      await expect(
        store.appendEvent(
          "alpha",
          { id: "e0", receivedAt: "2026-10-08T13:00:00Z", event: event() },
          bad,
        ),
      ).rejects.toThrow(RangeError);
    } finally {
      await dispose();
    }
  });

  it.each([
    ["NaN", NaN],
    ["zero", 0],
    ["negative", -1],
    ["non-integer", 1.5],
  ])("listEvents refuses a %s limit", async (_label, bad) => {
    const { store, dispose } = harness();
    try {
      await expect(store.listEvents("alpha", bad)).rejects.toThrow(RangeError);
    } finally {
      await dispose();
    }
  });
});
