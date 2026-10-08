import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FileNoticeStore } from "../src/infrastructure/file-notice-store.js";
import { event, storedEntry, storedRevision } from "./notice-contract.js";

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
      await store.appendRevision("alpha", "d2", storedRevision(1), 0, 2);

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
      const outcome = await store.appendEntry("alpha", "d1", storedEntry(0), 0);
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
      await store.appendEntry("alpha", "d1", storedEntry(0), 0);

      const outcome = await store.appendEntry("alpha", "d1", storedEntry(1), 5);
      expect(outcome).toBe("conflict");
      const read = await store.getDecision("alpha", "d1");
      expect(read?.entries).toHaveLength(1);
    } finally {
      await dispose();
    }
  });

  it("drops the oldest events past the keep count", async () => {
    const { store, dispose } = harness();
    try {
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
        expect(outcome.dropped).toBe(at > 1 ? 1 : 0);
      }

      const listed = await store.listEvents("alpha", 2000);
      expect(listed).toHaveLength(2);
      expect(listed.map((e) => e.id)).toEqual(["e2", "e1"]);
    } finally {
      await dispose();
    }
  });

  it("lists decisions ordered by id", async () => {
    const { store, dispose } = harness();
    try {
      await store.appendRevision("alpha", "z", storedRevision(1), 0, 3);
      await store.appendRevision("alpha", "a", storedRevision(1), 0, 3);

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
        "e2",
        "e1",
      ]);
    } finally {
      await dispose();
    }
  });

  it("deletes the notices of a project and leaves another project's", async () => {
    const { store, dispose } = harness();
    try {
      await store.appendRevision("alpha", "d1", storedRevision(1), 0, 3);
      await store.appendRevision("beta", "d1", storedRevision(1), 0, 3);
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
      await store.appendEntry("alpha", "d1", storedEntry(0), 0);

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
