import { createHash, verify } from "node:crypto";

import type { OwnerKey } from "@hexagen-monaco/waves-contract";

import type { LoadedKey } from "./owner-keys-file.js";
import { digestsEqual } from "./digest.js";

/** Where the owner's browser was when it signed. The page is served here and
 * nowhere else, so an assertion from any other origin — a packed copy, a
 * proxy's spelling of the same host, another port — is not the owner's. */
export const EXPECTED_ORIGIN = "https://waves.midnight.lan";

/** The WebAuthn relying party the credentials were made for. Origin and relying
 * party are what the deployment is, not what the operator configured: no
 * setting can move them. */
export const RELYING_PARTY_ID = "waves.midnight.lan";

/** Every way an assertion can be refused, one code per check, in the order the
 * checks run: the first code here is the first thing looked at. A test holds
 * this list to the union it is, so a reason cannot appear that no check
 * produces and none can quietly disappear. */
export const REFUSAL_REASONS = [
  "unknown-credential",
  "retired-key",
  "malformed-encoding",
  "client-data-malformed",
  "wrong-type",
  "wrong-origin",
  "wrong-challenge",
  "cross-origin",
  "authenticator-data-short",
  "wrong-rp-id-hash",
  "user-not-present",
  "user-not-verified",
  "bad-signature",
] as const;

export type RefusalReason = (typeof REFUSAL_REASONS)[number];

export type VerifyResult =
  | { readonly ok: true; readonly key: OwnerKey }
  | { readonly ok: false; readonly reason: RefusalReason };

/** The four strings of an assertion, exactly as the request carried them. */
export interface AssertionInput {
  readonly credentialId: string;
  readonly authenticatorData: string;
  readonly clientDataJSON: string;
  readonly signature: string;
}

/** The one exception `verifyAssertion` throws nowhere: each check that fails
 * throws this internally, and anything else that throws — `verify` on bytes
 * that are not DER at all — reads as `bad-signature`. */
class Refusal extends Error {
  constructor(readonly reason: RefusalReason) {
    super(reason);
  }
}

/** Hashes and challenge spellings are compared in time that does not depend on
 * where the first difference is, and only after the lengths are known equal,
 * because `timingSafeEqual` throws on a prefix instead of comparing it. */
function sameDigest(given: Uint8Array, expected: Uint8Array): boolean {
  return given.length === expected.length && digestsEqual(given, expected);
}

/** Decodes base64url that is in its one spelling and nothing else: no padding,
 * no `+` or `/`, no characters outside the alphabet, and no non-zero bits in
 * the last character that no byte uses. `Buffer.from(…, "base64url")` repairs
 * all of those, so the round trip decides. */
function decodeStrict(text: string): Buffer {
  const decoded = Buffer.from(text, "base64url");
  if (decoded.toString("base64url") !== text) {
    throw new Refusal("malformed-encoding");
  }
  return decoded;
}

/**
 * Whether the owner's assertion is good, checked in the one order the codes of
 * `REFUSAL_REASONS` name. Nothing here reaches for a use case that does not
 * exist yet: no route calls this, and the answer is only ever a value.
 */
export function verifyAssertion(
  input: AssertionInput,
  expectedChallengeText: string,
  keys: readonly LoadedKey[],
): VerifyResult {
  try {
    return {
      ok: true,
      key: checkedAssertion(input, expectedChallengeText, keys),
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Refusal ? error.reason : "bad-signature",
    };
  }
}

function checkedAssertion(
  input: AssertionInput,
  expectedChallengeText: string,
  keys: readonly LoadedKey[],
): OwnerKey {
  const loaded = keys.find(
    (key) => key.key.credentialId === input.credentialId,
  );
  if (loaded === undefined) {
    throw new Refusal("unknown-credential");
  }
  if (loaded.key.retired === true) {
    throw new Refusal("retired-key");
  }
  const clientDataBytes = decodeStrict(input.clientDataJSON);
  let clientData: unknown;
  try {
    clientData = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(clientDataBytes),
    );
  } catch {
    throw new Refusal("client-data-malformed");
  }
  if (
    typeof clientData !== "object" ||
    clientData === null ||
    Array.isArray(clientData)
  ) {
    throw new Refusal("client-data-malformed");
  }
  const fields = clientData as Record<string, unknown>;
  if (fields.type !== "webauthn.get") {
    throw new Refusal("wrong-type");
  }
  if (fields.origin !== EXPECTED_ORIGIN) {
    throw new Refusal("wrong-origin");
  }
  const expectedChallenge = createHash("sha256")
    .update(expectedChallengeText, "utf8")
    .digest()
    .toString("base64url");
  const givenChallenge =
    typeof fields.challenge === "string"
      ? Buffer.from(fields.challenge, "utf8")
      : undefined;
  if (
    givenChallenge === undefined ||
    !sameDigest(givenChallenge, Buffer.from(expectedChallenge, "utf8"))
  ) {
    throw new Refusal("wrong-challenge");
  }
  if (fields.crossOrigin === true) {
    throw new Refusal("cross-origin");
  }
  const authenticatorData = decodeStrict(input.authenticatorData);
  if (authenticatorData.length < 37) {
    throw new Refusal("authenticator-data-short");
  }
  const rpIdHash = createHash("sha256").update(RELYING_PARTY_ID).digest();
  if (!sameDigest(authenticatorData.subarray(0, 32), rpIdHash)) {
    throw new Refusal("wrong-rp-id-hash");
  }
  const flags = authenticatorData[32]!;
  if ((flags & 0x01) === 0) {
    throw new Refusal("user-not-present");
  }
  if ((flags & 0x04) === 0) {
    throw new Refusal("user-not-verified");
  }
  const signatureBytes = decodeStrict(input.signature);
  const signed = Buffer.concat([
    authenticatorData,
    createHash("sha256").update(clientDataBytes).digest(),
  ]);
  if (!verify("sha256", signed, loaded.publicKey, signatureBytes)) {
    throw new Refusal("bad-signature");
  }
  return loaded.key;
}
