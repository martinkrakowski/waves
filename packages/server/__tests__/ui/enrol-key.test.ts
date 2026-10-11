import { Buffer } from "node:buffer";
import { generateKeyPairSync, createSign, verify } from "node:crypto";

import { describe, expect, it } from "vitest";

import { derToRawP256 } from "../../public/enrol-key.js";

/** A P-256 key pair, real enough to sign and verify with. */
const KEY = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const PRIVATE_KEY = KEY.privateKey;
const PUBLIC_KEY = KEY.publicKey;
const MESSAGE = Buffer.from("enrol-key signature test");

/** A DER signature from the real key: exactly what an authenticator returns. */
function derSignature(): Buffer {
  return createSign("SHA256").update(MESSAGE).sign(PRIVATE_KEY);
}

/**
 * Re-encode a raw 64-byte `r‖s` as a DER SEQUENCE, the inverse of
 * `derToRawP256`, used to prove a conversion kept the right integers.
 */
function rawToDerP256(raw: Uint8Array): Buffer {
  const int = (value: Uint8Array): Buffer => {
    let start = 0;
    while (start < value.length - 1 && value[start] === 0x00) {
      start += 1;
    }
    const body = value.subarray(start);
    const first = body.length > 0 ? (body[0] ?? 0) : 0;
    const needsZero = (first & 0x80) !== 0;
    const bytes = needsZero
      ? Buffer.concat([Buffer.from([0x00]), Buffer.from(body)])
      : Buffer.from(body);
    return Buffer.concat([Buffer.from([0x02, bytes.length]), bytes]);
  };
  const r = raw.subarray(0, 32);
  const s = raw.subarray(32, 64);
  const body = Buffer.concat([int(r), int(s)]);
  return Buffer.concat([Buffer.from([0x30, body.length]), body]);
}

function seq(content: number[]): Buffer {
  const body = Buffer.from(content);
  return Buffer.concat([Buffer.from([0x30, body.length]), body]);
}

describe("derToRawP256", () => {
  it("converts a real DER signature to 64 raw bytes and round-trips through verification", () => {
    const der = derSignature();
    const raw = derToRawP256(der);

    expect(raw).toBeInstanceOf(Uint8Array);
    expect(raw.length).toBe(64);
    // Re-encoding the raw bytes must rebuild the exact DER, and that DER must
    // verify against the public key: derToRawP256 kept r and s intact.
    const rebuilt = rawToDerP256(raw);
    expect(rebuilt.equals(der)).toBe(true);
    expect(verify(null, MESSAGE, PUBLIC_KEY, rebuilt)).toBe(true);
  });

  it("uses a long-form length when the SEQUENCE is long enough", () => {
    // 0x81 0x06 is the long form for length 6; forces the multi-byte path.
    const der = Buffer.from([
      0x30, 0x81, 0x06, 0x02, 0x01, 0x05, 0x02, 0x01, 0x07,
    ]);
    expect(derToRawP256(der).length).toBe(64);
  });

  it("strips a leading 0x00 sign byte from r and from s", () => {
    const r = Buffer.alloc(32, 0x00);
    r[0] = 0xff;
    const s = Buffer.alloc(32, 0x00);
    s[0] = 0x80;
    const der = seq([0x02, 0x21, 0x00, ...r, 0x02, 0x21, 0x00, ...s]);
    const raw = derToRawP256(der);
    expect(raw.subarray(0, 32)).toEqual(new Uint8Array(r));
    expect(raw.subarray(32)).toEqual(new Uint8Array(s));
  });

  it("left-pads a short integer to 32 bytes", () => {
    const r = Buffer.from([0x01, 0x02]);
    const s = Buffer.from([0x03]);
    const der = seq([0x02, 0x02, ...r, 0x02, 0x01, ...s]);
    const raw = derToRawP256(der);
    const pad30 = new Uint8Array(30);
    const pad31 = new Uint8Array(31);
    expect(raw.subarray(0, 32)).toEqual(Uint8Array.of(...pad30, 0x01, 0x02));
    expect(raw.subarray(32)).toEqual(Uint8Array.of(...pad31, 0x03));
  });

  it("accepts a zero integer", () => {
    const der = seq([0x02, 0x01, 0x00, 0x02, 0x01, 0x00]);
    expect(derToRawP256(der)).toEqual(new Uint8Array(64));
  });

  it("accepts an ArrayBuffer as well as a Uint8Array", () => {
    const der = derSignature();
    const copy = new ArrayBuffer(der.length);
    new Uint8Array(copy).set(der);
    expect(derToRawP256(copy)).toBeInstanceOf(Uint8Array);
    expect(derToRawP256(copy).length).toBe(64);
  });

  it.each([
    ["the signature is empty", Buffer.alloc(0)],
    [
      "the outer tag is not a SEQUENCE",
      Buffer.of(0x02, 0x06, 0x02, 0x01, 0x05, 0x02, 0x01, 0x07),
    ],
    [
      "the SEQUENCE length is indefinite",
      Buffer.of(0x30, 0x80, 0x02, 0x01, 0x05),
    ],
    [
      "a SEQUENCE length is more than four bytes",
      Buffer.of(0x30, 0x86, 0x00, 0x00, 0x00, 0x01, 0x02),
    ],
    [
      "a SEQUENCE length is read past the buffer",
      Buffer.of(0x30, 0x84, 0x00, 0x00),
    ],
    [
      "the SEQUENCE overruns the buffer",
      Buffer.of(0x30, 0x10, 0x02, 0x01, 0x05),
    ],
    ["the INTEGER tag is wrong", seq([0x03, 0x01, 0x05, 0x02, 0x01, 0x01])],
    ["an INTEGER has length zero", seq([0x02, 0x00, 0x02, 0x01, 0x01])],
    ["an INTEGER value is truncated", seq([0x02, 0x06, 0x01, 0x02])],
    [
      "an INTEGER length is indefinite",
      seq([0x02, 0x80, 0x01, 0x02, 0x01, 0x01]),
    ],
    [
      "an INTEGER length is more than four bytes",
      seq([0x02, 0x85, 0x00, 0x00, 0x00, 0x01, 0x05]),
    ],
    ["an INTEGER length is read past the buffer", seq([0x02, 0x82, 0x00])],
    ["the second INTEGER is missing", seq([0x02, 0x01, 0x05])],
    [
      "a non-minimal leading zero is rejected",
      seq([0x02, 0x02, 0x00, 0x7f, 0x02, 0x01, 0x01]),
    ],
    [
      "a negative INTEGER is rejected",
      seq([0x02, 0x01, 0xff, 0x02, 0x01, 0x01]),
    ],
    [
      "an INTEGER over 32 bytes is rejected",
      seq([0x02, 0x21, 0x41, ...Array(33).fill(0x01), 0x02, 0x01, 0x01]),
    ],
    [
      "a SEQUENCE leaves trailing bytes inside",
      Buffer.of(
        0x30,
        0x0a,
        0x02,
        0x01,
        0x05,
        0x02,
        0x01,
        0x07,
        0x00,
        0x00,
        0x00,
        0x00,
      ),
    ],
    [
      "a SEQUENCE leaves trailing bytes after",
      Buffer.of(0x30, 0x06, 0x02, 0x01, 0x05, 0x02, 0x01, 0x07, 0x00),
    ],
  ])("refuses malformed DER (%s)", (_label, der) => {
    expect(() => derToRawP256(der)).toThrow(Error);
  });
});
