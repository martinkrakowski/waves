import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";

import {
  FileRefusal,
  type OwnerPins,
  type PinRead,
} from "../application/ports.js";

/**
 * Where the owner's pinned public keys live, by the design's own hand (6.1):
 * a root-owned file no session can write. The path is a constant of this
 * adapter and is never read from an environment variable, a flag or a
 * record, so no session can point the reader at a file of its own.
 */
export const OWNER_KEYS_PATH = "/etc/waves/owner-keys.json";

const MISSING = "ENOENT";
const LOOP = "ELOOP";

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

/**
 * The pin file, opened without following a link and described by its own
 * descriptor: `fstat` says what was actually opened, never what the path
 * pointed at. A link is reported as one and never read, a file that is not a
 * regular file is reported as `other` and never read either, and what the
 * use case makes of the uid, the mode and the text is the use case's rule.
 */
export function ownerPinFile(path = OWNER_KEYS_PATH): OwnerPins {
  return {
    read: async (): Promise<PinRead> => {
      let handle;
      try {
        handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      } catch (error) {
        if (isMissing(error)) {
          return { kind: "missing" };
        }
        if (isLink(error)) {
          return await linkAt(path);
        }
        throw named(path, error);
      }
      try {
        const info = await handle.stat();
        if (!info.isFile()) {
          return {
            kind: "present",
            type: "other",
            uid: info.uid,
            mode: info.mode,
            text: undefined,
          };
        }
        return {
          kind: "present",
          type: "file",
          uid: info.uid,
          mode: info.mode,
          text: await handle.readFile("utf8"),
        };
      } finally {
        await handle.close();
      }
    },
  };
}

/**
 * The uid and the mode of a link the kernel refused to follow, read with
 * `lstat` about the link itself — the one `stat` call that never follows.
 */
async function linkAt(path: string): Promise<PinRead> {
  const info = await lstat(path);
  return {
    kind: "present",
    type: "symlink",
    uid: info.uid,
    mode: info.mode,
    text: undefined,
  };
}
