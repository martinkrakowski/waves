import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readAdminToken } from "../src/infrastructure/admin-token.js";

const VALID = "admin-token-0123456789abcdefghijklmnop";
const parents: string[] = [];

async function scratch(): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), "waves-admin-"));
  parents.push(parent);
  return parent;
}

afterEach(async () => {
  await Promise.all(
    parents
      .splice(0)
      .map((parent) => rm(parent, { recursive: true, force: true })),
  );
});

describe("readAdminToken", () => {
  it("reads a token, trimmed of the newline a file usually ends with", async () => {
    const path = join(await scratch(), "token");
    await writeFile(path, `${VALID}\n`, "utf8");

    await expect(readAdminToken(path)).resolves.toEqual({
      kind: "enabled",
      token: VALID,
    });
  });

  it("treats a missing file as no admin token at all", async () => {
    const path = join(await scratch(), "absent");

    await expect(readAdminToken(path)).resolves.toEqual({ kind: "absent" });
  });

  it("refuses to start on a file it cannot read for any other reason", async () => {
    const path = join(await scratch(), "directory");
    await mkdir(path);

    await expect(readAdminToken(path)).rejects.toThrow(
      /WAVES_ADMIN_TOKEN_FILE .* cannot be read/,
    );
  });

  it.each([
    "",
    "   \n",
    "short",
    `${"a".repeat(129)}`,
    "has spaces in it here",
  ])("refuses the token %j", async (contents) => {
    const path = join(await scratch(), "token");
    await writeFile(path, contents, "utf8");

    await expect(readAdminToken(path)).rejects.toThrow(
      /WAVES_ADMIN_TOKEN_FILE must hold/,
    );
  });

  it("never puts the token in the message it fails with", async () => {
    const path = join(await scratch(), "token");
    await writeFile(path, `${VALID}\n`, "utf8");

    const loaded = await readAdminToken(path);

    expect(JSON.stringify(loaded)).not.toContain('token\\":');
    expect(loaded.kind === "enabled" && loaded.token).toBe(VALID);
  });
});
