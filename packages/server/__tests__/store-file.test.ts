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

      expect(statSync(join(dataDir, "projects.json")).mode & 0o777).toBe(0o600);
      expect(
        statSync(join(dataDir, "snapshots", "alpha", "wv1.json")).mode & 0o777,
      ).toBe(0o600);
      expect(statSync(join(dataDir, "snapshots")).mode & 0o777).toBe(0o700);
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

      expect(everyEntry(dataDir)).toEqual(["projects.json", "snapshots"]);
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
