import {
  createHash,
  createSign,
  generateKeyPairSync,
  randomBytes,
  type KeyObject,
} from "node:crypto";

import {
  answerChallengeText,
  decisionBindingText,
  NOTICE_SCHEMA,
  type AnswerChallengeValues,
} from "@hexagen-monaco/waves-contract";

/**
 * The machinery of a real signed answer, made in the test and never committed:
 * a P-256 key pair, the challenge text the owner's device signed, a real
 * clientDataJSON and authenticatorData, and a real ES256 signature over them.
 * Every key, nonce and signature is made here, at run time.
 */
export const RP_ID = "waves.midnight.lan";
export const ORIGIN = `https://${RP_ID}`;
export const USER_FLAGS = 0x01 | 0x04;
export const PIN_PATH = "/etc/waves/owner-keys.json";

export interface AnswerKey {
  readonly credentialId: string;
  readonly publicKeySpki: string;
  readonly privateKey: KeyObject;
}

export function answerKey(): AnswerKey {
  const { publicKey, privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  return {
    credentialId: randomBytes(32).toString("base64url"),
    publicKeySpki: publicKey
      .export({ type: "spki", format: "der" })
      .toString("base64"),
    privateKey,
  };
}

/** A decision revision the contract accepts, minimal but real. */
export function decisionDocument(): Record<string, unknown> {
  return {
    schema: NOTICE_SCHEMA,
    kind: "decision",
    project: "waves-demo",
    id: "d1",
    shape: "choice",
    question: "What should we do?",
    options: [
      { key: "a", text: "Do A", cost: "1h" },
      { key: "b", text: "Do B", cost: "2h" },
    ],
    hardToUndo: { value: false },
    commits: [],
    decider: "owner",
    appliesTo: [],
    evidence: [],
    raisedBy: "the session",
    raisedAt: "2026-10-08T12:00:00Z",
  };
}

/** The hash the reader must recompute: SHA-256 of the binding text, as hex. */
export function bindingHashOf(decision: Record<string, unknown>): string {
  return createHash("sha256")
    .update(decisionBindingText(decision as never), "utf8")
    .digest("hex");
}

export interface SignedEntryInput {
  readonly key: AnswerKey;
  readonly decision?: Record<string, unknown>;
  readonly project?: string;
  readonly id?: string;
  readonly revision?: number;
  /** The position the entry is stored at, and the index its challenge binds. */
  readonly position?: number;
  readonly verdict?: "approved" | "declined" | "answered";
  readonly option?: string;
  readonly words?: string;
  /** What the owner's device really signed, when the test is of a forgery. */
  readonly challenge?: Partial<AnswerChallengeValues>;
  /** What the assertion really says, when the test is of a lie in it. */
  readonly clientData?: Record<string, unknown>;
  /** The flags byte the authenticator really set. */
  readonly flags?: number;
  /** The relying party the authenticator really hashed. */
  readonly rpId?: string;
  readonly at?: string;
}

export interface BuiltEntry {
  readonly entry: Record<string, unknown>;
  readonly textSha256: string;
}

/** One signed entry exactly as a server would store it, signed for real. */
export function signedEntry(input: SignedEntryInput): BuiltEntry {
  const decision = input.decision ?? decisionDocument();
  const project = input.project ?? "waves-demo";
  const id = input.id ?? "d1";
  const revision = input.revision ?? 1;
  const position = input.position ?? 0;
  const verdict = input.verdict ?? "approved";
  const textSha256 = bindingHashOf(decision);
  const nonce = randomBytes(32).toString("base64url");

  const signed: AnswerChallengeValues = {
    project,
    decision: id,
    textSha256,
    index: position,
    verdict,
    option: input.option,
    words: input.words,
    nonce,
    ...input.challenge,
  };
  const challengeHash = createHash("sha256")
    .update(answerChallengeText(signed), "utf8")
    .digest();
  const clientData = {
    type: "webauthn.get",
    origin: ORIGIN,
    challenge: challengeHash.toString("base64url"),
    ...input.clientData,
  };
  const clientDataBytes = Buffer.from(JSON.stringify(clientData), "utf8");
  const rpIdHash = createHash("sha256")
    .update(input.rpId ?? RP_ID, "utf8")
    .digest();
  const authenticatorData = Buffer.concat([
    rpIdHash,
    Buffer.from([input.flags ?? USER_FLAGS]),
    Buffer.from([0, 0, 0, 0]),
  ]);
  const message = Buffer.concat([
    authenticatorData,
    createHash("sha256").update(clientDataBytes).digest(),
  ]);
  const signer = createSign("SHA256");
  signer.update(message);
  const signature = signer.sign(input.key.privateKey);

  const entry: Record<string, unknown> = {
    state: verdict,
    source: "signed",
    revision,
    textSha256,
    by: "the owner",
    at: input.at ?? "2026-10-08T13:00:00Z",
    signature: {
      credentialId: input.key.credentialId,
      authenticatorData: authenticatorData.toString("base64url"),
      clientDataJSON: clientDataBytes.toString("base64url"),
      signature: signature.toString("base64url"),
      nonce,
      index: position,
    },
    index: position,
    receivedAt: "2026-10-08T13:00:01Z",
  };
  if (input.option !== undefined) {
    entry.option = input.option;
  }
  if (input.words !== undefined) {
    entry.words = input.words;
  }
  return { entry, textSha256 };
}

export interface PinnedKey {
  readonly key: AnswerKey;
  readonly label: string;
  readonly retired?: boolean;
}

/** The owner-keys document, with the public halves only. */
export function pinDocument(
  pinned: readonly PinnedKey[],
): Record<string, unknown> {
  return {
    schema: "waves-owner-keys/v1",
    keys: pinned.map(({ key, label, retired }) => ({
      credentialId: key.credentialId,
      publicKeySpki: key.publicKeySpki,
      label,
      addedAt: "2026-10-01T09:00:00Z",
      ...(retired ? { retired: true } : {}),
    })),
  };
}

/** A pin port's answer for a pin file exactly as the design wants it. */
export function pinReadOf(
  pinned: readonly PinnedKey[],
  overrides: { uid?: number; mode?: number } = {},
): {
  kind: "present";
  type: "file";
  uid: number;
  mode: number;
  text: string;
} {
  return {
    kind: "present",
    type: "file",
    uid: overrides.uid ?? 0,
    mode: overrides.mode ?? 0o100644,
    text: JSON.stringify(pinDocument(pinned)),
  };
}

export interface RecordInput {
  readonly entries: readonly Record<string, unknown>[];
  readonly revisions?: readonly Record<string, unknown>[];
  readonly decision?: Record<string, unknown>;
  readonly id?: string;
  readonly textSha256?: string;
}

/** A decision record as the read route answers it: head, revisions, entries. */
export function decisionRecord(input: RecordInput): string {
  const decision = input.decision ?? decisionDocument();
  const id = input.id ?? "d1";
  const textSha256 = input.textSha256 ?? bindingHashOf(decision);
  return JSON.stringify({
    head: {
      project: "waves-demo",
      id,
      question: "What should we do?",
      revision: 1,
      textSha256,
    },
    revisions: input.revisions ?? [
      {
        revision: 1,
        textSha256,
        receivedAt: "2026-10-08T12:00:01Z",
        decision,
      },
    ],
    entries: [...input.entries],
  });
}
