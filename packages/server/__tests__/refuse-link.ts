import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect } from "vitest";

// Plants a symlink over `storedPath` pointing at a copy of its bytes in a
// directory outside the data directory, and asserts that `run` refuses it
// with the symlink message while the outside copy keeps its bytes and the
// link stays a link.
export async function refuseLink(
  storedPath: string,
  run: () => Promise<unknown>,
): Promise<void> {
  const outsideDir = mkdtempSync(join(tmpdir(), "waves-outside-"));
  const bytes = readFileSync(storedPath, "utf8");
  const outsideFile = join(outsideDir, "copy.json");
  writeFileSync(outsideFile, bytes);
  rmSync(storedPath);
  symlinkSync(outsideFile, storedPath);
  try {
    await expect(run()).rejects.toThrow(/is a symbolic link, not a file/);
    expect(readFileSync(outsideFile, "utf8")).toBe(bytes);
    expect(lstatSync(storedPath).isSymbolicLink()).toBe(true);
  } finally {
    await rm(outsideDir, { recursive: true, force: true });
  }
}
