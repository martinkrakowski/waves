import {
  answerChallengeText,
  validateStoredStateEntry,
  type AnswerSignature,
  type AnswerVerdict,
  type OwnerKey,
  type StoredStateEntry,
  type ValidationIssue,
} from "@hexagen-monaco/waves-contract";

import { isRecord, own } from "./object.js";

/** The relying party the owner's credential was made for (design 6.1). */
export const RP_ID = "waves.midnight.lan";
/** The origin the assertion must name exactly, https and no port. */
export const ORIGIN = `https://${RP_ID}`;

/** The minimum an authenticatorData holds: 32 bytes of rpIdHash, the flags
 * byte and a 4-byte counter. Anything shorter cannot say whose party it was. */
const AUTHENTICATOR_DATA_MIN = 37;
/** Where the flags byte sits: after the rpIdHash. */
const FLAGS_AT = 32;
/** User present and user verified, the two bits the ceremony requires. */
const USER_PRESENT = 0x01;
const USER_VERIFIED = 0x04;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * The two cryptographic answers the checks need, as plain functions so this
 * module stays pure: a digest and one ES256 verdict. The application hands its
 * Crypto port over, and nothing here knows an adapter exists.
 */
export interface AnswerCrypto {
  readonly sha256: (data: Uint8Array) => Uint8Array;
  readonly verifyEs256: (
    spki: Uint8Array,
    message: Uint8Array,
    derSignature: Uint8Array,
  ) => "ok" | "bad-signature" | "not-p256";
}

/** The UTF-8 bytes of a text: what every hash here is taken over. */
export function utf8Bytes(text: string): Uint8Array {
  return encoder.encode(text);
}

/** Lower-case hex, the spelling `textSha256` is stored and printed in. */
export function toHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Standard base64, padding included, as a browser's `getPublicKey()` hands a
 * SPKI over — the alphabet of the pin file, and nothing an assertion uses.
 */
export function decodeBase64(text: string): Uint8Array | undefined {
  return decode(text);
}

/** Base64url without padding, the alphabet of everything in an assertion. */
export function decodeBase64Url(text: string): Uint8Array | undefined {
  // `+`, `/` and `=` are the standard alphabet's, and a string that carries
  // them is not the base64url an assertion is written in.
  if (!/^[A-Za-z0-9_-]*$/.test(text)) {
    return undefined;
  }
  return decode(text.replace(/-/g, "+").replace(/_/g, "/"));
}

function decode(text: string): Uint8Array | undefined {
  try {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return undefined;
  }
}

/** Base64url with no padding: the spelling of a challenge in clientDataJSON. */
export function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** The one sentence of a validator's refusal: every issue, each naming its path. */
export function issuesSentence(issues: readonly ValidationIssue[]): string {
  return issues
    .map((issue) =>
      issue.path === "" ? issue.message : `${issue.message} at ${issue.path}`,
    )
    .join("; ");
}

/**
 * The signed answer of the current text: the last `signed` entry pinned to the
 * current revision, chosen and then held to the three checks the reader makes
 * on the entry itself — its stored hash must be the one just recomputed from
 * the text, it must be a stored state entry the contract accepts once the
 * record's own `index` and `receivedAt` are stripped, and both the entry's own
 * `index` and the `index` its signature binds must be the position it actually
 * occupies in the record (W63: a copy appended at another position is not an
 * answer, T3).
 *
 * `none` is not a failure: it says no signed answer is on the current text, and
 * the use case answers it with its own exit code.
 */
export type SignedAnswerChoice =
  | {
      readonly ok: true;
      readonly entry: StoredStateEntry;
      readonly signature: AnswerSignature;
      readonly verdict: AnswerVerdict;
      readonly position: number;
    }
  | { readonly ok: false; readonly none: true }
  | { readonly ok: false; readonly reason: string };

export function chooseSignedAnswer(
  entries: readonly unknown[],
  revision: number,
  textSha256: string,
): SignedAnswerChoice {
  let found: Record<string, unknown> | undefined;
  let position = 0;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (
      isRecord(entry) &&
      entry.source === "signed" &&
      entry.revision === revision
    ) {
      found = entry;
      position = index;
    }
  }
  if (found === undefined) {
    return { ok: false, none: true };
  }
  if (own(found, "textSha256") !== textSha256) {
    return {
      ok: false,
      reason:
        "the signed entry's stored textSha256 does not match the current text",
    };
  }
  const stripped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(found)) {
    if (key !== "index" && key !== "receivedAt") {
      stripped[key] = value;
    }
  }
  const validated = validateStoredStateEntry(stripped);
  if (!validated.ok) {
    return {
      ok: false,
      reason: `the signed entry is not a valid stored state entry: ${issuesSentence(validated.errors)}`,
    };
  }
  // A `signed` entry the contract accepted is an answer state carrying a
  // signature; both casts are facts the validator has just established.
  const entry = validated.value;
  const signature = entry.signature as AnswerSignature;
  const verdict = entry.state as AnswerVerdict;
  if (own(found, "index") !== position) {
    return {
      ok: false,
      reason: `the signed entry records index ${String(own(found, "index"))} but is stored at position ${position}`,
    };
  }
  if (signature.index !== position) {
    return {
      ok: false,
      reason: `the signed entry's signature binds index ${signature.index} but it is stored at position ${position}`,
    };
  }
  return { ok: true, entry, signature, verdict, position };
}

/** One signed answer and the one pinned key that claims it, ready to be checked. */
export interface AssertionCheck {
  readonly project: string;
  readonly decision: string;
  /** The hash recomputed from the current revision's own text, never the stored one. */
  readonly textSha256: string;
  readonly entry: StoredStateEntry;
  readonly signature: AnswerSignature;
  readonly verdict: AnswerVerdict;
  readonly key: OwnerKey;
}

export type AssertionResult =
  { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * Everything a reader checks on the assertion itself (W63): the challenge is
 * rebuilt from what is being answered — the project, the decision, the
 * recomputed hash, the position, the verdict, the owner's words, the nonce —
 * and the assertion must say the same thing. `clientDataJSON` must name
 * `webauthn.get`, the origin and the challenge exactly; `authenticatorData`
 * must be long enough to have flags, must hash the relying party and must say
 * the user was present and verified; and the ES256 signature must verify
 * against the pinned key's SPKI. Each refusal is its own sentence.
 */
export function checkAssertion(
  crypto: AnswerCrypto,
  check: AssertionCheck,
): AssertionResult {
  const { signature } = check;
  const challengeText = answerChallengeText({
    project: check.project,
    decision: check.decision,
    textSha256: check.textSha256,
    index: signature.index,
    verdict: check.verdict,
    option: check.entry.option,
    words: check.entry.words,
    nonce: signature.nonce,
  });
  const challenge = encodeBase64Url(crypto.sha256(utf8Bytes(challengeText)));

  const clientDataBytes = decodeBase64Url(signature.clientDataJSON);
  if (clientDataBytes === undefined) {
    return {
      ok: false,
      reason: "the assertion's clientDataJSON is not valid base64url",
    };
  }
  const clientData = parseJson(decoder.decode(clientDataBytes));
  if (clientData === undefined) {
    return {
      ok: false,
      reason: "the assertion's clientDataJSON is not a JSON object",
    };
  }
  if (own(clientData, "type") !== "webauthn.get") {
    return {
      ok: false,
      reason: `the assertion's type is ${String(own(clientData, "type"))}, not webauthn.get`,
    };
  }
  if (own(clientData, "origin") !== ORIGIN) {
    return {
      ok: false,
      reason: `the assertion's origin is ${String(own(clientData, "origin"))}, not ${ORIGIN}`,
    };
  }
  if (own(clientData, "challenge") !== challenge) {
    return {
      ok: false,
      reason:
        "the assertion's challenge does not match the challenge of this answer",
    };
  }

  const authenticatorData = decodeBase64Url(signature.authenticatorData);
  if (authenticatorData === undefined) {
    return {
      ok: false,
      reason: "the assertion's authenticatorData is not valid base64url",
    };
  }
  if (authenticatorData.length < AUTHENTICATOR_DATA_MIN) {
    return {
      ok: false,
      reason:
        "the assertion's authenticatorData is too short to hold its flags",
    };
  }
  const rpIdHash = crypto.sha256(utf8Bytes(RP_ID));
  if (!startsWith(authenticatorData, rpIdHash)) {
    return {
      ok: false,
      reason: `the assertion's rpIdHash is not the hash of ${RP_ID}`,
    };
  }
  // The length gate above has already said there is a byte at `FLAGS_AT`.
  const flags = authenticatorData[FLAGS_AT]!;
  if ((flags & USER_PRESENT) === 0 || (flags & USER_VERIFIED) === 0) {
    return {
      ok: false,
      reason:
        "the assertion's flags do not record the user as present and verified",
    };
  }

  const spki = decodeBase64(check.key.publicKeySpki);
  if (spki === undefined) {
    return {
      ok: false,
      reason: "the pinned key's publicKeySpki is not valid base64",
    };
  }
  const derSignature = decodeBase64Url(signature.signature);
  if (derSignature === undefined) {
    return {
      ok: false,
      reason: "the assertion's signature is not valid base64url",
    };
  }
  const message = concat(authenticatorData, crypto.sha256(clientDataBytes));
  const verdict = crypto.verifyEs256(spki, message, derSignature);
  if (verdict === "not-p256") {
    return {
      ok: false,
      reason: "the pinned key for this credential is not a P-256 key",
    };
  }
  if (verdict === "bad-signature") {
    return {
      ok: false,
      reason: "the signature did not verify against the pinned key",
    };
  }
  return { ok: true };
}

function parseJson(text: string): Record<string, unknown> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  return isRecord(parsed) ? parsed : undefined;
}

function startsWith(bytes: Uint8Array, prefix: Uint8Array): boolean {
  for (let index = 0; index < prefix.length; index += 1) {
    // A read past the end answers `undefined`, which no byte equals, so a
    // shorter `bytes` is already refused by the first differing position.
    if (bytes[index] !== prefix[index]) {
      return false;
    }
  }
  return true;
}

function concat(head: Uint8Array, tail: Uint8Array): Uint8Array {
  const joined = new Uint8Array(head.length + tail.length);
  joined.set(head, 0);
  joined.set(tail, head.length);
  return joined;
}
