import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { FileStore } from "../src/infrastructure/file-store.js";
import { FileNoticeStore } from "../src/index.js";
import { storedRevision } from "./notice-contract.js";
import { snapshot } from "./store-contract.js";

const vanished = vi.hoisted(() => ({
  current: undefined as string | undefined,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: (path: string, flags?: unknown) => {
      if (basename(path) === vanished.current) {
        return Promise.reject(
          Object.assign(new Error("ENOENT: vanished"), { code: "ENOENT" }),
        );
      }
      return actual.open(path, flags as Parameters<typeof actual.open>[1]);
    },
  };
});

afterEach(() => {
  vanished.current = undefined;
});

describe("FileStore skips a document that vanishes between listing and read", () => {
  it("listSnapshots skips the vanished snapshot", async () => {
    const dir = mkdtempSync(join(tmpdir(), "waves-vanished-"));
    try {
      const store = new FileStore(dir);
      await store.putSnapshot(snapshot("wv1"));
      await store.putSnapshot(snapshot("wv2"));

      vanished.current = "wv2.json";
      await expect(store.listSnapshots("alpha")).resolves.toEqual([
        snapshot("wv1"),
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("listSnapshotHeads skips the vanished head", async () => {
    const dir = mkdtempSync(join(tmpdir(), "waves-vanished-"));
    try {
      const store = new FileStore(dir);
      await store.putSnapshot(snapshot("wv1"));
      await store.putSnapshot(snapshot("wv2"));

      vanished.current = "wv2.head.json";
      await expect(store.listSnapshotHeads("alpha")).resolves.toEqual([
        {
          wave: "wv1",
          receivedAt: "2026-10-01T12:00:01Z",
          intervalSeconds: 10,
          lanes: 0,
        },
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("FileNoticeStore skips a decision that vanishes between listing and read", () => {
  it("listDecisions skips the vanished decision", async () => {
    const dir = mkdtempSync(join(tmpdir(), "waves-vanished-"));
    try {
      const store = new FileNoticeStore(dir);
      await store.appendRevision("alpha", "d1", storedRevision(1), 0, 3);
      await store.appendRevision("alpha", "d2", storedRevision(1, "d2"), 0, 3);

      vanished.current = "d2.json";
      const listed = await store.listDecisions("alpha");
      expect(listed.map((decision) => decision.id)).toEqual(["d1"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
