/**
 * PUBLIC keys only. A private key never reaches the server or this package: it
 * stays on the device that made it (design 6.1), so nothing here can read,
 * write or recover one, and nothing here is a secret.
 */

import { CREDENTIAL_ID_RULE } from "./notice-answer.js";
import { LABEL_RULE, readNoticeText } from "./notice.js";
import type { OwnerKey, OwnerKeys } from "./model.js";
import type { Collector, StringRule, ValidationResult } from "./validation.js";
import {
  IssueCollector,
  normalise,
  own,
  readBoolean,
  readClosedObject,
  readOptional,
  readText,
  readTimestamp,
} from "./validation.js";

export const OWNER_KEYS_SCHEMA = "waves-owner-keys/v1";

export const MAX_OWNER_KEYS = 8;

const OWNER_KEYS_KEYS = ["schema", "keys"];

const OWNER_KEY_KEYS = [
  "credentialId",
  "publicKeySpki",
  "label",
  "addedAt",
  "retired",
];

/** Standard base64, padding included: an SPKI DER blob as a browser's
 * `getPublicKey()` hands it over. `+` and `/` are in the alphabet here and `=`
 * ends it, which is the opposite of every byte string in an answer. A P-256
 * SPKI is 124 characters. */
export const PUBLIC_KEY_SPKI_RULE: StringRule = {
  minChars: 80,
  maxChars: 200,
  pattern: /^[A-Za-z0-9+/]+={0,2}$/,
};

function readOwnerKey(
  ctx: Collector,
  value: unknown,
  path: string,
  seen: Set<string>,
): OwnerKey | undefined {
  const record = readClosedObject(ctx, value, path, OWNER_KEY_KEYS);
  if (record === undefined) return undefined;
  const credentialId = readText(
    ctx,
    own(record, "credentialId"),
    `${path}/credentialId`,
    CREDENTIAL_ID_RULE,
  );
  const publicKeySpki = readText(
    ctx,
    own(record, "publicKeySpki"),
    `${path}/publicKeySpki`,
    PUBLIC_KEY_SPKI_RULE,
  );
  const label = readNoticeText(
    ctx,
    own(record, "label"),
    `${path}/label`,
    LABEL_RULE,
  );
  const addedAt = readTimestamp(ctx, own(record, "addedAt"), `${path}/addedAt`);
  const retired = readOptional(
    ctx,
    own(record, "retired"),
    `${path}/retired`,
    readBoolean,
  );
  if (
    credentialId === undefined ||
    publicKeySpki === undefined ||
    label === undefined ||
    addedAt === undefined
  ) {
    return undefined;
  }
  if (seen.has(credentialId)) {
    ctx.add(`${path}/credentialId`, "duplicate credential id");
    return undefined;
  }
  return { credentialId, publicKeySpki, label, addedAt, retired };
}

/** One to eight keys, each read once. Two keys with the same credential are a
 * refusal naming the second one: which credential answers is never a choice
 * between two entries. */
function readKeys(ctx: Collector, value: unknown, path: string): OwnerKey[] {
  if (!Array.isArray(value)) {
    ctx.add(path, "expected an array");
    return [];
  }
  if (value.length === 0) {
    ctx.add(path, `expected at least 1 key`);
    return [];
  }
  if (value.length > MAX_OWNER_KEYS) {
    ctx.add(path, `expected at most ${MAX_OWNER_KEYS} keys`);
    return [];
  }
  const keys: OwnerKey[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < value.length; i += 1) {
    const key = readOwnerKey(ctx, value[i], `${path}/${i}`, seen);
    if (key !== undefined) {
      keys.push(key);
      seen.add(key.credentialId);
    }
  }
  return keys;
}

function readOwnerKeys(ctx: Collector, input: unknown): OwnerKeys | undefined {
  const record = readClosedObject(ctx, input, "", OWNER_KEYS_KEYS);
  if (record === undefined) return undefined;

  if (own(record, "schema") !== OWNER_KEYS_SCHEMA) {
    ctx.add("/schema", `expected ${OWNER_KEYS_SCHEMA}`);
  }
  const keys = readKeys(ctx, own(record, "keys"), "/keys");

  if (ctx.issues.length > 0) return undefined;

  return { schema: OWNER_KEYS_SCHEMA, keys };
}

/**
 * The document the owner keeps a copy of by hand (design 6.1, W62): the
 * credentials the page will accept an assertion from. A closed object — an
 * unknown key is refused — and an empty list of keys is a refusal, never an
 * answer that accepts nothing.
 */
export function validateOwnerKeys(input: unknown): ValidationResult<OwnerKeys> {
  const normalised = normalise(input, "owner keys");
  if (!normalised.ok) {
    return { ok: false, errors: normalised.errors };
  }
  const ctx = new IssueCollector();
  const value = readOwnerKeys(ctx, normalised.value);
  if (value === undefined) {
    return { ok: false, errors: ctx.issues };
  }
  return { ok: true, value };
}
