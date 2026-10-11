import { Buffer } from "node:buffer";
import { createSign, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import type { EnrolAttachment } from "../../public/enrol-key.js";
import {
  base64,
  base64url,
  createOptions,
  derToRawP256,
  ES256,
  enrolKey,
  flagsOf,
  getOptions,
  randomBytes,
} from "../../public/enrol-key.js";
import {
  base64Of,
  base64urlOf,
  CREDENTIAL_ID,
  fillBytes,
  HOSTNAME,
  KEY,
  LOCATION,
  makeAssertion,
  makeCreation,
  makeCrypto,
  ORIGIN,
  OTHER_KEY,
  publicKeyArgument,
  SPKI,
} from "./enrol-key-fixtures.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, "..", "..", "public", "enrol-key.js");

/**
 * A `credentials.create` as this page calls it: the options under `publicKey`,
 * the shape the browser takes and nothing else.
 */
type CreateFn = (options: CredentialCreationOptions) => Promise<unknown>;
/** A `credentials.get` as this page calls it, options under `publicKey`. */
type GetFn = (options: CredentialRequestOptions) => Promise<unknown>;

/** A `credentials` whose `create` resolves to `response` and `get` to `assertion`. */
function fakeCredentials(
  response?: unknown,
  assertion?: unknown,
): {
  create: Mock<CreateFn>;
  get: Mock<GetFn>;
} {
  return {
    create: vi.fn<CreateFn>().mockImplementation((options) => {
      publicKeyArgument(options);
      return Promise.resolve(response);
    }),
    get: vi.fn<GetFn>().mockImplementation((options) => {
      publicKeyArgument(options);
      return Promise.resolve(assertion);
    }),
  };
}

describe("enrolKey.intro", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads origin and rpId from location and probes PublicKeyCredential", () => {
    vi.stubGlobal("PublicKeyCredential", class {});
    const controller = enrolKey(fakeCredentials(), makeCrypto(0), LOCATION);
    expect(controller.intro()).toEqual({
      kind: "intro",
      origin: ORIGIN,
      rpId: HOSTNAME,
      publicKeyCredential: true,
    });
  });

  it("reports PublicKeyCredential absent when the browser lacks it", () => {
    const controller = enrolKey(fakeCredentials(), makeCrypto(0), LOCATION);
    expect(controller.intro().publicKeyCredential).toBe(false);
  });
});

describe("enrolKey.create options", () => {
  const PLATFORM_OPTIONS = createOptions(
    HOSTNAME,
    fillBytes(32, 0x41),
    fillBytes(16, 0x41),
    "platform",
  );

  it("hands credentials.create the exact P-256 platform passkey options under publicKey", async () => {
    const creds = fakeCredentials(makeCreation());
    const controller = enrolKey(creds, makeCrypto(0x41), LOCATION);

    await controller.create("platform");

    // The browser takes the WebAuthn options under `publicKey`, and the
    // argument carries that key and nothing else beside it.
    const argument = creds.create.mock.calls[0]?.[0];
    expect(Object.keys(argument ?? {})).toStrictEqual(["publicKey"]);
    // Every field of the options, down to the only-alg `-7` list, the platform
    // selection and the 16-byte owner id, is checked by the equality below.
    expect(argument?.publicKey).toEqual(PLATFORM_OPTIONS);
    // Pinned against literals rather than against `createOptions` again: the
    // assertion above compares the call with the builder, so a builder that grew
    // an algorithm would satisfy both and say nothing. These do not.
    const options = argument?.publicKey;
    expect(options?.rp).toEqual({ id: HOSTNAME, name: "waves" });
    expect(options?.pubKeyCredParams).toStrictEqual([
      { type: "public-key", alg: -7 },
    ]);
    expect(options?.authenticatorSelection).toEqual({
      authenticatorAttachment: "platform",
      residentKey: "required",
      userVerification: "required",
    });
    expect(options?.attestation).toBe("none");
    expect(options?.timeout).toBe(120_000);
    expect(options?.user).toEqual({
      id: fillBytes(16, 0x41),
      name: "owner",
      displayName: "owner",
    });
  });

  it("hands credentials.create the cross-platform options for the security key button, everything else equal", async () => {
    const creds = fakeCredentials(makeCreation());
    const controller = enrolKey(creds, makeCrypto(0x41), LOCATION);

    await controller.create("cross-platform");

    const argument = creds.create.mock.calls[0]?.[0];
    expect(Object.keys(argument ?? {})).toStrictEqual(["publicKey"]);
    // The two buttons differ in nothing but the attachment.
    expect(argument?.publicKey).toEqual({
      ...PLATFORM_OPTIONS,
      authenticatorSelection: {
        authenticatorAttachment: "cross-platform",
        residentKey: "required",
        userVerification: "required",
      },
    });
  });
});

describe("createOptions", () => {
  it.each(["internal", "", "Platform", null, undefined, 0])(
    "refuses an attachment that is neither platform nor cross-platform (%s)",
    (attachment) => {
      expect(() =>
        createOptions(
          HOSTNAME,
          fillBytes(32, 0x41),
          fillBytes(16, 0x41),
          attachment as unknown as EnrolAttachment,
        ),
      ).toThrow(Error);
    },
  );
});

describe("enrolKey.get options", () => {
  it("hands credentials.get the created id with the platform rpId and uv required", async () => {
    const creds = fakeCredentials(makeCreation(), await makeAssertion());
    const controller = enrolKey(creds, makeCrypto(0x41), LOCATION);
    await controller.create("platform");

    await controller.test();

    // The get options too live under `publicKey`, and nowhere else.
    const argument = creds.get.mock.calls[0]?.[0];
    expect(Object.keys(argument ?? {})).toStrictEqual(["publicKey"]);
    expect(argument?.publicKey).toEqual(
      getOptions(HOSTNAME, fillBytes(32, 0x41), new Uint8Array(CREDENTIAL_ID)),
    );
    const options = argument?.publicKey;
    expect(options?.rpId).toBe(HOSTNAME);
    expect(options?.userVerification).toBe("required");
    expect(options?.timeout).toBe(120_000);
    expect(options?.allowCredentials).toStrictEqual([
      { type: "public-key", id: new Uint8Array(CREDENTIAL_ID) },
    ]);
  });
});

describe("enrolKey.create results", () => {
  it.each<[number, { backupEligible: boolean; backedUp: boolean }]>([
    [0x45, { backupEligible: false, backedUp: false }],
    [0x4d, { backupEligible: true, backedUp: false }],
    [0x5d, { backupEligible: true, backedUp: true }],
  ])(
    "shows the created key for a ready passkey with flags 0x%2x",
    async (flags, expectedFlags) => {
      const transports =
        flags === 0x45
          ? ["hybrid", "internal"]
          : flags === 0x5d
            ? []
            : undefined;
      const creds = fakeCredentials(
        makeCreation({ flagsByte: flags, transports }),
      );
      const controller = enrolKey(creds, makeCrypto(0x41), LOCATION);
      const state = await controller.create("platform");

      expect(state).toMatchObject({
        kind: "ready",
        credentialId: base64urlOf(CREDENTIAL_ID),
        publicKeySpki: base64Of(SPKI),
        algorithm: ES256,
        userVerified: true,
        backupEligible: expectedFlags.backupEligible,
        backedUp: expectedFlags.backedUp,
        transports: flags === 0x45 ? "hybrid, internal" : "not reported",
      });
      if (state.kind !== "ready") {
        throw new Error("narrowed");
      }
      expect(state.addedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      expect(state.json).toBe(
        JSON.stringify({
          credentialId: base64urlOf(CREDENTIAL_ID),
          publicKeySpki: base64Of(SPKI),
          label: "",
          addedAt: state.addedAt,
        }),
      );
    },
  );

  it.each<["platform" | "cross-platform" | undefined, string]>([
    ["platform", "this device"],
    ["cross-platform", "a separate security key or another device"],
    [undefined, "not reported"],
  ])(
    "says where the key was made from authenticatorAttachment (%s)",
    async (attachment, madeOn) => {
      const creation =
        attachment === undefined
          ? makeCreation()
          : makeCreation({ authenticatorAttachment: attachment });
      const creds = fakeCredentials(creation);
      const controller = enrolKey(creds, makeCrypto(0x41), LOCATION);
      const state = await controller.create("platform");

      expect(state).toMatchObject({ kind: "ready", madeOn });
    },
  );

  it("refuses a create whose response has no public key method", async () => {
    const creds = fakeCredentials(makeCreation({ getPublicKey: "missing" }));
    const controller = enrolKey(creds, makeCrypto(0x41), LOCATION);
    expect(await controller.create("platform")).toEqual({
      kind: "refused",
      reason:
        "this browser does not return the public key; enrolment cannot be done here",
    });
  });

  it("refuses a create whose getPublicKey throws", async () => {
    const creds = fakeCredentials(makeCreation({ getPublicKey: "throw" }));
    const controller = enrolKey(creds, makeCrypto(0x41), LOCATION);
    expect(await controller.create("platform")).toEqual({
      kind: "refused",
      reason:
        "this browser does not return the public key; enrolment cannot be done here",
    });
  });

  it("refuses a create whose getPublicKey returns null", async () => {
    const creds = fakeCredentials(makeCreation({ getPublicKey: "null" }));
    const controller = enrolKey(creds, makeCrypto(0x41), LOCATION);
    expect(await controller.create("platform")).toEqual({
      kind: "refused",
      reason:
        "this browser does not return the public key; enrolment cannot be done here",
    });
  });

  it.each<[string, Record<string, unknown>]>([
    ["without getPublicKeyAlgorithm", { getPublicKeyAlgorithm: undefined }],
    ["without getAuthenticatorData", { getAuthenticatorData: undefined }],
    [
      "whose getPublicKeyAlgorithm throws",
      {
        getPublicKeyAlgorithm: () => {
          throw new Error("no algorithm");
        },
      },
    ],
    [
      "whose getAuthenticatorData throws",
      {
        getAuthenticatorData: () => {
          throw new Error("no authenticator data");
        },
      },
    ],
  ])("refuses a create response %s", async (_label, overrides) => {
    const base = makeCreation() as Record<string, unknown>;
    const response = {
      ...(base.response as Record<string, unknown>),
      ...overrides,
    };
    const creds = fakeCredentials({ ...base, response });
    const controller = enrolKey(creds, makeCrypto(0x41), LOCATION);
    expect(await controller.create("platform")).toEqual({
      kind: "refused",
      reason:
        "this browser does not return the public key; enrolment cannot be done here",
    });
  });

  it("refuses a passkey whose algorithm is not -7", async () => {
    const creds = fakeCredentials(makeCreation({ algorithm: -257 }));
    const controller = enrolKey(creds, makeCrypto(0x41), LOCATION);
    expect(await controller.create("platform")).toEqual({
      kind: "refused",
      reason: "the passkey uses a key type this page does not support",
    });
  });

  it("refuses a passkey that was not user-verified", async () => {
    const creds = fakeCredentials(makeCreation({ flagsByte: 0x40 }));
    const controller = enrolKey(creds, makeCrypto(0x41), LOCATION);
    expect(await controller.create("platform")).toEqual({
      kind: "refused",
      reason: "this passkey was not user-verified",
    });
  });

  it("refuses a create that the browser rejects, with its error", async () => {
    const creds = {
      create: vi.fn<CreateFn>().mockRejectedValue(new Error("boom")),
      get: vi.fn<GetFn>(),
    };
    const controller = enrolKey(creds, makeCrypto(0x41), LOCATION);
    expect(await controller.create("platform")).toEqual({
      kind: "createError",
      name: "Error",
      message: "boom",
    });
  });

  it("reports a rejection without a name or message as Error", async () => {
    const creds = {
      create: vi.fn<CreateFn>().mockRejectedValue({}),
      get: vi.fn<GetFn>(),
    };
    const controller = enrolKey(creds, makeCrypto(0x41), LOCATION);
    expect(await controller.create("platform")).toEqual({
      kind: "createError",
      name: "Error",
      message: "[object Object]",
    });
  });
});

describe("enrolKey.test verification", () => {
  async function ready() {
    const creds = fakeCredentials(makeCreation(), await makeAssertion());
    const controller = enrolKey(creds, makeCrypto(0x41), LOCATION);
    await controller.create("platform");
    return { creds, controller };
  }

  it("passes every check for an assertion signed by the created key", async () => {
    const { controller } = await ready();
    const verified = await controller.test();
    expect(verified.kind).toBe("verified");
    if (verified.kind !== "verified") {
      throw new Error("narrowed");
    }
    expect(verified.checks).toHaveLength(5);
    for (const check of verified.checks) {
      expect(check.ok).toBe(true);
      expect(check.detail).toBeUndefined();
    }
  });

  it.each<[string, Record<string, unknown>]>([
    [
      "a credential id that is not the created one",
      { rawId: fillBytes(32, 0x99) },
    ],
    ["a credential id of the wrong length", { rawId: fillBytes(31, 0x99) }],
    ["a wrong origin in clientDataJSON", { origin: "https://evil.example" }],
    [
      "a wrong challenge in clientDataJSON",
      { challengeText: base64urlOf(fillBytes(32, 0x99)) },
    ],
    ["a wrong rpIdHash", { rpIdHash: fillBytes(32, 0x00) }],
    ["the user-verified bit cleared", { flagsByte: 0x59 }],
    ["a type of webauthn.create", { type: "webauthn.create" }],
    ["a signature by another key", { signer: OTHER_KEY.privateKey }],
  ])("fails exactly one check for %s", async (_label, overrides) => {
    const { creds, controller } = await ready();
    const assertion = await makeAssertion({
      challenge: fillBytes(32, 0x41),
      ...overrides,
    });
    creds.get.mockResolvedValue(assertion);
    const verified = await controller.test();

    const failed = verified.checks.filter((c: { ok: boolean }) => !c.ok);
    expect(failed).toHaveLength(1);
    const passed = verified.checks.filter((c: { ok: boolean }) => c.ok);
    expect(passed).toHaveLength(4);
    expect(verified.checks.map((c: { label: string }) => c.label)).toEqual([
      "credential id",
      "client data",
      "rpId hash",
      "user verified",
      "signature",
    ]);
  });

  it("reports clientDataJSON that is not JSON as a failed client data check", async () => {
    const { creds, controller } = await ready();
    const assertion = await makeAssertion({
      clientDataJSON: new Uint8Array([0x7b, 0x00, 0x7d]),
    });
    creds.get.mockResolvedValue(assertion);
    const verified = await controller.test();
    const cd = verified.checks.find((c) => c.label === "client data");
    expect(cd).toEqual({
      label: "client data",
      ok: false,
      detail: "clientDataJSON is not JSON",
    });
    expect(
      verified.checks.filter((c) => c.label === "client data"),
    ).toHaveLength(1);
    const sig = verified.checks.find((c) => c.label === "signature");
    expect(sig?.ok).toBe(true);
  });

  it.each<[string, Uint8Array]>([
    ["the text null", Buffer.from("null")],
    ["an empty array", Buffer.from("[]")],
    ["a bare string", Buffer.from('"x"')],
    ["a bare number", Buffer.from("7")],
  ])(
    "fails the client data check when clientDataJSON parses to %s",
    async (_label, clientDataJSON) => {
      const { creds, controller } = await ready();
      const assertion = await makeAssertion({ clientDataJSON });
      creds.get.mockResolvedValue(assertion);
      const verified = await controller.test();
      const cd = verified.checks.find((c) => c.label === "client data");
      expect(cd).toEqual({
        label: "client data",
        ok: false,
        detail: "clientDataJSON is not an object",
      });
    },
  );

  it("reports a signature that is not valid DER as a failed signature check", async () => {
    const { creds, controller } = await ready();
    const assertion = await makeAssertion();
    (assertion.response as { signature: Uint8Array }).signature =
      new Uint8Array([0xff, 0xff, 0xff]);
    creds.get.mockResolvedValue(assertion);
    const verified = await controller.test();
    const sig = verified.checks.at(4);
    expect(sig?.ok).toBe(false);
    expect(verified.checks.slice(0, 4).every((c) => c.ok)).toBe(true);
  });

  it("reports a get that rejects as one failed check", async () => {
    const { creds, controller } = await ready();
    creds.get.mockRejectedValue(new Error("refused"));
    const verified = await controller.test();
    expect(verified.checks).toEqual([
      {
        label: "sign",
        ok: false,
        detail: expect.any(String),
      },
    ]);
    expect(verified.checks[0]?.detail).toContain("Error");
    expect(verified.checks[0]?.detail).toContain("refused");
  });

  it("throws if asked to sign before a key was created", async () => {
    const controller = enrolKey(fakeCredentials(), makeCrypto(0x41), LOCATION);
    await expect(controller.test()).rejects.toThrow(
      "no passkey has been created",
    );
  });
});

describe("flagsOf", () => {
  it.each([
    [0x00, false, false, false],
    [0x45, true, false, false],
    [0x4d, true, true, false],
    [0x5d, true, true, true],
  ] as const)("decodes flags byte 0x%2x", (byte, uv, be, br) => {
    expect(flagsOf(byte)).toEqual({
      userVerified: uv,
      backupEligible: be,
      backedUp: br,
    });
  });
});

describe("base64 and base64url", () => {
  it.each([0, 1, 2, 3, 4, 5, 31, 32, 33, 64, 65])(
    "encode like Buffer for length %i",
    (n) => {
      const bytes = fillBytes(n, 0x41);
      expect(base64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
      expect(base64url(bytes)).toBe(Buffer.from(bytes).toString("base64url"));
    },
  );
});

describe("randomBytes", () => {
  it("fills a buffer from crypto.getRandomValues", () => {
    const crypto = makeCrypto(0xab);
    const bytes = randomBytes(crypto, 16);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(16);
    expect(bytes[0]).toBe(0xab);
  });
});

describe("the enrol-key module sends nothing to a server", () => {
  it("has no fetch, XHR, storage or cookie access in its source", () => {
    const source = readFileSync(SOURCE, "utf8");
    for (const term of [
      "fetch(",
      "XMLHttpRequest",
      "localStorage",
      "sessionStorage",
      "indexedDB",
      "document.cookie",
    ]) {
      expect(source).not.toContain(term);
    }
  });
});

// --- derToRawP256: a real P-256 key pair and a DER signature from it.

const MESSAGE_DER = Buffer.from("enrol-key signature test");

function derSignature(): Buffer {
  return createSign("SHA256").update(MESSAGE_DER).sign(KEY.privateKey);
}

/** Re-encode a raw 64-byte `r‖s` as a DER SEQUENCE, the inverse of derToRawP256. */
function rawToDerP256(raw: Uint8Array): Buffer {
  const int = (value: Uint8Array): Buffer => {
    let start = 0;
    while (start < value.length - 1 && value[start] === 0x00) {
      start += 1;
    }
    const body = value.subarray(start);
    const first = body.length > 0 ? (body[0] ?? 0x00) : 0x00;
    const padded =
      (first & 0x80) !== 0
        ? Buffer.concat([Buffer.from([0x00]), Buffer.from(body)])
        : Buffer.from(body);
    return Buffer.concat([Buffer.from([0x02, padded.length]), padded]);
  };
  const body = Buffer.concat([int(raw.subarray(0, 32)), int(raw.subarray(32))]);
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
    const rebuilt = rawToDerP256(raw);
    expect(rebuilt.equals(der)).toBe(true);
    expect(verify(null, MESSAGE_DER, KEY.publicKey, rebuilt)).toBe(true);
  });

  it("uses a long-form length when the SEQUENCE is long enough", () => {
    const der = Buffer.from([
      0x30, 0x81, 0x06, 0x02, 0x01, 0x05, 0x02, 0x01, 0x07,
    ]);
    expect(derToRawP256(der).length).toBe(64);
  });

  it("accepts an ArrayBuffer as well as a Uint8Array", () => {
    const der = derSignature();
    const copy = new ArrayBuffer(der.length);
    new Uint8Array(copy).set(der);
    const raw = derToRawP256(copy);
    expect(raw).toBeInstanceOf(Uint8Array);
    expect(raw.length).toBe(64);
    expect(rawToDerP256(raw).equals(der)).toBe(true);
  });

  it("strips a leading 0x00 sign byte from r and from s", () => {
    const r = fillBytes(32, 0x00);
    r[0] = 0xff;
    const s = fillBytes(32, 0x00);
    s[0] = 0x80;
    const der = seq([0x02, 0x21, 0x00, ...r, 0x02, 0x21, 0x00, ...s]);
    const raw = derToRawP256(der);
    expect(raw.subarray(0, 32)).toEqual(r);
    expect(raw.subarray(32)).toEqual(s);
  });

  it("left-pads a short integer to 32 bytes", () => {
    const r = new Uint8Array([0x01, 0x02]);
    const s = new Uint8Array([0x03]);
    const der = seq([0x02, 0x02, ...r, 0x02, 0x01, ...s]);
    const raw = derToRawP256(der);
    expect(raw.subarray(0, 32)).toEqual(
      Uint8Array.of(...Array(30).fill(0x00), 0x01, 0x02),
    );
    expect(raw.subarray(32)).toEqual(
      Uint8Array.of(...Array(31).fill(0x00), 0x03),
    );
  });

  it("accepts a zero integer", () => {
    const der = seq([0x02, 0x01, 0x00, 0x02, 0x01, 0x00]);
    expect(derToRawP256(der)).toEqual(new Uint8Array(64));
  });

  it.each<[string, Uint8Array | Buffer]>([
    [
      "the outer tag is not a SEQUENCE",
      Uint8Array.from([0x02, 0x06, 0x02, 0x01, 0x05, 0x02, 0x01, 0x07]),
    ],
    ["the signature is empty", new Uint8Array(0)],
    [
      "the SEQUENCE length is indefinite",
      Uint8Array.from([0x30, 0x80, 0x02, 0x01, 0x05]),
    ],
    [
      "a SEQUENCE length is more than four bytes",
      Uint8Array.from([0x30, 0x86, 0x00, 0x00, 0x00, 0x01, 0x02]),
    ],
    [
      "a SEQUENCE length is read past the buffer",
      Uint8Array.from([0x30, 0x84, 0x00, 0x00]),
    ],
    [
      "the SEQUENCE overruns the buffer",
      Uint8Array.from([0x30, 0x10, 0x02, 0x01, 0x05]),
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
      Uint8Array.from([
        0x30, 0x0a, 0x02, 0x01, 0x05, 0x02, 0x01, 0x07, 0x00, 0x00, 0x00, 0x00,
      ]),
    ],
    [
      "a SEQUENCE leaves trailing bytes after",
      Uint8Array.from([0x30, 0x06, 0x02, 0x01, 0x05, 0x02, 0x01, 0x07, 0x00]),
    ],
  ])("refuses malformed DER (%s)", (_label, der) => {
    expect(() => derToRawP256(der)).toThrow(Error);
  });
});
