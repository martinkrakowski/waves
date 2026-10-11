import {
  createHash,
  createSign,
  generateKeyPairSync,
  type KeyObject,
} from "node:crypto";

import {
  answerChallengeText,
  type AnswerChallengeValues,
  type OwnerKey,
} from "@hexagen-monaco/waves-contract";

import {
  EXPECTED_ORIGIN,
  RELYING_PARTY_ID,
  type AssertionInput,
} from "../src/infrastructure/assertion-verifier.js";
import type { LoadedKey } from "../src/infrastructure/owner-keys-file.js";

/** Present and verified, nothing else: the bits the checks look at. */
export const USER_FLAGS = 0x05;

export const CHALLENGE_VALUES: AnswerChallengeValues = {
  project: "alpha",
  decision: "ship-it",
  textSha256: "0f".repeat(32),
  index: 3,
  verdict: "approved",
  nonce: "n".repeat(43),
};

export const CHALLENGE_TEXT = answerChallengeText(CHALLENGE_VALUES);

export interface Changes {
  /** The relying party the authenticator data names; the hash of it is checked. */
  readonly rpId?: string;
  /** The flags byte of the authenticator data. */
  readonly flags?: number;
  /** How many bytes of authenticator data to keep before signing. */
  readonly dataBytes?: number;
  /** Mark the credential the assertion is checked against as retired. */
  readonly retired?: boolean;
  /** Edit the client data object before it is serialised and signed. */
  readonly editClientData?: (data: Record<string, unknown>) => void;
  /** The exact client data bytes to sign and send, instead of the built JSON. */
  readonly clientDataBytes?: Buffer;
  /** Edit the signed authenticator data bytes after the signature is made. */
  readonly tamperData?: (bytes: Buffer) => void;
  /** Sign with another private key than the one the keys list holds. */
  readonly signingKey?: KeyObject;
  /** Distinct text the credential id is built from, so two built keys differ. */
  readonly credentialSeed?: string;
}

export interface Built {
  /** The keys `verifyAssertion` is given, holding the signer. */
  readonly keys: readonly LoadedKey[];
  /** The assertion input, good against `text` unless a change says otherwise. */
  readonly input: AssertionInput;
  /** The challenge text the input's challenge was built from. */
  readonly text: string;
}

function sha256(bytes: Buffer): Buffer {
  return createHash("sha256").update(bytes).digest();
}

/**
 * A good assertion, made the way a browser makes one: a P-256 key pair, an
 * authenticator data blob whose first 32 bytes are the relying-party hash,
 * a client data JSON with the challenge the answer route would build, and a
 * DER signature over them both. Each change moves exactly one thing, before
 * or after the signature as its check needs: the ones a signature must still
 * cover (relying party, flags, length, client data) are moved before it, and
 * `tamperData` moves a byte after, so the signature check is what fails.
 */
export function buildAssertion(changes: Changes = {}): Built {
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const credentialId = Buffer.from(
    changes.credentialSeed ?? "assertion-credential-1",
  ).toString("base64url");
  const ownerKey: OwnerKey = {
    credentialId,
    publicKeySpki: pair.publicKey
      .export({ format: "der", type: "spki" })
      .toString("base64"),
    label: "Test key",
    addedAt: "2026-10-01T00:00:00Z",
    ...(changes.retired === undefined ? {} : { retired: changes.retired }),
  };
  const keys: LoadedKey[] = [{ key: ownerKey, publicKey: pair.publicKey }];

  let authenticatorData = Buffer.concat([
    sha256(Buffer.from(changes.rpId ?? RELYING_PARTY_ID, "utf8")),
    Buffer.from([changes.flags ?? USER_FLAGS]),
    Buffer.from([0, 0, 0, 1]),
  ]);
  if (changes.dataBytes !== undefined) {
    authenticatorData = authenticatorData.subarray(0, changes.dataBytes);
  }

  const clientData: Record<string, unknown> = {
    type: "webauthn.get",
    origin: EXPECTED_ORIGIN,
    challenge: sha256(Buffer.from(CHALLENGE_TEXT, "utf8")).toString(
      "base64url",
    ),
    crossOrigin: false,
  };
  changes.editClientData?.(clientData);
  const clientDataJSON =
    changes.clientDataBytes ?? Buffer.from(JSON.stringify(clientData), "utf8");

  const signature = createSign("SHA256")
    .update(Buffer.concat([authenticatorData, sha256(clientDataJSON)]))
    .sign(changes.signingKey ?? pair.privateKey)
    .toString("base64url");

  changes.tamperData?.(authenticatorData);

  return {
    keys,
    text: CHALLENGE_TEXT,
    input: {
      credentialId,
      authenticatorData: authenticatorData.toString("base64url"),
      clientDataJSON: clientDataJSON.toString("base64url"),
      signature,
    },
  };
}
