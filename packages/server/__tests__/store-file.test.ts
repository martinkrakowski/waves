import {
  chmodSync,
  existsSync,
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

import { afterEach, describe, expect, it, vi } from "vitest";

import { FileStore } from "../src/index.js";
import {
  project,
  runStoreContract,
  snapshot,
  status,
} from "./store-contract.js";

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

afterEach(() => {
  vi.restoreAllMocks();
});

function everyEntry(dir: string): string[] {
  return readdirSync(dir, { recursive: true }).map(String).sort();
}

describe("FileStore durability", () => {
  it("reads what an earlier instance wrote", async () => {
    const { store, dataDir, dispose } = harness();
    try {
      await store.putProject(project("alpha"));
      await store.putSnapshot(snapshot("wv1"));
      await store.putStatus({
        status: status("alpha"),
        receivedAt: "2026-10-01T12:00:01Z",
      });

      const reopened = new FileStore(dataDir);

      await expect(reopened.getProject("alpha")).resolves.toEqual(
        project("alpha"),
      );
      await expect(reopened.listSnapshots("alpha")).resolves.toEqual([
        snapshot("wv1"),
      ]);
      await expect(reopened.getStatus("alpha")).resolves.toEqual({
        status: status("alpha"),
        receivedAt: "2026-10-01T12:00:01Z",
      });
      await expect(reopened.listSnapshotHeads("alpha")).resolves.toEqual([
        {
          wave: "wv1",
          receivedAt: "2026-10-01T12:00:01Z",
          intervalSeconds: 10,
          lanes: 0,
        },
      ]);
    } finally {
      await dispose();
    }
  });

  it("creates a missing data directory with mode 0700", async () => {
    const root = mkdtempSync(join(tmpdir(), "waves-file-store-"));
    const dataDir = join(root, "data");
    try {
      await new FileStore(dataDir).putProject(project("alpha"));

      expect(statSync(dataDir).mode & 0o777).toBe(0o700);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reads as absent without creating a missing data directory", async () => {
    const root = mkdtempSync(join(tmpdir(), "waves-file-store-"));
    const dataDir = join(root, "data");
    try {
      const store = new FileStore(dataDir);

      await expect(store.getProject("alpha")).resolves.toBeUndefined();
      await expect(store.listProjects()).resolves.toEqual([]);
      await expect(store.getSnapshot("alpha", "wv1")).resolves.toBeUndefined();
      await expect(store.listSnapshots("alpha")).resolves.toEqual([]);
      expect(existsSync(dataDir)).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses a data directory whose parent is missing", async () => {
    const root = mkdtempSync(join(tmpdir(), "waves-file-store-"));
    try {
      await expect(
        new FileStore(join(root, "missing", "data")).putProject(
          project("alpha"),
        ),
      ).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("writes every file with mode 0600", async () => {
    const { store, dataDir, dispose } = harness();
    try {
      await store.putProject(project("alpha"));
      await store.putSnapshot(snapshot("wv1"));
      await store.putStatus({
        status: status("alpha"),
        receivedAt: "2026-10-01T12:00:01Z",
      });

      expect(statSync(join(dataDir, "projects.json")).mode & 0o777).toBe(0o600);
      expect(
        statSync(join(dataDir, "snapshots", "alpha", "wv1.json")).mode & 0o777,
      ).toBe(0o600);
      expect(
        statSync(join(dataDir, "snapshots", "alpha", "wv1.head.json")).mode &
          0o777,
      ).toBe(0o600);
      expect(statSync(join(dataDir, "status", "alpha.json")).mode & 0o777).toBe(
        0o600,
      );
      expect(statSync(join(dataDir, "snapshots")).mode & 0o777).toBe(0o700);
      expect(statSync(join(dataDir, "status")).mode & 0o777).toBe(0o700);
      expect(statSync(join(dataDir, "snapshots", "alpha")).mode & 0o777).toBe(
        0o700,
      );
    } finally {
      await dispose();
    }
  });

  it("leaves no temporary file anywhere in the data directory", async () => {
    const { store, dataDir, dispose } = harness();
    try {
      await store.putProject(project("alpha"));
      await store.putSnapshot(snapshot("wv1"));
      await store.deleteProject("alpha");

      // No `status/`: the delete does not create a directory to remove from, so
      // a project that never pushed a status leaves the data directory as it
      // found it.
      expect(everyEntry(dataDir)).toEqual(["projects.json", "snapshots"]);
    } finally {
      await dispose();
    }
  });

  it("removes a project's status file when the project goes", async () => {
    const { store, dataDir, dispose } = harness();
    try {
      await store.putProject(project("alpha"));
      await store.putStatus({
        status: status("alpha"),
        receivedAt: "2026-10-01T12:00:01Z",
      });
      await store.putStatus({
        status: status("beta"),
        receivedAt: "2026-10-01T12:00:01Z",
      });

      await store.deleteProject("alpha");

      expect(readdirSync(join(dataDir, "status"))).toEqual(["beta.json"]);
      await expect(store.getStatus("alpha")).resolves.toBeUndefined();
      await expect(store.getStatus("beta")).resolves.toEqual({
        status: status("beta"),
        receivedAt: "2026-10-01T12:00:01Z",
      });
    } finally {
      await dispose();
    }
  });

  it("removes the temporary file when the rename fails", async () => {
    const { store, dataDir, dispose } = harness();
    try {
      mkdirSync(join(dataDir, "snapshots"), { mode: 0o700 });
      mkdirSync(join(dataDir, "snapshots", "alpha"), { mode: 0o700 });
      mkdirSync(join(dataDir, "snapshots", "alpha", "wv1.json"), {
        mode: 0o700,
      });

      await expect(store.putSnapshot(snapshot("wv1"))).rejects.toThrow();
      expect(everyEntry(dataDir)).toEqual([
        "snapshots",
        join("snapshots", "alpha"),
        join("snapshots", "alpha", "wv1.json"),
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

  it("ignores a dangling symlink and other files when listing", async () => {
    const { store, dataDir, dispose } = harness();
    try {
      await store.putSnapshot(snapshot("wv1"));
      const waveDir = join(dataDir, "snapshots", "alpha");
      symlinkSync(join(waveDir, "gone.json"), join(waveDir, "wv2.json"));
      writeFileSync(join(waveDir, "wv3.json.tmp-1-2"), "{partial");

      await expect(store.listSnapshots("alpha")).resolves.toEqual([
        snapshot("wv1"),
      ]);
    } finally {
      await dispose();
    }
  });
});

describe("FileStore concurrent creates", () => {
  it("lets exactly one of two creates of the same id win", async () => {
    const { store, dispose } = harness();
    try {
      // Started together, so the second call is waiting in the queue rather than
      // reading a registry the first has already written: the check and the
      // write have to be the same queued operation for this to hold.
      const outcomes = await Promise.all([
        store.createProject(project("alpha", "First"), 64),
        store.createProject(project("alpha", "Second"), 64),
      ]);

      expect([...outcomes].sort()).toEqual(["created", "exists"]);
      await expect(store.listProjects()).resolves.toHaveLength(1);
    } finally {
      await dispose();
    }
  });

  it("lets only one of two different ids through at the ceiling", async () => {
    const { store, dispose } = harness();
    try {
      await store.putProject(project("gamma"));
      await store.putProject(project("delta"));

      const outcomes = await Promise.all([
        store.createProject(project("alpha"), 3),
        store.createProject(project("beta"), 3),
      ]);

      expect([...outcomes].sort()).toEqual(["ceiling", "created"]);
      await expect(store.listProjects()).resolves.toHaveLength(3);
    } finally {
      await dispose();
    }
  });

  it("lets only one of many concurrent creates through at the ceiling", async () => {
    const { store, dispose } = harness();
    try {
      await store.putProject(project("seed"));

      const outcomes = await Promise.all(
        ["alpha", "beta", "gamma", "delta"].map((id) =>
          store.createProject(project(id), 2),
        ),
      );

      // One slot below the ceiling of two, and four callers that all read the
      // registry before any of them wrote: the queue is what leaves one winner.
      expect(outcomes.filter((outcome) => outcome === "created")).toHaveLength(
        1,
      );
      expect(outcomes.filter((outcome) => outcome === "ceiling")).toHaveLength(
        3,
      );
      await expect(store.listProjects()).resolves.toHaveLength(2);
    } finally {
      await dispose();
    }
  });
});

describe("FileStore hostile filesystem", () => {
  it("refuses a data directory that is a symbolic link", async () => {
    const root = mkdtempSync(join(tmpdir(), "waves-file-store-"));
    try {
      const real = join(root, "real");
      mkdirSync(real);
      symlinkSync(real, join(root, "link"));

      await expect(
        new FileStore(join(root, "link")).putProject(project("alpha")),
      ).rejects.toThrow("is a symbolic link");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses a data directory that is not a directory", async () => {
    const root = mkdtempSync(join(tmpdir(), "waves-file-store-"));
    try {
      const file = join(root, "file");
      writeFileSync(file, "");

      await expect(new FileStore(file).getProject("alpha")).rejects.toThrow(
        "is not a directory",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses a data directory owned by another user", async () => {
    const { store, dispose } = harness();
    try {
      vi.spyOn(process, "getuid").mockReturnValue(4_242);

      await expect(store.getProject("alpha")).rejects.toThrow(
        "is not owned by this process",
      );
    } finally {
      await dispose();
    }
  });

  it("refuses a data directory that other users can reach", async () => {
    const { store, dataDir, dispose } = harness();
    try {
      chmodSync(dataDir, 0o755);

      await expect(store.getProject("alpha")).rejects.toThrow(
        "is accessible to other users",
      );
      expect(statSync(dataDir).mode & 0o777).toBe(0o755);
    } finally {
      await dispose();
    }
  });

  it("refuses a project directory that is a symbolic link on every path", async () => {
    const { store, dataDir, dispose } = harness();
    try {
      const outside = join(dataDir, "outside");
      mkdirSync(join(dataDir, "snapshots"), { mode: 0o700 });
      mkdirSync(outside);
      writeFileSync(join(outside, "canary"), "untouched");
      symlinkSync(outside, join(dataDir, "snapshots", "alpha"));

      await expect(store.getSnapshot("alpha", "wv1")).rejects.toThrow(
        "is a symbolic link",
      );
      await expect(store.listSnapshots("alpha")).rejects.toThrow(
        "is a symbolic link",
      );
      await expect(store.deleteSnapshot("alpha", "wv1")).rejects.toThrow(
        "is a symbolic link",
      );
      await expect(store.deleteProject("alpha")).rejects.toThrow(
        "is a symbolic link",
      );
      expect(readdirSync(outside)).toEqual(["canary"]);
    } finally {
      await dispose();
    }
  });

  it("refuses a snapshots directory that is a symbolic link on read", async () => {
    const { store, dataDir, dispose } = harness();
    try {
      const outside = join(dataDir, "outside");
      mkdirSync(outside);
      writeFileSync(join(outside, "canary"), "untouched");
      symlinkSync(outside, join(dataDir, "snapshots"));

      await expect(store.getSnapshot("alpha", "wv1")).rejects.toThrow(
        "is a symbolic link",
      );
      await expect(store.listSnapshots("alpha")).rejects.toThrow(
        "is a symbolic link",
      );
      await expect(store.deleteSnapshot("alpha", "wv1")).rejects.toThrow(
        "is a symbolic link",
      );
      expect(readdirSync(outside)).toEqual(["canary"]);
    } finally {
      await dispose();
    }
  });

  it("refuses a snapshots path that is not a directory", async () => {
    const { store, dataDir, dispose } = harness();
    try {
      writeFileSync(join(dataDir, "snapshots"), "");

      await expect(store.putSnapshot(snapshot("wv1"))).rejects.toThrow(
        "is not a directory",
      );
    } finally {
      await dispose();
    }
  });

  it("refuses a symlinked status directory on a write", async () => {
    const { store, dataDir, dispose } = harness();
    try {
      const outside = join(dataDir, "outside");
      mkdirSync(outside);
      writeFileSync(join(outside, "canary"), "untouched");
      symlinkSync(outside, join(dataDir, "status"));

      await expect(
        store.putStatus({
          status: status("alpha"),
          receivedAt: "2026-10-01T12:00:01Z",
        }),
      ).rejects.toThrow("is a symbolic link");
      expect(readdirSync(outside)).toEqual(["canary"]);
    } finally {
      await dispose();
    }
  });

  it("refuses a symlinked status directory on a read and on a delete", async () => {
    const { store, dataDir, dispose } = harness();
    try {
      const outside = join(dataDir, "outside");
      mkdirSync(outside);
      writeFileSync(join(outside, "canary"), "untouched");
      symlinkSync(outside, join(dataDir, "status"));

      await expect(store.getStatus("alpha")).rejects.toThrow(
        "is a symbolic link",
      );
      await expect(store.deleteProject("alpha")).rejects.toThrow(
        "is a symbolic link",
      );
      expect(readdirSync(outside)).toEqual(["canary"]);
    } finally {
      await dispose();
    }
  });

  it("refuses a delete as a whole when the status directory is refused", async () => {
    const { store, dataDir, dispose } = harness();
    try {
      await store.putProject(project("alpha"));
      const outside = join(dataDir, "outside");
      mkdirSync(outside);
      symlinkSync(outside, join(dataDir, "status"));

      await expect(store.deleteProject("alpha")).rejects.toThrow(
        "is a symbolic link",
      );
      // Nothing changed, so a retry once the directory is fixed finds it.
      await expect(store.getProject("alpha")).resolves.toBeDefined();
    } finally {
      await dispose();
    }
  });

  it("surfaces a read error that is not ENOENT", async () => {
    const { store, dataDir, dispose } = harness();
    try {
      mkdirSync(join(dataDir, "projects.json"));

      await expect(store.getProject("alpha")).rejects.toThrow();
    } finally {
      await dispose();
    }
  });

  it("surfaces a readdir error that is not ENOENT", async () => {
    const { store, dataDir, dispose } = harness();
    const projectDir = join(dataDir, "snapshots", "alpha");
    mkdirSync(join(dataDir, "snapshots"), { mode: 0o700 });
    mkdirSync(projectDir, { mode: 0o000 });
    try {
      await expect(store.listSnapshots("alpha")).rejects.toThrow(/EACCES/);
    } finally {
      chmodSync(projectDir, 0o700);
      await dispose();
    }
  });

  it("surfaces a stat error that is not ENOENT", async () => {
    const root = mkdtempSync(join(tmpdir(), "waves-file-store-"));
    try {
      writeFileSync(join(root, "file"), "");

      await expect(
        new FileStore(join(root, "file", "data")).getProject("alpha"),
      ).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
