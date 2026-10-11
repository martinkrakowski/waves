import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";

import {
  PinRefusal,
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

/**
 * The one kernel call the pin reader makes, as a type so a test can stand in
 * for it: open the path under these flags and answer the descriptor.
 */
export type OpenPinFile = (path: string, flags: number) => Promise<FileHandle>;

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === MISSING;
}

/** `O_NOFOLLOW` says this with ELOOP: the path is a link and was not followed. */
function isLink(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === LOOP;
}

/** The sentence for anything but a missing file and a link, naming the code. */
function refused(error: unknown): PinRefusal {
  const code = String((error as NodeJS.ErrnoException).code);
  return new PinRefusal(`the pin file could not be read: ${code}`);
}

/**
 * The pin file, opened without following a link and without waiting on
 * anything — `O_NONBLOCK` is what makes a FIFO with no writer open at once,
 * and a FIFO is then refused as the not-regular-file it is. `fstat` says what
 * was actually opened, never what the path pointed at. A link is reported as
 * one and never read, a file that is not a regular file is reported as
 * `other` and never read either, and what the use case makes of the uid, the
 * mode and the text is the use case's rule. Any other refusal of the kernel's
 * — opening, describing or reading — is a pin refusal naming its code.
 */
export function ownerPinFile(
  path = OWNER_KEYS_PATH,
  openFile: OpenPinFile = open,
): OwnerPins {
  return {
    read: async (): Promise<PinRead> => {
      let handle;
      try {
        handle = await openFile(
          path,
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        );
      } catch (error) {
        if (isMissing(error)) {
          return { kind: "missing" };
        }
        if (isLink(error)) {
          return await linkAt(path);
        }
        throw refused(error);
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
      } catch (error) {
        throw refused(error);
      } finally {
        await handle.close();
      }
    },
  };
}

/**
 * The uid and the mode of a link the kernel refused to follow, read with
 * `lstat` about the link itself — the one `stat` call that never follows.
 * A link that cannot even be described is a refusal like any other.
 */
async function linkAt(path: string): Promise<PinRead> {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    throw refused(error);
  }
  return {
    kind: "present",
    type: "symlink",
    uid: info.uid,
    mode: info.mode,
    text: undefined,
  };
}
