import { createSecretKey, generateKeyPairSync } from "node:crypto";

import { answerChallengeText } from "@hexagen-monaco/waves-contract";
import { describe, expect, it } from "vitest";

import {
  EXPECTED_ORIGIN,
  REFUSAL_REASONS,
  verifyAssertion,
} from "../src/infrastructure/assertion-verifier.js";
import {
  buildAssertion,
  CHALLENGE_TEXT,
  CHALLENGE_VALUES,
} from "./assertion-helper.js";

function reasonOf(
  built: ReturnType<typeof buildAssertion>,
  text: string = built.text,
): string {
  const result = verifyAssertion(built.input, text, built.keys);
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error("expected a refusal");
  }
  return result.reason;
}

describe("REFUSAL_REASONS", () => {
  it("is the closed list of reasons, one per check, in order", () => {
    expect(REFUSAL_REASONS).toEqual([
      "unknown-credential",
      "retired-key",
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
    ]);
  });
});

describe("verifyAssertion", () => {
  it("accepts a good assertion and answers the key that signed it", () => {
    const built = buildAssertion();

    const result = verifyAssertion(built.input, built.text, built.keys);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.key).toBe(built.keys[0]!.key);
    }
  });

  it("refuses a credential no key names", () => {
    const built = buildAssertion();
    const result = verifyAssertion(
      { ...built.input, credentialId: "credential-nobody-holds-0" },
      built.text,
      built.keys,
    );
    expect(result).toEqual({ ok: false, reason: "unknown-credential" });
  });

  it("refuses a retired key", () => {
    const built = buildAssertion({ retired: true });
    expect(reasonOf(built)).toBe("retired-key");
  });

  it("refuses a signature another key made", () => {
    const stranger = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const built = buildAssertion({ signingKey: stranger.privateKey });
    expect(reasonOf(built)).toBe("bad-signature");
  });

  it("refuses a signature over bytes that are not DER at all", () => {
    const built = buildAssertion();
    const result = verifyAssertion(
      {
        ...built.input,
        signature: Buffer.from([0x00, 0x01, 0x02]).toString("base64url"),
      },
      built.text,
      built.keys,
    );
    expect(result).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("refuses, never throws, when the key object cannot verify at all", () => {
    const built = buildAssertion();
    const unusable = [
      { key: built.keys[0]!.key, publicKey: createSecretKey(Buffer.alloc(32)) },
    ];
    const result = verifyAssertion(built.input, built.text, unusable);
    expect(result).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("refuses authenticator data with one byte changed after signing", () => {
    const built = buildAssertion({
      tamperData: (bytes) => {
        bytes[36] = bytes[36]! ^ 0x01;
      },
    });
    expect(reasonOf(built)).toBe("bad-signature");
  });

  it.each(["webauthn.create"])("refuses a client data of type %j", (type) => {
    const built = buildAssertion({
      editClientData: (data) => {
        data.type = type;
      },
    });
    expect(reasonOf(built)).toBe("wrong-type");
  });

  it.each([
    "http://waves.midnight.lan",
    "https://waves.midnight.lan/",
    "https://waves.midnight.lan:8443",
    "https://WAVES.MIDNIGHT.LAN",
    "https://elsewhere.example",
  ])("refuses the origin %j", (origin) => {
    const built = buildAssertion({
      editClientData: (data) => {
        data.origin = origin;
      },
    });
    expect(reasonOf(built)).toBe("wrong-origin");
  });

  it.each([
    ["index", { index: 4 }],
    ["verdict", { verdict: "declined" }],
    ["textSha256", { textSha256: "ff".repeat(32) }],
    ["nonce", { nonce: "m".repeat(43) }],
    ["project", { project: "beta" }],
    ["decision", { decision: "hold-it" }],
  ] as const)("refuses a challenge text differing in %s", (_field, change) => {
    const built = buildAssertion();
    expect(
      reasonOf(built, answerChallengeText({ ...CHALLENGE_VALUES, ...change })),
    ).toBe("wrong-challenge");
  });

  it("refuses a challenge that is not a string", () => {
    const built = buildAssertion({
      editClientData: (data) => {
        data.challenge = 5;
      },
    });
    expect(reasonOf(built)).toBe("wrong-challenge");
  });

  it("refuses a challenge of another length", () => {
    const built = buildAssertion({
      editClientData: (data) => {
        data.challenge = "short";
      },
    });
    expect(reasonOf(built)).toBe("wrong-challenge");
  });

  it("refuses a cross-origin assertion", () => {
    const built = buildAssertion({
      editClientData: (data) => {
        data.crossOrigin = true;
      },
    });
    expect(reasonOf(built)).toBe("cross-origin");
  });

  it("refuses authenticator data shorter than 37 bytes", () => {
    const built = buildAssertion({ dataBytes: 20 });
    expect(reasonOf(built)).toBe("authenticator-data-short");
  });

  it("refuses authenticator data naming another relying party", () => {
    const built = buildAssertion({ rpId: "elsewhere.example" });
    expect(reasonOf(built)).toBe("wrong-rp-id-hash");
  });

  it("refuses authenticator data without the user-present bit", () => {
    const built = buildAssertion({ flags: 0x04 });
    expect(reasonOf(built)).toBe("user-not-present");
  });

  it("refuses authenticator data without the user-verified bit", () => {
    const built = buildAssertion({ flags: 0x01 });
    expect(reasonOf(built)).toBe("user-not-verified");
  });

  it("refuses client data that is not JSON", () => {
    const built = buildAssertion();
    const result = verifyAssertion(
      {
        ...built.input,
        clientDataJSON: Buffer.from("not json", "utf8").toString("base64url"),
      },
      built.text,
      built.keys,
    );
    expect(result).toEqual({ ok: false, reason: "client-data-malformed" });
  });

  it("refuses client data that is JSON but not an object", () => {
    const built = buildAssertion();
    const result = verifyAssertion(
      {
        ...built.input,
        clientDataJSON: Buffer.from(JSON.stringify([1, 2]), "utf8").toString(
          "base64url",
        ),
      },
      built.text,
      built.keys,
    );
    expect(result).toEqual({ ok: false, reason: "client-data-malformed" });
  });

  it("refuses for the earliest reason when an assertion is wrong in two ways", () => {
    const built = buildAssertion({
      editClientData: (data) => {
        data.type = "webauthn.create";
        data.origin = "https://elsewhere.example";
      },
    });
    expect(reasonOf(built)).toBe("wrong-type");
  });

  it("never lets an exception escape, however malformed the input", () => {
    const built = buildAssertion();
    const result = verifyAssertion(
      {
        credentialId: "",
        authenticatorData: "",
        clientDataJSON: "",
        signature: "",
      },
      CHALLENGE_TEXT,
      built.keys,
    );
    expect(result.ok).toBe(false);
    expect(REFUSAL_REASONS).toContain(result.ok ? "" : result.reason);
    expect(EXPECTED_ORIGIN).toBe("https://waves.midnight.lan");
  });
});
