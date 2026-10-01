import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";

import type { Files } from "../application/ports.js";

/** A token file is readable by its owner and by nobody else. */
export const SECRET_MODE = 0o600;

/** Nor is the directory that holds them. */
export const DIRECTORY_MODE = 0o700;

const MISSING = "ENOENT";

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === MISSING;
}

export function fileSystem(): Files {
  return {
    readText: async (path) => {
      try {
        return await readFile(path, "utf8");
      } catch (error) {
        if (isMissing(error)) {
          return undefined;
        }
        throw error;
      }
    },
    readSecret: async (path) => {
      try {
        const info = await stat(path);
        return { text: await readFile(path, "utf8"), mode: info.mode };
      } catch (error) {
        if (isMissing(error)) {
          return undefined;
        }
        throw error;
      }
    },
    exists: async (path) => {
      try {
        await stat(path);
        return true;
      } catch (error) {
        if (isMissing(error)) {
          return false;
        }
        throw error;
      }
    },
    /**
     * Writes the secret through a temporary file in the same directory and one
     * rename. A reader either sees the old file or the new one, never a half
     * written token, and the bytes on disk are 0600 from the moment they exist.
     */
    writeSecret: async (path, secret) => {
      const directory = dirname(path);
      if (!(await isDirectory(directory))) {
        await mkdir(directory, { recursive: true, mode: DIRECTORY_MODE });
        await chmod(directory, DIRECTORY_MODE);
      }
      const temporary = `${path}.${randomUUID()}.tmp`;
      await writeFile(temporary, secret, { mode: SECRET_MODE, flag: "wx" });
      await chmod(temporary, SECRET_MODE);
      await rename(temporary, path);
    },
  };
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if (isMissing(error)) {
      return false;
    }
    throw error;
  }
}
