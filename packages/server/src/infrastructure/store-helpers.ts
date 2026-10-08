import { randomUUID } from "node:crypto";
import type { Stats } from "node:fs";
import { rename, rm, writeFile } from "node:fs/promises";

export const FILE_MODE = 0o600;

export function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

export function assertRealDirectory(info: Stats, path: string): void {
  if (info.isSymbolicLink()) {
    throw new Error(`${path} is a symbolic link, not a directory`);
  }
  if (!info.isDirectory()) {
    throw new Error(`${path} is not a directory`);
  }
  if (info.uid !== process.getuid!()) {
    throw new Error(`${path} is not owned by this process`);
  }
  if ((info.mode & 0o077) !== 0) {
    throw new Error(`${path} is accessible to other users`);
  }
}

/**
 * Writes `payload` to `target` atomically: a temporary file in the same
 * directory, then a rename — the atomic swap — with the temporary removed on
 * failure. Shared by both file stores so the cleanup path is written once and
 * covered by either store's hostile-filesystem tests.
 */
export async function writeAtomic(
  target: string,
  payload: string,
): Promise<void> {
  const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporary, payload, {
      encoding: "utf8",
      mode: FILE_MODE,
    });
    await rename(temporary, target);
  } catch (error) {
    try {
      await rm(temporary, { force: true });
    } catch {
      void ignore();
    }
    throw error;
  }
}

function ignore(): undefined {
  return undefined;
}
