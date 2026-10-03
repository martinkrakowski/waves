import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  readAdminToken,
  readEnrollToken,
  sameToken,
} from "../src/infrastructure/admin-token.js";

const VALID = "admin-token-0123456789abcdefghijklmnop";
const OTHER = "enroll-token-0123456789abcdefghijklmnop";
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

describe("readEnrollToken", () => {
  it("reads a token with the same rule as the admin one", async () => {
    const path = join(await scratch(), "token");
    await writeFile(path, `${OTHER}\n`, "utf8");

    await expect(readEnrollToken(path)).resolves.toEqual({
      kind: "enabled",
      token: OTHER,
    });
  });

  it("treats a missing file as no enrollment token at all", async () => {
    const path = join(await scratch(), "absent");

    await expect(readEnrollToken(path)).resolves.toEqual({ kind: "absent" });
  });

  it("names its own variable, never the admin one, when it refuses", async () => {
    const unreadable = join(await scratch(), "directory");
    await mkdir(unreadable);
    const malformed = join(await scratch(), "token");
    await writeFile(malformed, "too short", "utf8");

    await expect(readEnrollToken(unreadable)).rejects.toThrow(
      /WAVES_ENROLL_TOKEN_FILE .* cannot be read/,
    );
    await expect(readEnrollToken(malformed)).rejects.toThrow(
      /WAVES_ENROLL_TOKEN_FILE must hold/,
    );
    for (const attempt of [
      readEnrollToken(unreadable).catch((error: Error) => error.message),
      readEnrollToken(malformed).catch((error: Error) => error.message),
    ]) {
      expect(await attempt).not.toContain("WAVES_ADMIN_TOKEN_FILE");
    }
  });
});

describe("sameToken", () => {
  it("is true for one value", () => {
    expect(sameToken(VALID, VALID)).toBe(true);
  });

  it("is false for two values of the same length", () => {
    expect(sameToken(VALID, OTHER)).toBe(false);
    expect(sameToken(VALID, `${VALID.slice(0, -1)}q`)).toBe(false);
  });

  it("is false for two values of different lengths", () => {
    // Nothing is compared as a string, so a length difference is not a shortcut
    // out of the comparison: the digests are the same width whatever they hold.
    expect(sameToken(VALID, OTHER.slice(0, 20))).toBe(false);
    expect(sameToken(VALID, `${VALID}-and-more`)).toBe(false);
  });

  it("sees the two files as one value when they hold the same token", async () => {
    // What `main.ts` compares is what the readers returned, so the newline a
    // mounted Secret file ends with is trimmed first: the two files are the same
    // secret even though their bytes differ, and that is the case the startup
    // refusal exists for.
    const parent = await scratch();
    const admin = join(parent, "admin");
    const enroll = join(parent, "enroll");
    await writeFile(admin, `${VALID}\n`, "utf8");
    await writeFile(enroll, `  ${VALID}  \n`, "utf8");

    const first = await readAdminToken(admin);
    const second = await readEnrollToken(enroll);

    if (first.kind !== "enabled" || second.kind !== "enabled") {
      throw new Error("expected both tokens to be read");
    }
    expect(second.token).toBe(VALID);
    expect(sameToken(first.token, second.token)).toBe(true);
  });

  it("never answers by throwing, whatever it is handed", () => {
    for (const [a, b] of [
      ["", ""],
      ["", VALID],
      ["a", "a"],
    ]) {
      expect(() => sameToken(String(a), String(b))).not.toThrow();
    }
    expect(sameToken("", "")).toBe(true);
  });
});
