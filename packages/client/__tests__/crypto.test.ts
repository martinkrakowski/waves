import { createSign, generateKeyPairSync, type KeyObject } from "node:crypto";

import { describe, expect, it } from "vitest";

import { nodeCrypto } from "../src/infrastructure/crypto.js";

const crypto = nodeCrypto();

function p256(): { publicDer: Buffer; private: KeyObject } {
  const { publicKey, privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  return {
    publicDer: publicKey.export({ type: "spki", format: "der" }),
    private: privateKey,
  };
}

function signedBy(privateKey: KeyObject, message: Uint8Array): Buffer {
  const signer = createSign("SHA256");
  signer.update(message);
  return signer.sign(privateKey);
}

const MESSAGE = new Uint8Array([1, 2, 3, 4, 5]);

describe("nodeCrypto", () => {
  it("hashes with SHA-256", () => {
    const digest = crypto.sha256(new TextEncoder().encode("abc"));
    expect(Buffer.from(digest).toString("hex")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("verifies a P-256 signature over the message", () => {
    const key = p256();
    const signature = signedBy(key.private, MESSAGE);
    expect(crypto.verifyEs256(key.publicDer, MESSAGE, signature)).toBe("ok");
  });

  it("refuses a signature made over another message", () => {
    const key = p256();
    const signature = signedBy(key.private, new Uint8Array([9, 9, 9]));
    expect(crypto.verifyEs256(key.publicDer, MESSAGE, signature)).toBe(
      "bad-signature",
    );
  });

  it("refuses a signature with bytes flipped in it", () => {
    const key = p256();
    const signature = Buffer.from(signedBy(key.private, MESSAGE));
    signature.writeUint8(signature.readUInt8(0) ^ 0xff, 0);
    expect(crypto.verifyEs256(key.publicDer, MESSAGE, signature)).toBe(
      "bad-signature",
    );
  });

  it("refuses a signature against another key's SPKI", () => {
    const signer = p256();
    const other = p256();
    const signature = signedBy(signer.private, MESSAGE);
    expect(crypto.verifyEs256(other.publicDer, MESSAGE, signature)).toBe(
      "bad-signature",
    );
  });

  it("names a key that is not P-256: an RSA SPKI", () => {
    const { publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const spki = publicKey.export({ type: "spki", format: "der" });
    expect(crypto.verifyEs256(spki, MESSAGE, new Uint8Array(70))).toBe(
      "not-p256",
    );
  });

  it("names a key that is not P-256: a P-384 SPKI", () => {
    const { publicKey } = generateKeyPairSync("ec", {
      namedCurve: "secp384r1",
    });
    const spki = publicKey.export({ type: "spki", format: "der" });
    expect(crypto.verifyEs256(spki, MESSAGE, new Uint8Array(100))).toBe(
      "not-p256",
    );
  });

  it("refuses bytes that are not an SPKI at all", () => {
    expect(
      crypto.verifyEs256(
        new Uint8Array([1, 2, 3]),
        MESSAGE,
        new Uint8Array(70),
      ),
    ).toBe("bad-signature");
  });
});
