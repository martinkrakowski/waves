import { Buffer } from "node:buffer";
import type { KeyObject } from "node:crypto";
import { createSign, generateKeyPairSync, webcrypto } from "node:crypto";

import { ES256 } from "../../public/enrol-key.js";

/** The real P-256 key pair every assertion in the enrol-key tests is signed by. */
export const KEY = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
export const PRIVATE = KEY.privateKey;
export const SPKI = Buffer.from(
  KEY.publicKey.export({ type: "spki", format: "der" }),
);

/** A second key, for the "signed by another key" check. */
export const OTHER_KEY = generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
});
export const OTHER_SPKI = Buffer.from(
  OTHER_KEY.publicKey.export({ type: "spki", format: "der" }),
);

export const HOSTNAME = "enrol.test";
export const ORIGIN = "https://enrol.test";
export const LOCATION = { origin: ORIGIN, hostname: HOSTNAME };

/** The error a browser answers a credential argument without `publicKey` with. */
export function notSupported(): Error {
  return Object.assign(
    new Error(
      "Only exactly one of 'password', 'federated', and 'publicKey' credential types are currently supported.",
    ),
    { name: "NotSupportedError" },
  );
}

/**
 * A browser-shaped read of a `credentials.create`/`get` argument: the options
 * live under `publicKey`, and an argument without that key is refused with a
 * `NotSupportedError`, exactly as the browser does.
 */
export function publicKeyArgument(argument: unknown): { publicKey: unknown } {
  if (
    typeof argument !== "object" ||
    argument === null ||
    (argument as { publicKey?: unknown }).publicKey === undefined
  ) {
    throw notSupported();
  }
  return argument as { publicKey: unknown };
}

/** A 32-byte credential id, fixed so a test can compare it byte for byte. */
export const CREDENTIAL_ID = Buffer.from(
  new Uint8Array(32).map((_, i) => i + 1),
);

export function toBytes(value: Buffer | Uint8Array | ArrayBuffer): Uint8Array {
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return new Uint8Array(value);
}

export function base64urlOf(bytes: Uint8Array | Buffer): string {
  return Buffer.from(toBytes(bytes)).toString("base64url");
}

export function base64Of(bytes: Uint8Array | Buffer): string {
  return Buffer.from(toBytes(bytes)).toString("base64");
}

/** A `Uint8Array` of `n` bytes, each `fill`, for challenges and user ids. */
export function fillBytes(n: number, fill: number): Uint8Array {
  const bytes = new Uint8Array(n);
  bytes.fill(fill);
  return bytes;
}

/** SHA-256 of the bytes, wrapping Node's WebCrypto as the `crypto` a view reads. */
export function sha256(data: Uint8Array): Promise<ArrayBuffer> {
  return webcrypto.subtle.digest("SHA-256", toBytes(data));
}

/** A `crypto` whose `getRandomValues` fills `fill`, backed by the real SubtleCrypto. */
export function makeCrypto(fill: number): Crypto {
  return {
    getRandomValues(buffer: Uint8Array): Uint8Array {
      buffer.fill(fill);
      return buffer;
    },
    subtle: webcrypto.subtle,
  } as unknown as Crypto;
}

/** Build a fake `credentials.create` response for the given shape. */
export function makeCreation(
  opts: {
    flagsByte?: number;
    spki?: Uint8Array;
    rawId?: Uint8Array;
    algorithm?: number;
    transports?: readonly string[] | undefined;
    /** What `credential.authenticatorAttachment` reports, when it reports it. */
    authenticatorAttachment?: "platform" | "cross-platform";
    getPublicKey?: "missing" | "null" | "throw";
  } = {},
) {
  const flagsByte = opts.flagsByte ?? 0x5d;
  const spki = opts.spki ?? SPKI;
  const algorithm = opts.algorithm ?? ES256;
  const rawId = opts.rawId ?? CREDENTIAL_ID;
  const authData = new Uint8Array(33);
  authData[32] = flagsByte;
  const response: Record<string, unknown> = {
    getPublicKeyAlgorithm: () => algorithm,
    getAuthenticatorData: () => authData,
  };
  if (opts.getPublicKey === "missing") {
    // No getPublicKey method at all.
  } else if (opts.getPublicKey === "null") {
    response.getPublicKey = () => null;
  } else if (opts.getPublicKey === "throw") {
    response.getPublicKey = () => {
      throw new Error("no public key");
    };
  } else {
    response.getPublicKey = () => spki;
  }
  if (opts.transports !== undefined) {
    response.getTransports = () => opts.transports;
  }
  const credential: Record<string, unknown> = { rawId, id: "id", response };
  if (opts.authenticatorAttachment !== undefined) {
    credential.authenticatorAttachment = opts.authenticatorAttachment;
  }
  return credential;
}

/**
 * A fake `credentials.get` assertion. By default it matches everything the
 * page checks (right rpIdHash, uv set, signed by the real key); override any
 * field to make exactly one check fail.
 */
export async function makeAssertion(
  opts: {
    challenge?: Uint8Array;
    rpId?: string;
    origin?: string;
    type?: string;
    challengeText?: string;
    rpIdHash?: Uint8Array;
    flagsByte?: number;
    rawId?: Uint8Array;
    signer?: KeyObject;
    /** Raw clientDataJSON bytes, to feed something that is not valid JSON. */
    clientDataJSON?: Uint8Array;
  } = {},
): Promise<Record<string, unknown>> {
  const challenge = opts.challenge ?? fillBytes(32, 0x41);
  const rpId = opts.rpId ?? HOSTNAME;
  const origin = opts.origin ?? ORIGIN;
  const type = opts.type ?? "webauthn.get";
  const rpIdHash =
    opts.rpIdHash ?? new Uint8Array(await sha256(toBytes(Buffer.from(rpId))));
  const flagsByte = opts.flagsByte ?? 0x5d;
  const clientData = {
    type,
    challenge: opts.challengeText ?? base64urlOf(challenge),
    origin,
  };
  const cdJSON = opts.clientDataJSON
    ? Buffer.from(opts.clientDataJSON)
    : Buffer.from(JSON.stringify(clientData));
  const authData = new Uint8Array(33);
  authData.set(rpIdHash, 0);
  authData[32] = flagsByte;
  const signed = Buffer.concat([
    toBytes(authData),
    Buffer.from(await sha256(toBytes(cdJSON))),
  ]);
  const signer = opts.signer ?? PRIVATE;
  const signature = createSign("SHA256")
    .update(Buffer.from(signed))
    .sign(signer);
  return {
    rawId: opts.rawId ?? CREDENTIAL_ID,
    id: "id",
    response: {
      clientDataJSON: toBytes(cdJSON),
      authenticatorData: toBytes(authData),
      signature: toBytes(signature),
    },
  };
}
