import { createHash, createPublicKey, createVerify } from "node:crypto";

import type { Crypto } from "../application/ports.js";

/**
 * `node:crypto` as the Crypto port (W67): a digest and one ES256 verdict, and
 * nothing else. The curve is named in the answer rather than assumed, so a key
 * that is not P-256 is reported as what it is; anything that cannot be read at
 * all — a key that is not an SPKI, a signature that is not a DER — is a bad
 * signature rather than a crash, because the reader's answer to all of them is
 * the same refusal.
 */
export function nodeCrypto(): Crypto {
  return {
    sha256: (data) =>
      new Uint8Array(createHash("sha256").update(data).digest()),

    verifyEs256: (spki, message, derSignature) => {
      try {
        const key = createPublicKey({
          key: Buffer.from(spki),
          format: "der",
          type: "spki",
        });
        const details = key.asymmetricKeyDetails;
        if (
          key.asymmetricKeyType !== "ec" ||
          details?.namedCurve !== "prime256v1"
        ) {
          return "not-p256";
        }
        const verifier = createVerify("SHA256");
        verifier.update(message);
        return verifier.verify(key, Buffer.from(derSignature))
          ? "ok"
          : "bad-signature";
      } catch {
        return "bad-signature";
      }
    },
  };
}
