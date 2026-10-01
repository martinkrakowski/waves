import { mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { StoredSnapshot } from "@hexagen-monaco/waves-contract";

import { FileStore } from "../src/index.js";
import { project, runStoreContract, snapshot } from "./store-contract.js";

interface FileHarness {
  readonly store: FileStore;
  readonly dataDir: string;
  readonly dispose: () => Promise<void>;
}

function harness(): FileHarness {
  const dataDir = mkdtempSync(join(tmpdir(), "waves-file-store-"));
  return {
    store: new FileStore(dataDir),
    dataDir,
    dispose: () => rm(dataDir, { recursive: true, force: true }),
  };
}

runStoreContract(harness);

function inProject(wave: string): StoredSnapshot {
  return {
    envelope: { ...snapshot("wv1").envelope, wave },
    receivedAt: "2026-10-01T12:00:01Z",
  };
}

describe("FileStore", () => {
  it("reads what an earlier instance wrote", async () => {
    const { store, dataDir, dispose } = harness();
    try {
      await store.putProject(project("alpha"));
      await store.putSnapshot(snapshot("wv1"));

      const reopened = new FileStore(dataDir);

      await expect(reopened.getProject("alpha")).resolves.toEqual(
        project("alpha"),
      );
      await expect(reopened.listSnapshots("alpha")).resolves.toEqual([
        snapshot("wv1"),
      ]);
    } finally {
      await dispose();
    }
  });

  it("creates a missing data directory with mode 0700", async () => {
    const root = mkdtempSync(join(tmpdir(), "waves-file-store-"));
    const dataDir = join(root, "nested", "data");
    try {
      await new FileStore(dataDir).putProject(project("alpha"));

      expect(statSync(dataDir).mode & 0o777).toBe(0o700);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("leaves no temporary file behind after a write", async () => {
    const { store, dataDir, dispose } = harness();
    try {
      await store.putProject(project("alpha"));
      await store.putSnapshot(snapshot("wv1"));

      expect(readdirSync(dataDir).sort()).toEqual([
        "projects.json",
        "snapshots",
      ]);
    } finally {
      await dispose();
    }
  });

  it.each(["../escape", "a/b", "..", "ALPHA", "", "a".repeat(64)])(
    "rejects the invalid project id %j",
    async (id) => {
      const { store, dispose } = harness();
      try {
        await expect(store.getProject(id)).rejects.toThrow(
          "invalid project id",
        );
        await expect(store.deleteProject(id)).rejects.toThrow(
          "invalid project id",
        );
        await expect(store.listSnapshots(id)).rejects.toThrow(
          "invalid project id",
        );
        await expect(store.putProject(project(id))).rejects.toThrow(
          "invalid project id",
        );
        await expect(
          store.putSnapshot({
            envelope: { ...snapshot("wv1").envelope, project: id },
            receivedAt: "2026-10-01T12:00:01Z",
          }),
        ).rejects.toThrow("invalid project id");
      } finally {
        await dispose();
      }
    },
  );

  it.each(["wv/1", "..", "wv.1", "-wv", "", "w".repeat(81)])(
    "rejects the invalid wave id %j",
    async (wave) => {
      const { store, dispose } = harness();
      try {
        await expect(store.getSnapshot("alpha", wave)).rejects.toThrow(
          "invalid wave id",
        );
        await expect(store.deleteSnapshot("alpha", wave)).rejects.toThrow(
          "invalid wave id",
        );
        await expect(store.putSnapshot(inProject(wave))).rejects.toThrow(
          "invalid wave id",
        );
      } finally {
        await dispose();
      }
    },
  );

  it("leaves valid JSON after twenty concurrent writes of one snapshot", async () => {
    const { store, dispose } = harness();
    try {
      const writes = Array.from({ length: 20 }, (_unused, index) =>
        store.putSnapshot(
          snapshot(
            "wv1",
            `2026-10-01T12:${String(index).padStart(2, "0")}:00Z`,
          ),
        ),
      );

      await expect(Promise.all(writes)).resolves.toHaveLength(20);

      const stored = await store.getSnapshot("alpha", "wv1");
      expect(stored?.envelope.project).toBe("alpha");
      expect(stored?.envelope.generatedAt).toMatch(/^2026-10-01T12:\d{2}:00Z$/);
    } finally {
      await dispose();
    }
  });

  it("ignores files that are not snapshots when listing", async () => {
    const { store, dataDir, dispose } = harness();
    try {
      await store.putSnapshot(snapshot("wv1"));
      writeFileSync(
        join(dataDir, "snapshots", "alpha", "wv1.json.tmp-1-2"),
        "{partial",
      );

      await expect(store.listSnapshots("alpha")).resolves.toEqual([
        snapshot("wv1"),
      ]);
    } finally {
      await dispose();
    }
  });

  it("surfaces a corrupt projects file", async () => {
    const { store, dataDir, dispose } = harness();
    try {
      writeFileSync(join(dataDir, "projects.json"), "{ not json");

      await expect(store.getProject("alpha")).rejects.toThrow(SyntaxError);
    } finally {
      await dispose();
    }
  });
});
