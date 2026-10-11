import { generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { Command } from "../src/domain/args.js";
import { readSigned } from "../src/application/read-signed.js";
import type { PinRead } from "../src/application/ports.js";
import { harness, PROJECT } from "./support/harness.js";
import {
  answerKey,
  bindingHashOf,
  decisionDocument,
  decisionRecord,
  pinReadOf,
  signedEntry,
  type AnswerKey,
  type PinnedKey,
} from "./support/signed-answer.js";

type ReadCommand = Extract<
  Command,
  { readonly kind: "decision"; readonly action: "read" }
>;

const PIN_PATH = "/etc/waves/owner-keys.json";

function command(id = "d1"): ReadCommand {
  return { kind: "decision", action: "read", id };
}

interface Run {
  readonly pin: PinRead;
  readonly entries?: readonly unknown[];
  readonly revisions?: readonly unknown[];
  readonly decision?: Record<string, unknown>;
  readonly textSha256?: string;
  readonly id?: string;
}

interface Ran {
  readonly code: number;
  readonly out: readonly string[];
  readonly err: readonly string[];
}

async function verify(run: Run): Promise<Ran> {
  const built = harness({ pins: run.pin });
  const body = decisionRecord({
    entries: run.entries ?? [],
    revisions: run.revisions,
    decision: run.decision,
    textSha256: run.textSha256,
    id: run.id,
  });
  const code = await readSigned(
    command(run.id),
    built.deps,
    JSON.parse(body),
    PROJECT,
  );
  return { code, out: built.out, err: built.err };
}

function expectRefused(ran: Ran, sentence: string, code = 3): void {
  expect(ran.code).toBe(code);
  expect(ran.out).toEqual([]);
  expect(ran.err).toEqual([`waves decision read: ${sentence}`]);
}

/** A run with one signed answer that verifies, to mutate one thing at a time. */
function goodRun(key: AnswerKey, pinned: readonly PinnedKey[]): Run {
  return {
    pin: pinReadOf(pinned),
    entries: [signedEntry({ key, words: "Go with B" }).entry],
  };
}

function keyBy(credentialId: string, publicKeySpki: string): PinnedKey {
  return {
    key: { credentialId, publicKeySpki } as AnswerKey,
    label: "a stand-in key",
  };
}

describe("readSigned", () => {
  it("verifies a signed answer and prints it, exit 0", async () => {
    const key = answerKey();
    const built = signedEntry({ key, option: "b", words: "Go with B" });
    const ran = await verify({
      pin: pinReadOf([{ key, label: "the owner's phone" }]),
      entries: [built.entry],
    });
    expect(ran.code).toBe(0);
    expect(ran.out).toEqual([
      "signed answer: approved",
      "option: b",
      "words: Go with B",
      "signed with: the owner's phone",
      `verified against ${PIN_PATH}`,
    ]);
    expect(ran.err).toEqual([]);
  });

  it("prints no option or words line when the answer carries none", async () => {
    const key = answerKey();
    const built = signedEntry({ key, verdict: "declined" });
    const ran = await verify({
      pin: pinReadOf([{ key, label: "the owner's phone" }]),
      entries: [built.entry],
    });
    expect(ran.code).toBe(0);
    expect(ran.out).toEqual([
      "signed answer: declined",
      "signed with: the owner's phone",
      `verified against ${PIN_PATH}`,
    ]);
  });

  it("still verifies against a retired key, and says so", async () => {
    const key = answerKey();
    const ran = await verify(
      goodRun(key, [{ key, label: "the old phone", retired: true }]),
    );
    expect(ran.code).toBe(0);
    expect(ran.out).toEqual([
      "signed answer: approved",
      "words: Go with B",
      "signed with: the old phone",
      "signed with a retired key",
      `verified against ${PIN_PATH}`,
    ]);
  });

  it("prints a session entry that sits over the answer, exit still 0", async () => {
    const key = answerKey();
    const signed = signedEntry({ key, words: "Go with B" });
    const withdrawn = {
      state: "withdrawn",
      source: "session",
      revision: 1,
      textSha256: signed.textSha256,
      by: "the session",
      at: "2026-10-08T14:00:00Z",
      reason: "fixed another way",
      index: 1,
      receivedAt: "2026-10-08T14:00:01Z",
    };
    const ran = await verify({
      pin: pinReadOf([{ key, label: "the owner's phone" }]),
      entries: [signed.entry, withdrawn],
    });
    expect(ran.code).toBe(0);
    expect(ran.out).toEqual([
      "signed answer: approved",
      "words: Go with B",
      "signed with: the owner's phone",
      `verified against ${PIN_PATH}`,
      "afterwards, a session recorded: withdrawn by the session at 2026-10-08T14:00:00Z",
      "reason: fixed another way",
    ]);
  });

  it("prints only the latest session entry over the answer, without inventing a reason", async () => {
    const key = answerKey();
    const signed = signedEntry({ key, words: "Go with B" });
    const hash = signed.textSha256;
    const noise = [
      "not even an object",
      {
        state: "delegated",
        source: "session",
        revision: 1,
        textSha256: hash,
        by: "the session",
        at: "2026-10-08T14:00:00Z",
        words: "you decide",
        index: 1,
        receivedAt: "2026-10-08T14:00:01Z",
      },
      {
        state: "withdrawn",
        source: "session",
        revision: 2,
        textSha256: hash,
        by: "the session",
        at: "2026-10-08T14:00:00Z",
        reason: "of a later text",
        index: 2,
        receivedAt: "2026-10-08T14:00:01Z",
      },
      {
        state: "withdrawn",
        source: "session",
        revision: 1,
        textSha256: hash,
        by: "the session",
        at: "2026-10-08T15:00:00Z",
        reason: "earlier one",
        index: 4,
        receivedAt: "2026-10-08T15:00:01Z",
      },
      {
        state: "superseded",
        source: "session",
        revision: 1,
        textSha256: hash,
        by: "the session",
        at: "2026-10-08T16:00:00Z",
        supersededBy: "d2",
        index: 5,
        receivedAt: "2026-10-08T16:00:01Z",
      },
    ];
    const ran = await verify({
      pin: pinReadOf([{ key, label: "the owner's phone" }]),
      entries: [signed.entry, ...noise],
    });
    expect(ran.code).toBe(0);
    expect(ran.out).toEqual([
      "signed answer: approved",
      "words: Go with B",
      "signed with: the owner's phone",
      `verified against ${PIN_PATH}`,
      "afterwards, a session recorded: superseded by the session at 2026-10-08T16:00:00Z",
    ]);
    expect(ran.out.join("\n")).not.toContain("earlier one");
    expect(ran.out.join("\n")).not.toContain("of a later text");
  });

  describe("the pin file is checked first", () => {
    it("refuses a missing pin file, even when nothing is signed", async () => {
      const ran = await verify({ pin: { kind: "missing" }, entries: [] });
      expectRefused(ran, `the pin file ${PIN_PATH} is missing`);
    });

    it("refuses a pin file that is a symbolic link", async () => {
      const key = answerKey();
      const ran = await verify({
        pin: {
          kind: "present",
          type: "symlink",
          uid: 0,
          mode: 0o120777,
          text: undefined,
        },
        entries: [signedEntry({ key }).entry],
      });
      expectRefused(ran, `the pin file ${PIN_PATH} is a symbolic link`);
    });

    it("refuses a pin file that is not a regular file", async () => {
      const key = answerKey();
      const ran = await verify({
        pin: {
          kind: "present",
          type: "other",
          uid: 0,
          mode: 0o040755,
          text: undefined,
        },
        entries: [signedEntry({ key }).entry],
      });
      expectRefused(ran, `the pin file ${PIN_PATH} is not a regular file`);
    });

    it("refuses a pin file owned by a non-root uid", async () => {
      const key = answerKey();
      const ran = await verify({
        pin: pinReadOf([{ key, label: "the owner's phone" }], { uid: 1000 }),
        entries: [signedEntry({ key }).entry],
      });
      expectRefused(
        ran,
        `the pin file ${PIN_PATH} is owned by uid 1000, not by root`,
      );
    });

    it("refuses a group-writable pin file", async () => {
      const key = answerKey();
      const ran = await verify({
        pin: pinReadOf([{ key, label: "the owner's phone" }], {
          mode: 0o100660,
        }),
        entries: [signedEntry({ key }).entry],
      });
      expectRefused(
        ran,
        `the pin file ${PIN_PATH} is writable by group or others (mode 0660)`,
      );
    });

    it("refuses a world-writable pin file", async () => {
      const key = answerKey();
      const ran = await verify({
        pin: pinReadOf([{ key, label: "the owner's phone" }], {
          mode: 0o100602,
        }),
        entries: [signedEntry({ key }).entry],
      });
      expectRefused(
        ran,
        `the pin file ${PIN_PATH} is writable by group or others (mode 0602)`,
      );
    });

    it("refuses a pin file that is not valid JSON", async () => {
      const key = answerKey();
      const ran = await verify({
        pin: {
          kind: "present",
          type: "file",
          uid: 0,
          mode: 0o100644,
          text: "not json {",
        },
        entries: [signedEntry({ key }).entry],
      });
      expectRefused(ran, `the pin file ${PIN_PATH} is not valid JSON`);
    });

    it("refuses a pin file with no text at all", async () => {
      const key = answerKey();
      const ran = await verify({
        pin: {
          kind: "present",
          type: "file",
          uid: 0,
          mode: 0o100644,
          text: undefined,
        },
        entries: [signedEntry({ key }).entry],
      });
      expectRefused(ran, `the pin file ${PIN_PATH} is not valid JSON`);
    });

    it("refuses a pin file the owner-keys document rules refuse", async () => {
      const ran = await verify({
        pin: {
          kind: "present",
          type: "file",
          uid: 0,
          mode: 0o100644,
          text: JSON.stringify({ schema: "waves-owner-keys/v1", keys: [] }),
        },
        entries: [],
      });
      expectRefused(
        ran,
        `the pin file ${PIN_PATH} is not a valid owner-keys document: expected at least 1 key at /keys`,
      );
    });
  });

  describe("no signed answer on the current text", () => {
    it("exits 4 when no entry is signed", async () => {
      const key = answerKey();
      const ran = await verify({
        pin: pinReadOf([{ key, label: "l" }]),
        entries: [],
      });
      expectRefused(ran, "no signed answer on the current text", 4);
    });

    it("exits 4 when only a reported answer is on the current text", async () => {
      const key = answerKey();
      const hash = signedEntry({ key }).textSha256;
      const reported = {
        state: "approved",
        source: "reported",
        revision: 1,
        textSha256: hash,
        by: "the session",
        at: "2026-10-08T13:00:00Z",
        words: "he said yes",
        index: 0,
        receivedAt: "2026-10-08T13:00:01Z",
      };
      const ran = await verify({
        pin: pinReadOf([{ key, label: "l" }]),
        entries: [reported],
      });
      expectRefused(ran, "no signed answer on the current text", 4);
    });

    it("exits 4 when the signed answer is on a previous text", async () => {
      const key = answerKey();
      const earlier = decisionDocument();
      const current = { ...decisionDocument(), question: "And now, what?" };
      const onEarlier = signedEntry({ key, decision: earlier, revision: 1 });
      const ran = await verify({
        pin: pinReadOf([{ key, label: "l" }]),
        entries: [onEarlier.entry],
        revisions: [
          {
            revision: 1,
            textSha256: onEarlier.textSha256,
            receivedAt: "2026-10-08T12:00:01Z",
            decision: earlier,
          },
          {
            revision: 2,
            textSha256: bindingHashOf(current),
            receivedAt: "2026-10-08T12:30:01Z",
            decision: current,
          },
        ],
      });
      expectRefused(ran, "no signed answer on the current text", 4);
    });

    it("exits 4 when the record holds no revision at all", async () => {
      const key = answerKey();
      const ran = await verify({
        pin: pinReadOf([{ key, label: "l" }]),
        entries: [],
        revisions: [],
      });
      expectRefused(ran, "no signed answer on the current text", 4);
    });
  });

  describe("the current revision is verified from its own text", () => {
    it("refuses a current revision that is not an object", async () => {
      const key = answerKey();
      const ran = await verify({
        pin: pinReadOf([{ key, label: "l" }]),
        entries: [],
        revisions: ["not a revision"],
      });
      expectRefused(ran, "the record's current revision is not an object");
    });

    it("refuses a current revision the contract refuses", async () => {
      const key = answerKey();
      const ran = await verify({
        pin: pinReadOf([{ key, label: "l" }]),
        entries: [],
        decision: {},
        textSha256: "0".repeat(64),
      });
      expect(ran.code).toBe(3);
      expect(ran.err[0]).toContain(
        "the current revision is not a valid decision:",
      );
    });

    it("refuses a text that changed while its stored hash was kept", async () => {
      const key = answerKey();
      const onOldText = signedEntry({ key });
      const changed = { ...decisionDocument(), question: "Reworded?" };
      const ran = await verify({
        pin: pinReadOf([{ key, label: "l" }]),
        entries: [onOldText.entry],
        decision: changed,
        textSha256: onOldText.textSha256,
      });
      expectRefused(
        ran,
        "the revision's stored textSha256 does not match its own text",
      );
    });

    it("refuses a stored hash that changed while the text was kept", async () => {
      const key = answerKey();
      const onOldText = signedEntry({ key });
      const ran = await verify({
        pin: pinReadOf([{ key, label: "l" }]),
        entries: [onOldText.entry],
        revisions: [
          {
            revision: 1,
            textSha256: "0".repeat(64),
            receivedAt: "2026-10-08T12:00:01Z",
            decision: decisionDocument(),
          },
        ],
      });
      expectRefused(
        ran,
        "the revision's stored textSha256 does not match its own text",
      );
    });
  });

  describe("the signed entry is held to its own record", () => {
    it("refuses an entry whose stored hash is not the recomputed one", async () => {
      const key = answerKey();
      const built = signedEntry({ key });
      const stale = { ...built.entry, textSha256: "f".repeat(64) };
      const ran = await verify({
        pin: pinReadOf([{ key, label: "l" }]),
        entries: [stale],
      });
      expectRefused(
        ran,
        "the signed entry's stored textSha256 does not match the current text",
      );
    });

    it("refuses a signed entry copied to a later position", async () => {
      const key = answerKey();
      const built = signedEntry({ key, position: 0 });
      const filler = {
        state: "delegated",
        source: "session",
        revision: 1,
        textSha256: built.textSha256,
        by: "the session",
        at: "2026-10-08T14:00:00Z",
        words: "you decide",
        index: 0,
        receivedAt: "2026-10-08T14:00:01Z",
      };
      const ran = await verify({
        pin: pinReadOf([{ key, label: "l" }]),
        entries: [filler, built.entry],
      });
      expectRefused(
        ran,
        "the signed entry records index 0 but is stored at position 1",
      );
    });
  });

  describe("the assertion is checked against the pin", () => {
    it("refuses a credential the pin does not hold", async () => {
      const key = answerKey();
      const other = answerKey();
      const ran = await verify(goodRun(key, [{ key: other, label: "l" }]));
      expectRefused(ran, `no pinned key has credential id ${key.credentialId}`);
    });

    it("refuses a signature made by another key than the pinned one", async () => {
      const signer = answerKey();
      const standIn = answerKey();
      const ran = await verify(
        goodRun(signer, [keyBy(signer.credentialId, standIn.publicKeySpki)]),
      );
      expectRefused(ran, "the signature did not verify against the pinned key");
    });

    it("refuses an assertion from another origin", async () => {
      const key = answerKey();
      const built = signedEntry({
        key,
        clientData: { origin: "https://elsewhere.example" },
      });
      const ran = await verify({
        pin: pinReadOf([{ key, label: "l" }]),
        entries: [built.entry],
      });
      expectRefused(
        ran,
        "the assertion's origin is https://elsewhere.example, not https://waves.midnight.lan",
      );
    });

    it("refuses an assertion whose type is not webauthn.get", async () => {
      const key = answerKey();
      const built = signedEntry({
        key,
        clientData: { type: "webauthn.create" },
      });
      const ran = await verify({
        pin: pinReadOf([{ key, label: "l" }]),
        entries: [built.entry],
      });
      expectRefused(
        ran,
        "the assertion's type is webauthn.create, not webauthn.get",
      );
    });

    it("refuses an assertion of another relying party", async () => {
      const key = answerKey();
      const built = signedEntry({ key, rpId: "elsewhere.example" });
      const ran = await verify({
        pin: pinReadOf([{ key, label: "l" }]),
        entries: [built.entry],
      });
      expectRefused(
        ran,
        "the assertion's rpIdHash is not the hash of waves.midnight.lan",
      );
    });

    it("refuses an assertion without the user-verified bit", async () => {
      const key = answerKey();
      const built = signedEntry({ key, flags: 0x01 });
      const ran = await verify({
        pin: pinReadOf([{ key, label: "l" }]),
        entries: [built.entry],
      });
      expectRefused(
        ran,
        "the assertion's flags do not record the user as present and verified",
      );
    });

    it("refuses a challenge that binds another verdict, same signature", async () => {
      const key = answerKey();
      const built = signedEntry({
        key,
        verdict: "approved",
        challenge: { verdict: "declined" },
      });
      const ran = await verify({
        pin: pinReadOf([{ key, label: "l" }]),
        entries: [built.entry],
      });
      expectRefused(
        ran,
        "the assertion's challenge does not match the challenge of this answer",
      );
    });

    it("names a pinned key that is not P-256", async () => {
      const key = answerKey();
      const { publicKey } = generateKeyPairSync("ec", {
        namedCurve: "secp384r1",
      });
      const spki = publicKey
        .export({ type: "spki", format: "der" })
        .toString("base64");
      const ran = await verify(goodRun(key, [keyBy(key.credentialId, spki)]));
      expectRefused(
        ran,
        "the pinned key for this credential is not a P-256 key",
      );
    });
  });
});
