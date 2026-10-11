import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { OWNER_KEYS_FILE_VARIABLE } from "../src/application/config.js";
import {
  readOwnerKeys,
  readOwnerKeysIfConfigured,
} from "../src/infrastructure/owner-keys-file.js";

const ADDED_AT = "2026-10-01T00:00:00Z";
const parents: string[] = [];

async function scratch(): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), "waves-owner-keys-"));
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

function spki(publicKey: KeyObject): string {
  return publicKey.export({ format: "der", type: "spki" }).toString("base64");
}

let nextId = 0;

/** A credential id inside the contract's rule: 16+ base64url characters. */
function credentialId(): string {
  nextId += 1;
  return Buffer.from(`credential-number-${nextId}`).toString("base64url");
}

interface Entry extends Record<string, unknown> {
  readonly credentialId: string;
  readonly publicKeySpki: string;
}

function entry(
  publicKey: KeyObject,
  overrides: Record<string, unknown> = {},
): Entry {
  return {
    credentialId: credentialId(),
    publicKeySpki: spki(publicKey),
    label: "YubiKey 5",
    addedAt: ADDED_AT,
    ...overrides,
  };
}

function document(keys: readonly unknown[]): string {
  return JSON.stringify({ schema: "waves-owner-keys/v1", keys });
}

async function refusalOf(
  keys: readonly unknown[] | string,
): Promise<{ message: string; written: string; path: string }> {
  const path = join(await scratch(), "owner-keys.json");
  const written =
    typeof keys === "string" ? keys : document(keys as readonly unknown[]);
  await writeFile(path, written, "utf8");
  let thrown: unknown;
  try {
    await readOwnerKeys(path);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(Error);
  return { message: (thrown as Error).message, written, path };
}

function p256(): { publicKey: KeyObject } {
  return generateKeyPairSync("ec", { namedCurve: "prime256v1" });
}

describe("readOwnerKeys", () => {
  it("loads the keys, parsing each public half once", async () => {
    const first = entry(p256().publicKey);
    const second = entry(p256().publicKey, { retired: true });
    const path = join(await scratch(), "owner-keys.json");
    await writeFile(path, document([first, second]), "utf8");

    const loaded = await readOwnerKeys(path);

    expect(loaded.kind).toBe("keys");
    const [firstLoaded, secondLoaded] = loaded.keys;
    expect(firstLoaded!.key.credentialId).toBe(first.credentialId);
    expect(secondLoaded!.key.credentialId).toBe(second.credentialId);
    expect(firstLoaded!.key.retired).toBeUndefined();
    expect(secondLoaded!.key.retired).toBe(true);
    expect(spki(firstLoaded!.publicKey)).toBe(first.publicKeySpki);
    expect(spki(secondLoaded!.publicKey)).toBe(second.publicKeySpki);
  });

  it("refuses a file that does not exist, unlike a token file", async () => {
    const path = join(await scratch(), "absent.json");

    let thrown: unknown;
    try {
      await readOwnerKeys(path);
    } catch (error) {
      thrown = error;
    }
    const message = (thrown as Error).message;
    expect(message).toContain(OWNER_KEYS_FILE_VARIABLE);
    expect(message).toContain(path);
    expect(message).toMatch(/cannot be read/);
  });

  it("refuses a file it cannot read for any other reason", async () => {
    const path = join(await scratch(), "directory");
    await mkdir(path);

    let thrown: unknown;
    try {
      await readOwnerKeys(path);
    } catch (error) {
      thrown = error;
    }
    const message = (thrown as Error).message;
    expect(message).toContain(OWNER_KEYS_FILE_VARIABLE);
    expect(message).toContain(path);
    expect(message).toMatch(/cannot be read/);
  });

  it("refuses a file that is not JSON, without quoting its text", async () => {
    const { message, written, path } = await refusalOf("certainly not json");

    expect(message).toContain(OWNER_KEYS_FILE_VARIABLE);
    expect(message).toContain(path);
    expect(message).toMatch(/is not JSON/);
    expect(message).not.toContain("certainly");
    expect(message).not.toContain(written);
  });

  it("refuses a document the contract refuses, by the validator's paths", async () => {
    const key = entry(p256().publicKey);
    const { message, written, path } = await refusalOf([key, key]);

    expect(message).toContain(OWNER_KEYS_FILE_VARIABLE);
    expect(message).toContain(path);
    expect(message).toContain("/keys/1/credentialId duplicate credential id");
    expect(message).not.toContain(key.publicKeySpki);
    expect(message).not.toContain(written);
  });

  it("refuses a key that is not a public key at all, naming its credential", async () => {
    const good = entry(p256().publicKey);
    const bad = entry(p256().publicKey, {
      publicKeySpki: "A".repeat(124),
    });
    const { message, written, path } = await refusalOf([good, bad]);

    expect(message).toContain(OWNER_KEYS_FILE_VARIABLE);
    expect(message).toContain(path);
    expect(message).toContain(bad.credentialId);
    expect(message).toMatch(/is not a public key/);
    expect(message).not.toContain(bad.publicKeySpki);
    expect(message).not.toContain(written);
  });

  it("refuses a P-384 key", async () => {
    const wide = generateKeyPairSync("ec", { namedCurve: "secp384r1" });
    const key = entry(wide.publicKey);
    const { message, written, path } = await refusalOf([key]);

    expect(message).toContain(OWNER_KEYS_FILE_VARIABLE);
    expect(message).toContain(path);
    expect(message).toContain(key.credentialId);
    expect(message).toMatch(/is not an EC P-256 public key/);
    expect(message).not.toContain(key.publicKeySpki);
    expect(message).not.toContain(written);
  });

  it("refuses an RSA key", async () => {
    const pair = generateKeyPairSync("rsa", { modulusLength: 512 });
    const key = entry(pair.publicKey);
    const { message, written, path } = await refusalOf([key]);

    expect(message).toContain(OWNER_KEYS_FILE_VARIABLE);
    expect(message).toContain(path);
    expect(message).toContain(key.credentialId);
    expect(message).toMatch(/is not an EC P-256 public key/);
    expect(message).not.toContain(key.publicKeySpki);
    expect(message).not.toContain(written);
  });
});

describe("readOwnerKeysIfConfigured", () => {
  it("is off — undefined — when the variable is absent", async () => {
    await expect(readOwnerKeysIfConfigured(undefined)).resolves.toBeUndefined();
  });

  it("reads the file the variable names", async () => {
    const key = entry(p256().publicKey);
    const path = join(await scratch(), "owner-keys.json");
    await writeFile(path, document([key]), "utf8");

    const loaded = await readOwnerKeysIfConfigured(path);

    expect(loaded?.keys[0]?.key.credentialId).toBe(key.credentialId);
  });
});
