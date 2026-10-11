import { Buffer } from "node:buffer";
import { createHash, webcrypto } from "node:crypto";

import { describe, expect, it } from "vitest";

import { decisionBindingText } from "@hexagen-monaco/waves-contract";
import {
  answerChallengeText as contractChallengeText,
  validateAnswerRequest,
} from "@hexagen-monaco/waves-contract";

import {
  answerBody,
  answerChallengeText,
  bindingText,
  challengeBytes,
  sha256Hex,
} from "../../public/answer-challenge.js";
import {
  NOTICE_DECISIONS,
  type NoticeFixture,
} from "../../../contract/__tests__/fixtures/notice-decisions.js";
import { buildAssertion, type Built } from "../assertion-helper.js";
import {
  EXPECTED_ORIGIN,
  verifyAssertion,
} from "../../src/infrastructure/assertion-verifier.js";

const subtle = webcrypto.subtle as unknown as SubtleCrypto;

/** Every revision of every fixture decision, the texts the page may bind. */
function fixtureDecisions(): Record<string, unknown>[] {
  return NOTICE_DECISIONS.flatMap((fixture: NoticeFixture) =>
    fixture.revisions.map((rev) => rev),
  );
}

/** A minimal decision, in the shape the fixtures build. */
function decision(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schema: "waves-notice/v1",
    kind: "decision",
    project: "waves",
    id: "a-decision",
    shape: "choice",
    question: "Question?",
    options: [
      { key: "a", text: "Yes", cost: "C1" },
      { key: "b", text: "No", cost: "C2" },
    ],
    hardToUndo: { value: false },
    commits: [],
    decider: "owner",
    appliesTo: [],
    evidence: [],
    raisedBy: "session",
    raisedAt: "2026-10-08T12:00:00Z",
    ...overrides,
  };
}

const HAND_MADE_DECISIONS: Record<string, unknown>[] = [
  decision(),
  decision({ recommended: { option: "a", reason: "cheapest first" } }),
  decision({ hardToUndo: { value: true } }),
  decision({ hardToUndo: { value: true, reason: "cannot be undone" } }),
  decision({ hardToUndo: { value: false, reason: "only a message" } }),
  decision({ hardToUndo: { value: "partly" } }),
  decision({
    hardToUndo: { value: "partly", reason: "the deletion cannot be undone" },
  }),
  decision({
    actElsewhere: { where: "your terminal", what: "yarn purge:org --apply" },
  }),
  decision({ question: 'A "quote", a \\ backslash and a\nnewline' }),
  decision({ question: "An emoji 🌊 and العربية script" }),
  decision({ question: "a U+2028\u2028 separator in the question" }),
  decision({ options: [] }),
  decision({ commits: ["one commitment", "another commitment"] }),
  decision({ appliesTo: ["campaign-foundry", "fleet"] }),
];

describe("bindingText", () => {
  it("matches the contract's decisionBindingText for every fixture revision", () => {
    for (const rev of fixtureDecisions()) {
      expect(bindingText(rev as never)).toBe(decisionBindingText(rev as never));
    }
  });

  it("matches the contract's decisionBindingText for the hand-made cases", () => {
    for (const rev of HAND_MADE_DECISIONS) {
      expect(bindingText(rev as never)).toBe(decisionBindingText(rev as never));
    }
  });

  it("keeps an extra key of the caller's object out of the text", () => {
    const d = HAND_MADE_DECISIONS[0]!;
    const withInjected = { ...d, injected: "x" } as Record<string, unknown>;
    expect(bindingText(withInjected as never)).toBe(bindingText(d as never));
  });
});

describe("answerChallengeText", () => {
  const base = {
    project: "alpha",
    decision: "ship-it",
    textSha256: "0f".repeat(32),
    index: 3,
    verdict: "approved" as const,
    nonce: "n".repeat(43),
  };

  const TABLE: Record<string, unknown>[] = [
    { ...base },
    { ...base, verdict: "declined" },
    { ...base, verdict: "answered" },
    { ...base, option: "a" },
    { ...base, option: "a", verdict: "answered" },
    { ...base, words: "in my own words" },
    { ...base, verdict: "answered", words: "in my own words" },
    { ...base, index: 0 },
    { ...base, index: 69 },
    { ...base, words: 'words with "quotes" and café ☕' },
  ];

  it("matches the contract's answerChallengeText over the table", () => {
    for (const values of TABLE) {
      expect(answerChallengeText(values as never)).toBe(
        contractChallengeText(values as never),
      );
    }
  });

  it("keeps an extra key of the caller's object out of the text", () => {
    const withV = { ...base, v: "other" } as Record<string, unknown>;
    expect(answerChallengeText(withV as never)).toBe(answerChallengeText(base));
  });
});

describe("sha256Hex and challengeBytes", () => {
  const TEXTS = [
    "",
    "the answer page signs this",
    "héllo — ünïcode ☕ العربية",
  ];

  it("sha256Hex equals node:crypto's hex", async () => {
    for (const text of TEXTS) {
      const expected = createHash("sha256").update(text, "utf8").digest("hex");
      expect(await sha256Hex(subtle, text)).toBe(expected);
    }
  });

  it("challengeBytes equals node:crypto's digest", async () => {
    for (const text of TEXTS) {
      const expected = createHash("sha256").update(text, "utf8").digest();
      const bytes = await challengeBytes(subtle, text);
      expect(Buffer.from(bytes).toString("hex")).toBe(expected.toString("hex"));
      expect(bytes).toHaveLength(32);
    }
  });
});

/** The bytes a base64url string spells, as an ArrayBuffer the way a browser
 * hands an assertion's byte strings over. */
function bufferOf(base64urlText: string): ArrayBuffer {
  const bytes = Buffer.from(base64urlText, "base64url");
  const out = new ArrayBuffer(bytes.length);
  new Uint8Array(out).set(bytes);
  return out;
}

/** An assertion shaped the way the browser returns it, from the helper's
 * base64url strings. */
function browserAssertion(input: {
  readonly credentialId: string;
  readonly authenticatorData: string;
  readonly clientDataJSON: string;
  readonly signature: string;
}) {
  return {
    rawId: bufferOf(input.credentialId),
    response: {
      authenticatorData: bufferOf(input.authenticatorData),
      clientDataJSON: bufferOf(input.clientDataJSON),
      signature: bufferOf(input.signature),
    },
  };
}

/** The values the whole end-to-end flow signs with: the challenge fields the
 * page binds, with a nonce that is canonical base64url so the contract's
 * answer-request rules accept the body it goes into. */
const VALUES = {
  project: "alpha",
  decision: "ship-it",
  textSha256: "0f".repeat(32),
  index: 3,
  verdict: "approved",
  nonce: "A".repeat(43),
} as const;

const PAGE_TEXT = answerChallengeText(VALUES);

const BODY_VALUES = {
  revision: 1,
  textSha256: VALUES.textSha256,
  index: VALUES.index,
  verdict: VALUES.verdict,
  nonce: VALUES.nonce,
};

/**
 * A good assertion over the page's own challenge text, built the way the
 * browser would: the client data's `challenge` is the base64url of SHA-256
 * of the text, which is what the server checks it against.
 */
function signedOverPageText(): Built {
  const challenge = createHash("sha256").update(PAGE_TEXT, "utf8").digest();
  const clientData = {
    type: "webauthn.get",
    origin: EXPECTED_ORIGIN,
    challenge: challenge.toString("base64url"),
    crossOrigin: false,
  };
  return buildAssertion({
    clientDataBytes: Buffer.from(JSON.stringify(clientData), "utf8"),
  });
}

describe("answerBody against the real verifier", () => {
  const built = signedOverPageText();

  it("is the challenge text the contract builds from the same values", () => {
    expect(PAGE_TEXT).toBe(contractChallengeText(VALUES));
  });

  const body = answerBody(BODY_VALUES, browserAssertion(built.input));

  it("is an answer request the contract accepts", () => {
    const result = validateAnswerRequest(body);
    if (!result.ok) {
      throw new Error(JSON.stringify(result.errors));
    }
    expect(result.ok).toBe(true);
  });

  it("carries the assertion's fields as it was given them", () => {
    expect(body).toEqual({
      revision: 1,
      textSha256: VALUES.textSha256,
      index: 3,
      verdict: "approved",
      nonce: "A".repeat(43),
      credentialId: built.input.credentialId,
      authenticatorData: built.input.authenticatorData,
      clientDataJSON: built.input.clientDataJSON,
      signature: built.input.signature,
    });
  });

  it("verifies against the signer's key for the same challenge text", () => {
    const result = verifyAssertion(built.input, PAGE_TEXT, built.keys);
    expect(result.ok).toBe(true);
  });

  it("refuses a challenge text with a different verdict", () => {
    const other = answerChallengeText({ ...VALUES, verdict: "declined" });
    expect(verifyAssertion(built.input, other, built.keys)).toEqual({
      ok: false,
      reason: "wrong-challenge",
    });
  });

  it("refuses a challenge text with a different index", () => {
    const other = answerChallengeText({ ...VALUES, index: 4 });
    expect(verifyAssertion(built.input, other, built.keys)).toEqual({
      ok: false,
      reason: "wrong-challenge",
    });
  });

  it("refuses a challenge text with a different textSha256", () => {
    const other = answerChallengeText({
      ...VALUES,
      textSha256: "1f".repeat(32),
    });
    expect(verifyAssertion(built.input, other, built.keys)).toEqual({
      ok: false,
      reason: "wrong-challenge",
    });
  });
});

describe("answerBody's keys and encoding", () => {
  /** Fixed bytes whose plain base64 carries `+`, `/` and `=`. */
  const OPAQUE = [
    Buffer.from([0xfb]),
    Buffer.from([0xfb, 0xff]),
    Buffer.from([0xfb, 0xff, 0xfe]),
  ];
  const encoded = OPAQUE.map((bytes) => bytes.toString("base64url"));

  function assertionOver(i: number) {
    return {
      rawId: bufferOf(encoded[i]!),
      response: {
        authenticatorData: bufferOf(encoded[i]!),
        clientDataJSON: bufferOf(encoded[i]!),
        signature: bufferOf(encoded[i]!),
      },
    };
  }

  it("leaves option and words out when absent", () => {
    const body = answerBody(BODY_VALUES, assertionOver(2));
    expect(Object.keys(body)).toEqual([
      "revision",
      "textSha256",
      "index",
      "verdict",
      "nonce",
      "credentialId",
      "authenticatorData",
      "clientDataJSON",
      "signature",
    ]);
  });

  it("carries option when present and words when absent", () => {
    const body = answerBody({ ...BODY_VALUES, option: "a" }, assertionOver(0));
    expect(Object.keys(body)).toEqual([
      "revision",
      "textSha256",
      "index",
      "verdict",
      "option",
      "nonce",
      "credentialId",
      "authenticatorData",
      "clientDataJSON",
      "signature",
    ]);
  });

  it("carries words when present and option when absent", () => {
    const body = answerBody(
      { ...BODY_VALUES, words: "in my own words" },
      assertionOver(1),
    );
    expect(Object.keys(body)).toEqual([
      "revision",
      "textSha256",
      "index",
      "verdict",
      "words",
      "nonce",
      "credentialId",
      "authenticatorData",
      "clientDataJSON",
      "signature",
    ]);
  });

  it("carries option and words when both are present", () => {
    const body = answerBody(
      { ...BODY_VALUES, option: "a", words: "in my own words" },
      assertionOver(2),
    );
    expect(Object.keys(body)).toEqual([
      "revision",
      "textSha256",
      "index",
      "verdict",
      "option",
      "words",
      "nonce",
      "credentialId",
      "authenticatorData",
      "clientDataJSON",
      "signature",
    ]);
  });

  it("spells every byte string as base64url with no =, + or /", () => {
    for (let i = 0; i < OPAQUE.length; i++) {
      const body = answerBody(BODY_VALUES, assertionOver(i));
      for (const field of [
        body.credentialId,
        body.authenticatorData,
        body.clientDataJSON,
        body.signature,
      ]) {
        expect(field).toBe(encoded[i]);
        expect(field).not.toMatch(/[=+/]/);
      }
    }
  });
});
