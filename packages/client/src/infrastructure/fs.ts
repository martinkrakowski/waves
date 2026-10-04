import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import type { Stats } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";

import {
  FileRefusal,
  type FileRead,
  type Files,
} from "../application/ports.js";
import { isTightMode, modeText } from "../domain/secret.js";

/** A token file is readable by its owner and by nobody else. */
export const SECRET_MODE = 0o600;

/** Nor is the directory that holds them. */
export const DIRECTORY_MODE = 0o700;

const MISSING = "ENOENT";
const LOOP = "ELOOP";
const REACHABLE_BY_OTHERS = 0o077;

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === MISSING;
}

/** `O_NOFOLLOW` says this with ELOOP: the path is a link and was not followed. */
function isLink(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === LOOP;
}

/** The message for anything the kernel refused, naming the path and the code. */
function named(path: string, error: unknown): FileRefusal {
  const code = String((error as NodeJS.ErrnoException).code);
  return new FileRefusal(`${path} could not be read: ${code}`);
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
        throw named(path, error);
      }
    },
    /**
     * A secret is opened without following a link, checked on the descriptor
     * itself and read from that same descriptor. Nothing here trusts the path:
     * a link, a directory, a file another account owns or a mode with any other
     * bit set all refuse, because a secret that anyone else can name is a secret
     * that was never locked.
     *
     * `name` is only ever what a refusal calls this file, never what it is
     * allowed to be: the file is held to the token's rule whichever name it is
     * given, and the rule is the whole of what follows.
     */
    readSecret: async (
      path,
      name = "the token file",
    ): Promise<FileRead | undefined> => {
      let handle;
      try {
        handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      } catch (error) {
        if (isMissing(error)) {
          return undefined;
        }
        if (isLink(error)) {
          throw new FileRefusal(
            `${path} is a symbolic link; ${name} must be a regular file`,
          );
        }
        throw named(path, error);
      }
      try {
        const info = await handle.stat();
        if (!info.isFile()) {
          throw new FileRefusal(`${path} is not a regular file`);
        }
        if (!ownedByThisUser(info.uid)) {
          throw new FileRefusal(
            `${path} belongs to uid ${info.uid}, not to you`,
          );
        }
        if (!isTightMode(info.mode)) {
          throw new FileRefusal(
            `${path} is mode ${modeText(info.mode)}; it must be 0600 or stricter`,
          );
        }
        return { text: await handle.readFile("utf8"), mode: info.mode };
      } finally {
        await handle.close();
      }
    },
    checkSecretDirectory: async (path) => {
      const existing = await lstatOrRefuse(path);
      if (existing === undefined) {
        return;
      }
      checkDirectory(path, existing);
    },
    exists: async (path) => {
      try {
        await stat(path);
        return true;
      } catch (error) {
        if (isMissing(error)) {
          return false;
        }
        throw named(path, error);
      }
    },
    /**
     * Writes the secret through a temporary file in the same directory and one
     * rename. A reader either sees the old file or the new one, never a half
     * written token, and the bytes on disk are 0600 from the moment they exist.
     * The temporary file goes away whatever happens, so a failure leaves no copy
     * of a token behind.
     */
    writeSecret: async (path, secret) => {
      await prepareDirectory(dirname(path));
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, secret, { mode: SECRET_MODE, flag: "wx" });
        await chmod(temporary, SECRET_MODE);
        await rename(temporary, path);
      } finally {
        await rm(temporary, { force: true });
      }
    },
  };
}

/** `getuid` is undefined on Windows, where there is no such thing to compare. */
function ownedByThisUser(uid: number): boolean {
  const me = process.getuid?.();
  return me === undefined || uid === me;
}

/**
 * The directory the tokens live in, once it is there. One this client created is
 * 0700; one that was already there is checked rather than adjusted, because
 * changing the mode of a directory the user pointed at would be a surprise and a
 * directory anyone else can reach is a reason to stop and say so.
 */
async function prepareDirectory(path: string): Promise<void> {
  const existing = await lstatOrRefuse(path);
  if (existing === undefined) {
    await mkdir(path, { recursive: true, mode: DIRECTORY_MODE });
    // mkdir is masked by the umask, so the mode asked for is not the mode got.
    await chmod(path, DIRECTORY_MODE);
    return;
  }
  checkDirectory(path, existing);
}

/** What a directory must already satisfy before a token goes anywhere near it. */
function checkDirectory(path: string, existing: Stats): void {
  if (existing.isSymbolicLink()) {
    throw new FileRefusal(
      `${path} is a symbolic link; point WAVES_CONFIG_DIR at the directory itself`,
    );
  }
  if (!existing.isDirectory()) {
    throw new FileRefusal(`${path} is not a directory`);
  }
  if (!ownedByThisUser(existing.uid)) {
    throw new FileRefusal(`${path} belongs to uid ${existing.uid}, not to you`);
  }
  const mode = existing.mode & 0o777;
  if ((mode & REACHABLE_BY_OTHERS) !== 0) {
    throw new FileRefusal(
      `${path} is mode ${modeText(mode)}; run chmod 700 ${path} so only you can reach the tokens in it`,
    );
  }
}

async function lstatOrRefuse(path: string): Promise<Stats | undefined> {
  try {
    return await lstat(path);
  } catch (error) {
    if (isMissing(error)) {
      return undefined;
    }
    throw named(path, error);
  }
}
