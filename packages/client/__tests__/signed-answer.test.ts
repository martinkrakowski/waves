import { generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vitest";
import type { AnswerSignature, OwnerKey } from "@hexagen-monaco/waves-contract";

import { nodeCrypto } from "../src/infrastructure/crypto.js";
import {
  chooseSignedAnswer,
  checkAssertion,
  decodeBase64,
  decodeBase64Url,
  encodeBase64Url,
  issuesSentence,
  toHex,
  utf8Bytes,
  type AssertionCheck,
} from "../src/domain/signed-answer.js";
import {
  answerKey,
  signedEntry,
  type BuiltEntry,
} from "./support/signed-answer.js";

const crypto = nodeCrypto();

/** A good entry at position 0, with the parts the checks want. */
function goodAnswer(): BuiltEntry {
  return signedEntry({ key: answerKey(), words: "Go with B" });
}

function chosenWith(entry: Record<string, unknown>, textSha256: string) {
  const choice = chooseSignedAnswer([entry], 1, textSha256);
  if (!choice.ok) {
    throw new Error(`expected a chosen answer: ${JSON.stringify(choice)}`);
  }
  return choice;
}

function keyOf(credentialId: string, publicKeySpki: string): OwnerKey {
  return {
    credentialId,
    publicKeySpki,
    label: "the owner's phone",
    addedAt: "2026-10-01T09:00:00Z",
  };
}

function checkOf(
  built: BuiltEntry,
  key: OwnerKey,
  overrides: Partial<AssertionCheck> = {},
): ReturnType<typeof checkAssertion> {
  const choice = chosenWith(built.entry, built.textSha256);
  return checkAssertion(crypto, {
    project: "waves-demo",
    decision: "d1",
    textSha256: built.textSha256,
    entry: choice.entry,
    signature: choice.signature,
    verdict: choice.verdict,
    key,
    ...overrides,
  });
}

describe("the byte helpers", () => {
  it("encodes UTF-8 and hex", () => {
    expect([...utf8Bytes("waves.midnight.lan")]).toHaveLength(18);
    expect(toHex(utf8Bytes("abc"))).toBe("616263");
    expect(toHex(crypto.sha256(utf8Bytes("abc")))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("round-trips base64url without padding, - and _ included", () => {
    const bytes = new Uint8Array([0xfb, 0xff, 0xbf, 0x00, 0x01, 0xfe]);
    const encoded = encodeBase64Url(bytes);
    expect(encoded).not.toMatch(/[+/=]/);
    expect([...decodeBase64Url(encoded)!]).toEqual([...bytes]);
  });

  it("decodes standard base64 with its padding", () => {
    expect([...decodeBase64("AAEC")!]).toEqual([0, 1, 2]);
  });

  it("refuses what is not base64url", () => {
    expect(decodeBase64Url("###")).toBeUndefined();
    expect(decodeBase64Url("abc+def/ghi=")).toBeUndefined();
  });

  it("names each issue at its path, and the root without one", () => {
    expect(
      issuesSentence([
        { path: "/words", message: "expected words" },
        { path: "", message: "expected an object" },
      ]),
    ).toBe("expected words at /words; expected an object");
  });
});

describe("chooseSignedAnswer", () => {
  it("takes the last signed entry of the current revision", () => {
    const key = answerKey();
    const first = signedEntry({ key, position: 0, verdict: "declined" });
    const second = signedEntry({ key, position: 1, verdict: "approved" });
    const choice = chooseSignedAnswer(
      [first.entry, second.entry],
      1,
      second.textSha256,
    );
    expect(choice).toMatchObject({ ok: true, position: 1 });
    if (choice.ok) {
      expect(choice.verdict).toBe("approved");
    }
  });

  it("says none when no entry is signed on the current revision", () => {
    const key = answerKey();
    const signed = signedEntry({ key, revision: 1 });
    const reported = {
      state: "approved",
      source: "reported",
      revision: 1,
      textSha256: signed.textSha256,
      by: "the session",
      at: "2026-10-08T13:00:00Z",
      words: "he said yes",
      index: 0,
      receivedAt: "2026-10-08T13:00:01Z",
    };
    const earlier = signedEntry({ key, revision: 1, position: 0 });
    expect(chooseSignedAnswer([reported], 2, earlier.textSha256)).toEqual({
      ok: false,
      none: true,
    });
    expect(chooseSignedAnswer([], 1, earlier.textSha256)).toEqual({
      ok: false,
      none: true,
    });
  });

  it("refuses an entry whose stored hash is not the recomputed one", () => {
    const built = goodAnswer();
    const choice = chooseSignedAnswer([built.entry], 1, "f".repeat(64));
    expect(choice).toEqual({
      ok: false,
      reason:
        "the signed entry's stored textSha256 does not match the current text",
    });
  });

  it("refuses an entry the contract would not store", () => {
    const built = goodAnswer();
    const broken = { ...built.entry };
    delete broken.signature;
    const choice = chooseSignedAnswer([broken], 1, built.textSha256);
    expect(choice).toMatchObject({ ok: false });
    if (!choice.ok && !("none" in choice)) {
      expect(choice.reason).toContain(
        "the signed entry is not a valid stored state entry",
      );
    }
  });

  it("refuses a signed entry copied to a later position", () => {
    const built = signedEntry({ key: answerKey(), position: 0 });
    const copied = { ...built.entry, index: 3 };
    const choice = chooseSignedAnswer(
      [{ state: "delegated", source: "session" }, copied],
      1,
      built.textSha256,
    );
    expect(choice).toEqual({
      ok: false,
      reason: "the signed entry records index 3 but is stored at position 1",
    });
  });

  it("refuses an entry whose signature binds another index", () => {
    const built = signedEntry({ key: answerKey(), position: 2 });
    const moved = { ...built.entry, index: 0 };
    const choice = chooseSignedAnswer([moved], 1, built.textSha256);
    expect(choice).toEqual({
      ok: false,
      reason:
        "the signed entry's signature binds index 2 but it is stored at position 0",
    });
  });
});

describe("checkAssertion", () => {
  it("accepts an assertion signed over this very answer", () => {
    const key = answerKey();
    const built = signedEntry({ key, words: "Go with B" });
    expect(checkOf(built, keyOf(key.credentialId, key.publicKeySpki))).toEqual({
      ok: true,
    });
  });

  it("refuses clientDataJSON that is not base64url", () => {
    const built = goodAnswer();
    const result = checkOf(built, keyOf("x".repeat(43), "AAAA"), {
      signature: badSignature(built, { clientDataJSON: "###" }),
    });
    expect(result).toEqual({
      ok: false,
      reason: "the assertion's clientDataJSON is not valid base64url",
    });
  });

  it("refuses clientDataJSON that is not a JSON object", () => {
    const built = goodAnswer();
    const notObject = Buffer.from("[]", "utf8").toString("base64url");
    const result = checkOf(built, keyOf("x".repeat(43), "AAAA"), {
      signature: badSignature(built, { clientDataJSON: notObject }),
    });
    expect(result).toEqual({
      ok: false,
      reason: "the assertion's clientDataJSON is not a JSON object",
    });
  });

  it("refuses clientDataJSON that is not JSON at all", () => {
    const built = goodAnswer();
    const notJson = Buffer.from("not json", "utf8").toString("base64url");
    const result = checkOf(built, keyOf("x".repeat(43), "AAAA"), {
      signature: badSignature(built, { clientDataJSON: notJson }),
    });
    expect(result).toEqual({
      ok: false,
      reason: "the assertion's clientDataJSON is not a JSON object",
    });
  });

  it("refuses an assertion whose type is not webauthn.get", () => {
    const key = answerKey();
    const built = signedEntry({
      key,
      clientData: { type: "webauthn.create" },
    });
    expect(checkOf(built, keyOf(key.credentialId, key.publicKeySpki))).toEqual({
      ok: false,
      reason: "the assertion's type is webauthn.create, not webauthn.get",
    });
  });

  it("refuses an assertion from another origin", () => {
    const key = answerKey();
    const built = signedEntry({
      key,
      clientData: { origin: "https://elsewhere.example" },
    });
    expect(checkOf(built, keyOf(key.credentialId, key.publicKeySpki))).toEqual({
      ok: false,
      reason:
        "the assertion's origin is https://elsewhere.example, not https://waves.midnight.lan",
    });
  });

  it("refuses a challenge that binds another verdict, same signature", () => {
    const key = answerKey();
    const built = signedEntry({
      key,
      verdict: "approved",
      challenge: { verdict: "declined" },
    });
    expect(checkOf(built, keyOf(key.credentialId, key.publicKeySpki))).toEqual({
      ok: false,
      reason:
        "the assertion's challenge does not match the challenge of this answer",
    });
  });

  it("refuses authenticatorData that is not base64url", () => {
    const built = goodAnswer();
    const result = checkOf(built, keyOf("x".repeat(43), "AAAA"), {
      signature: badSignature(built, { authenticatorData: "###" }),
    });
    expect(result).toEqual({
      ok: false,
      reason: "the assertion's authenticatorData is not valid base64url",
    });
  });

  it("refuses authenticatorData too short for its flags", () => {
    const built = goodAnswer();
    const short = Buffer.alloc(10).toString("base64url");
    const result = checkOf(built, keyOf("x".repeat(43), "AAAA"), {
      signature: badSignature(built, { authenticatorData: short }),
    });
    expect(result).toEqual({
      ok: false,
      reason:
        "the assertion's authenticatorData is too short to hold its flags",
    });
  });

  it("refuses an rpIdHash of another relying party", () => {
    const key = answerKey();
    const built = signedEntry({ key, rpId: "elsewhere.example" });
    expect(checkOf(built, keyOf(key.credentialId, key.publicKeySpki))).toEqual({
      ok: false,
      reason: "the assertion's rpIdHash is not the hash of waves.midnight.lan",
    });
  });

  it("refuses an assertion without the user-verified bit", () => {
    const key = answerKey();
    const built = signedEntry({ key, flags: 0x01 });
    expect(checkOf(built, keyOf(key.credentialId, key.publicKeySpki))).toEqual({
      ok: false,
      reason:
        "the assertion's flags do not record the user as present and verified",
    });
  });

  it("refuses an assertion without the user-present bit", () => {
    const key = answerKey();
    const built = signedEntry({ key, flags: 0x04 });
    expect(checkOf(built, keyOf(key.credentialId, key.publicKeySpki))).toEqual({
      ok: false,
      reason:
        "the assertion's flags do not record the user as present and verified",
    });
  });

  it("refuses a pinned key whose SPKI is not base64", () => {
    const built = goodAnswer();
    const choice = chosenWith(built.entry, built.textSha256);
    expect(
      checkAssertion(crypto, {
        project: "waves-demo",
        decision: "d1",
        textSha256: built.textSha256,
        entry: choice.entry,
        signature: choice.signature,
        verdict: choice.verdict,
        key: keyOf("x".repeat(43), "###"),
      }),
    ).toEqual({
      ok: false,
      reason: "the pinned key's publicKeySpki is not valid base64",
    });
  });

  it("refuses a signature that is not base64url", () => {
    const built = goodAnswer();
    const result = checkOf(built, keyOf("x".repeat(43), "AAAA"), {
      signature: badSignature(built, { signature: "###" }),
    });
    expect(result).toEqual({
      ok: false,
      reason: "the assertion's signature is not valid base64url",
    });
  });

  it("refuses a signature made by another key", () => {
    const signer = answerKey();
    const built = signedEntry({ key: signer });
    const pinned = answerKey();
    expect(
      checkOf(built, keyOf(signer.credentialId, pinned.publicKeySpki)),
    ).toEqual({
      ok: false,
      reason: "the signature did not verify against the pinned key",
    });
  });

  it("names a pinned key that is not P-256", () => {
    const built = goodAnswer();
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const rsa = publicKey
      .export({ type: "spki", format: "der" })
      .toString("base64");
    expect(checkOf(built, keyOf("x".repeat(43), rsa))).toEqual({
      ok: false,
      reason: "the pinned key for this credential is not a P-256 key",
    });
  });
});

/** A signature of the chosen entry with one field swapped for a broken one. */
function badSignature(
  built: BuiltEntry,
  overrides: Partial<AnswerSignature>,
): AnswerSignature {
  const choice = chosenWith(built.entry, built.textSha256);
  return { ...choice.signature, ...overrides };
}
