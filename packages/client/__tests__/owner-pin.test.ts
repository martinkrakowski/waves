import { chmod, mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FileRefusal } from "../src/application/ports.js";
import {
  OWNER_KEYS_PATH,
  ownerPinFile,
} from "../src/infrastructure/owner-pin.js";
import { temporaryDirectory } from "./support/harness.js";

const TEXT = JSON.stringify({
  schema: "waves-owner-keys/v1",
  keys: [],
});

const cleanups: (() => Promise<void>)[] = [];

async function scratch(): Promise<string> {
  const dir = await temporaryDirectory();
  cleanups.push(dir.remove);
  return dir.path;
}

async function writePin(dir: string, name: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, TEXT, { mode: 0o644 });
  return path;
}

/** A path Node refuses before the kernel ever sees it, so the open cannot succeed. */
function refusedName(dir: string): string {
  return `${join(dir, "owner-keys.json")}\0`;
}

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((remove) => remove()));
});

describe("ownerPinFile", () => {
  it("pins the path the design names, not one a session could choose", () => {
    expect(OWNER_KEYS_PATH).toBe("/etc/waves/owner-keys.json");
  });

  it("reads a regular file with its uid, its mode and its text", async () => {
    const dir = await scratch();
    const path = await writePin(dir, "owner-keys.json");
    await chmod(path, 0o644);

    expect(await ownerPinFile(path).read()).toEqual({
      kind: "present",
      type: "file",
      uid: process.getuid?.() ?? 0,
      mode: 0o100644,
      text: TEXT,
    });
  });

  it("sees the mode the file has now, not the one it was made with", async () => {
    const dir = await scratch();
    const path = await writePin(dir, "owner-keys.json");
    await chmod(path, 0o640);

    const read = await ownerPinFile(path).read();
    expect(read).toMatchObject({
      kind: "present",
      type: "file",
      mode: 0o100640,
    });
  });

  it("says a file that is not there is missing", async () => {
    const dir = await scratch();
    expect(await ownerPinFile(join(dir, "owner-keys.json")).read()).toEqual({
      kind: "missing",
    });
  });

  it("reports a link as one, and reads nothing it points at", async () => {
    const dir = await scratch();
    const target = await writePin(dir, "real.json");
    const link = join(dir, "owner-keys.json");
    await symlink(target, link);

    const read = await ownerPinFile(link).read();
    expect(read).toMatchObject({ kind: "present", type: "symlink" });
    expect(read).toHaveProperty("text", undefined);
    expect(read).toHaveProperty("uid", process.getuid?.() ?? 0);
  });

  it("reports a link whose target does not exist as a link still", async () => {
    const dir = await scratch();
    const link = join(dir, "owner-keys.json");
    await symlink(join(dir, "nothing.json"), link);

    expect(await ownerPinFile(link).read()).toMatchObject({
      kind: "present",
      type: "symlink",
    });
  });

  it("reports a directory as other, and reads none of it", async () => {
    const dir = await scratch();
    const inner = join(dir, "a-directory");
    await mkdir(inner);

    const read = await ownerPinFile(inner).read();
    expect(read).toMatchObject({ kind: "present", type: "other" });
    expect(read).toHaveProperty("text", undefined);
  });

  it("refuses with the code it was refused with when the path cannot be opened", async () => {
    const dir = await scratch();
    const pin = ownerPinFile(refusedName(dir));
    await expect(pin.read()).rejects.toThrow(FileRefusal);
    await expect(pin.read()).rejects.toThrow(/ERR_INVALID_ARG_VALUE/);
  });
});

describe("the pin the real client reads", () => {
  it("is the design's path, so a run of `read --signed` opens it", async () => {
    // The default factory reads the constant's path; on this host that file
    // does not exist, so the honest answer is `missing`, not a throw.
    await expect(ownerPinFile().read()).resolves.toEqual({ kind: "missing" });
  });
});
