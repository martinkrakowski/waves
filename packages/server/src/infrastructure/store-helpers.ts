import { randomUUID } from "node:crypto";
import { constants, type Stats } from "node:fs";
import {
  type FileHandle,
  lstat,
  open,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";

import type { StoredEvent } from "../application/ports/notice-store.js";

export const FILE_MODE = 0o600;

export function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

/**
 * Throws a `RangeError` unless `value` is a positive safe integer, so an unset,
 * zero, negative, NaN or non-integer bound refuses the request rather than
 * silently failing to bind (`slice` with `NaN` returns an empty list, a negative
 * `limit` keeps the wrong elements, and so on). Named for the caller's message.
 */
export function assertPositiveBound(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer, got ${value}`);
  }
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
 * Reads a document file as text without ever following a symbolic link: a
 * document file that is a symbolic link is refused and reported with
 * `<path> is a symbolic link, not a file`, and a dangling link is refused the
 * same way. The OPEN itself refuses the link (`O_NOFOLLOW` answers `ELOOP`
 * before the link is followed), so there is no check-then-open window on the
 * file itself. A missing file answers `undefined`; `O_NONBLOCK` keeps a FIFO
 * planted as a document from hanging the open, and anything at the path that
 * is not a regular file is refused.
 */
export async function readTextNoFollow(
  path: string,
): Promise<string | undefined> {
  let handle: FileHandle;
  try {
    handle = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT") {
      return undefined;
    }
    if (code === "ELOOP") {
      throw new Error(`${path} is a symbolic link, not a file`);
    }
    throw error;
  }
  try {
    if (!(await handle.stat()).isFile()) {
      throw new Error(`${path} is not a regular file`);
    }
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

/**
 * Writes `payload` to `target` atomically: a temporary file in the same
 * directory, then a rename — the atomic swap — with the temporary removed on
 * failure. Shared by both file stores so the cleanup path is written once and
 * covered by either store's hostile-filesystem tests.
 *
 * `rename` replaces a directory entry and never writes through a link. The
 * `lstat` of the target first is what makes an existing link a refusal
 * (`<target> is a symbolic link, not a file`) instead of a silent
 * replacement: nothing is written and no temporary file is created. A link
 * created between the `lstat` and the `rename` is replaced, not followed —
 * the remaining window, and it needs write access to the 0700 data directory.
 * The temporary file is created with `wx` (`O_CREAT | O_EXCL`): it fails if
 * the name exists and never follows a link at that name.
 */
export async function writeAtomic(
  target: string,
  payload: string,
): Promise<void> {
  let info: Stats | undefined;
  try {
    info = await lstat(target);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      throw error;
    }
  }
  if (info?.isSymbolicLink()) {
    throw new Error(`${target} is a symbolic link, not a file`);
  }
  const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporary, payload, {
      encoding: "utf8",
      mode: FILE_MODE,
      flag: "wx",
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

/**
 * Removes one document file; a missing one is not an error; a symbolic link
 * is refused and left in place — removing it is the operator's.
 */
export async function removeDocument(path: string): Promise<void> {
  let info: Stats;
  try {
    info = await lstat(path);
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return;
    }
    throw error;
  }
  if (info.isSymbolicLink()) {
    throw new Error(`${path} is a symbolic link, not a file`);
  }
  await rm(path, { force: true });
}

function ignore(): undefined {
  return undefined;
}
