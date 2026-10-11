import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  readTextNoFollow,
  writeAtomic,
} from "../src/infrastructure/store-helpers.js";

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe("readTextNoFollow", () => {
  it("reads a regular file as its text", async () => {
    const dir = tempDir("waves-nofollow-");
    try {
      writeFileSync(join(dir, "doc.json"), "text");

      await expect(readTextNoFollow(join(dir, "doc.json"))).resolves.toBe(
        "text",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("answers undefined for a missing file", async () => {
    const dir = tempDir("waves-nofollow-");
    try {
      await expect(readTextNoFollow(join(dir, "absent.json"))).resolves.toBe(
        undefined,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses a symlink to a file outside the directory", async () => {
    const dir = tempDir("waves-nofollow-");
    const outside = tempDir("waves-outside-");
    try {
      writeFileSync(join(outside, "secret.json"), "secret");
      const link = join(dir, "doc.json");
      symlinkSync(join(outside, "secret.json"), link);

      await expect(readTextNoFollow(link)).rejects.toThrow(
        /is a symbolic link, not a file/,
      );
      expect(readFileSync(join(outside, "secret.json"), "utf8")).toBe(
        "secret",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("refuses a dangling symlink", async () => {
    const dir = tempDir("waves-nofollow-");
    try {
      const link = join(dir, "doc.json");
      symlinkSync(join(dir, "nowhere.json"), link);

      await expect(readTextNoFollow(link)).rejects.toThrow(
        /is a symbolic link, not a file/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses a directory at the path", async () => {
    const dir = tempDir("waves-nofollow-");
    try {
      mkdirSync(join(dir, "doc.json"));

      await expect(readTextNoFollow(join(dir, "doc.json"))).rejects.toThrow(
        /is not a regular file/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("passes through an error that is not ENOENT or ELOOP", async () => {
    const dir = tempDir("waves-nofollow-");
    try {
      writeFileSync(join(dir, "file"), "");

      await expect(
        readTextNoFollow(join(dir, "file", "x")),
      ).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("writeAtomic", () => {
  it("refuses a symlinked target, writes nothing and removes no link", async () => {
    const dir = tempDir("waves-nofollow-");
    const outside = tempDir("waves-outside-");
    try {
      writeFileSync(join(outside, "secret.json"), "secret");
      const target = join(dir, "doc.json");
      symlinkSync(join(outside, "secret.json"), target);

      await expect(writeAtomic(target, "payload")).rejects.toThrow(
        /is a symbolic link, not a file/,
      );
      expect(readFileSync(join(outside, "secret.json"), "utf8")).toBe(
        "secret",
      );
      expect(lstatSync(target).isSymbolicLink()).toBe(true);
      expect(
        readdirSync(dir).some((name) => name.includes(".tmp-")),
      ).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("refuses a dangling symlinked target and creates nothing at the pointed name", async () => {
    const dir = tempDir("waves-nofollow-");
    try {
      const target = join(dir, "doc.json");
      const pointed = join(dir, "victim.json");
      symlinkSync(pointed, target);

      await expect(writeAtomic(target, "payload")).rejects.toThrow(
        /is a symbolic link, not a file/,
      );
      expect(lstatSync(target).isSymbolicLink()).toBe(true);
      expect(existsSync(pointed)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("writes a target and replaces it, with mode 0600", async () => {
    const dir = tempDir("waves-nofollow-");
    try {
      const target = join(dir, "doc.json");

      await writeAtomic(target, "first");
      await writeAtomic(target, "second");

      expect(readFileSync(target, "utf8")).toBe("second");
      expect(statSync(target).mode & 0o777).toBe(0o600);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("passes through an lstat error that is not ENOENT", async () => {
    const dir = tempDir("waves-nofollow-");
    try {
      writeFileSync(join(dir, "file"), "");

      await expect(
        writeAtomic(join(dir, "file", "x"), "payload"),
      ).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
