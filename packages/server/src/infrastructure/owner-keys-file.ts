import { createPublicKey, type KeyObject } from "node:crypto";
import { readFile } from "node:fs/promises";

import { validateOwnerKeys } from "@hexagen-monaco/waves-contract";
import type { OwnerKey } from "@hexagen-monaco/waves-contract";

import { OWNER_KEYS_FILE_VARIABLE } from "../application/config.js";

/** One credential as the process can use it: the entry the contract accepted,
 * and the public half it names, parsed once here and never re-parsed. */
export interface LoadedKey {
  readonly key: OwnerKey;
  readonly publicKey: KeyObject;
}

/**
 * What a readable, valid owner-keys file loads to. The other case — the
 * variable absent, signed answers off — is not a value of this type: it is
 * `undefined` in `OwnerKeysSetting`, so a caller cannot mistake "off" for
 * "enabled with no keys".
 */
export type LoadedOwnerKeys = {
  readonly kind: "keys";
  readonly keys: readonly LoadedKey[];
};

/** The feature's whole setting: loaded keys, or `undefined` when it is off. */
export type OwnerKeysSetting = LoadedOwnerKeys | undefined;

function refusal(path: string, reason: string): Error {
  return new Error(`${OWNER_KEYS_FILE_VARIABLE} ${path} ${reason}`);
}

/**
 * Unlike the token files, a missing file here is a failure, not "off": the
 * operator named a file, so what it names must exist, be readable, be JSON the
 * contract accepts, and hold keys that parse as EC P-256 public halves. A
 * private key never reaches this file; the refusal messages keep it that way by
 * naming the variable, the path and the reason, and nothing the file holds.
 */
export async function readOwnerKeys(path: string): Promise<LoadedOwnerKeys> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    throw refusal(path, `cannot be read: ${(error as Error).message}`);
  }
  let document: unknown;
  try {
    document = JSON.parse(raw);
  } catch {
    throw refusal(path, "is not JSON");
  }
  const result = validateOwnerKeys(document);
  if (!result.ok) {
    throw refusal(
      path,
      `is refused: ${result.errors
        .map((issue) => `${issue.path} ${issue.message}`.trim())
        .join("; ")}`,
    );
  }
  const keys: LoadedKey[] = [];
  for (const key of result.value.keys) {
    keys.push(loadKey(path, key));
  }
  return { kind: "keys", keys };
}

function loadKey(path: string, key: OwnerKey): LoadedKey {
  let publicKey: KeyObject;
  try {
    publicKey = createPublicKey({
      key: Buffer.from(key.publicKeySpki, "base64"),
      format: "der",
      type: "spki",
    });
  } catch {
    throw refusal(path, `${key.credentialId} is not a public key`);
  }
  if (
    publicKey.asymmetricKeyType !== "ec" ||
    publicKey.asymmetricKeyDetails?.namedCurve !== "prime256v1"
  ) {
    throw refusal(path, `${key.credentialId} is not an EC P-256 public key`);
  }
  return { key, publicKey };
}

/**
 * Whether the feature is on is one decision, and it lives here so a test can
 * hold it: no variable means off and the answer is `undefined`; a variable
 * means the file it names must load, and any failure is thrown to the caller
 * as a refusal to start, never a quiet fall back to off.
 */
export async function readOwnerKeysIfConfigured(
  path: string | undefined,
): Promise<OwnerKeysSetting> {
  return path === undefined ? undefined : readOwnerKeys(path);
}
