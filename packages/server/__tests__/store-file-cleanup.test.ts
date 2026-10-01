import { mkdirSync, mkdtempSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rm: (path: unknown, options?: unknown) => {
      if (typeof path === "string" && path.includes(".tmp-")) {
        return Promise.reject(
          Object.assign(new Error("cleanup failed"), { code: "EACCES" }),
        );
      }
      return actual.rm(path as never, options as never);
    },
  };
});

const { FileStore } = await import("../src/index.js");
const { snapshot } = await import("./store-contract.js");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("FileStore cleanup does not mask the original error", () => {
  it("propagates the rename error when the cleanup also fails", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "waves-file-store-"));
    try {
      mkdirSync(join(dataDir, "snapshots"), { mode: 0o700 });
      mkdirSync(join(dataDir, "snapshots", "alpha"), { mode: 0o700 });
      mkdirSync(join(dataDir, "snapshots", "alpha", "wv1.json"), {
        mode: 0o700,
      });

      const failure = await new FileStore(dataDir)
        .putSnapshot(snapshot("wv1"))
        .then(
          () => undefined,
          (error: unknown) => error,
        );

      expect(failure).toBeDefined();
      expect((failure as NodeJS.ErrnoException).code).toBe("EISDIR");
      expect(
        statSync(join(dataDir, "snapshots", "alpha", "wv1.json")).isDirectory(),
      ).toBe(true);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
