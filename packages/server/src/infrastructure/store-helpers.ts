import { randomUUID } from "node:crypto";
import type { Stats } from "node:fs";
import { rename, rm, writeFile } from "node:fs/promises";

import type { StoredEvent } from "../application/ports/notice-store.js";

export const FILE_MODE = 0o600;

export function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

/**
 * The sequence the next appended event takes: one more than the latest stored
 * event's, or 1 for an empty list. The sequence is kept in the id, so dropping
 * the oldest event cannot free a sequence for a colliding id, even two events
 * that arrive in the same millisecond. The store reads it from the last stored
 * id inside a serialised append, where no other writer can interleave.
 */
export function nextEventSequence(events: readonly StoredEvent[]): number {
  if (events.length === 0) {
    return 1;
  }
  const last = events[events.length - 1]!.id;
  return Number(last.slice(last.lastIndexOf("-") + 1)) + 1;
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
