import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { FileStore } from "../src/infrastructure/file-store.js";
import { snapshot, withLanes } from "./store-contract.js";

const reads = vi.hoisted(() => ({ paths: [] as string[] }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: (path: never, options: never) => {
      reads.paths.push(String(path));
      return actual.readFile(path, options);
    },
  };
});

const directories: string[] = [];

function harness(): { store: FileStore; dataDir: string } {
  const dataDir = mkdtempSync(join(tmpdir(), "waves-heads-"));
  directories.push(dataDir);
  return { store: new FileStore(dataDir), dataDir };
}

afterEach(() => {
  reads.paths.length = 0;
  for (const dataDir of directories.splice(0)) {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

describe("FileStore heads", () => {
  it("writes a head beside every snapshot", async () => {
    const { store, dataDir } = harness();

    await store.putSnapshot(withLanes("wv1", 3));

    await expect(
      readFile(join(dataDir, "snapshots", "alpha", "wv1.head.json"), "utf8"),
    ).resolves.toBe(
      '{"wave":"wv1","receivedAt":"2026-10-01T12:00:01Z","intervalSeconds":10,"lanes":3}',
    );
  });

  it("lists the heads without reading a single full snapshot", async () => {
    const { store, dataDir } = harness();
    await store.putSnapshot(snapshot("wv1"));
    await store.putSnapshot(snapshot("wv2"));
    reads.paths.length = 0;

    await expect(store.listSnapshotHeads("alpha")).resolves.toEqual([
      {
        wave: "wv1",
        receivedAt: "2026-10-01T12:00:01Z",
        intervalSeconds: 10,
        lanes: 0,
      },
      {
        wave: "wv2",
        receivedAt: "2026-10-01T12:00:01Z",
        intervalSeconds: 10,
        lanes: 0,
      },
    ]);
    expect(reads.paths.map((path) => basename(path))).toEqual([
      "wv1.head.json",
      "wv2.head.json",
    ]);
    expect(reads.paths).not.toContain(
      join(dataDir, "snapshots", "alpha", "wv1.json"),
    );
  });

  it("ignores a head that cannot be read", async () => {
    const { store, dataDir } = harness();
    await store.putSnapshot(snapshot("wv1"));
    symlinkSync(
      join(dataDir, "snapshots", "alpha", "gone.head.json"),
      join(dataDir, "snapshots", "alpha", "wv2.head.json"),
    );

    await expect(store.listSnapshotHeads("alpha")).resolves.toEqual([
      {
        wave: "wv1",
        receivedAt: "2026-10-01T12:00:01Z",
        intervalSeconds: 10,
        lanes: 0,
      },
    ]);
  });
});
