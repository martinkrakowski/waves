import type { Stats } from "node:fs";

/**
 * The shared filesystem checks every adapter applies before it trusts a path:
 * it is a real directory, not a symbolic link, owned by this process and not
 * readable by anyone else. Pulling them out of `file-store.ts` lets the notice
 * store apply the very same checks rather than a copy of them.
 */

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
