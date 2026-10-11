import { Buffer } from "node:buffer";
import { createHash, webcrypto } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  answerChallengeText as contractAnswerChallengeText,
  decisionBindingText,
  MAX_TEXT_CHARS,
  validateAnswerRequest,
} from "@hexagen-monaco/waves-contract";
import type { DecisionRevision } from "@hexagen-monaco/waves-contract";

import {
  answerability,
  choiceOf,
  createAnswerer,
  prepareWords,
  probeAnswering,
} from "../../public/answer.js";
import type {
  AnswerFetch,
  AnswerOutcome,
  Choice,
} from "../../public/answer.js";
import { drawableDecision } from "../../public/decision.js";
import { decisionModel } from "../../public/views/decision-model.js";
import type { DecisionModel } from "../../public/views/decision-model.js";
import { buildAssertion, type Built } from "../assertion-helper.js";
import {
  EXPECTED_ORIGIN,
  RELYING_PARTY_ID,
  verifyAssertion,
} from "../../src/infrastructure/assertion-verifier.js";
import type { AssertionInput } from "../../src/infrastructure/assertion-verifier.js";
import type { Head } from "../../src/application/notice-read-model.js";
import { NONCE_TTL_MS } from "../../src/application/nonce-store.js";
import {
  decisionEntry,
  decisionRevision,
  decisionResponse,
  inboxHead,
  storedRevision,
} from "./fixtures.js";

/**
 * The answer ceremony's own tests: every faked browser object is handed to the
 * controller, and every outcome is checked against exactly what the buttons may
 * be told. The assertion the passkey fake returns is real — a P-256 signature
 * over the very challenge it was given — so the bytes the page signs are held
 * to the contract's own challenge text and the server's own verifier.
 */

const PROJECT = "alpha";
const ID = "d1";
/** A nonce in the one spelling the contract's answer rules accept. */
const NONCE = "A".repeat(43);
/** The page's own entry count for the model below: one earlier, one current. */
const ENTRY_COUNT = 2;
/** The fixed seat the page signs from: this host, this relying party. */
const LOCATION = { hostname: RELYING_PARTY_ID, origin: EXPECTED_ORIGIN };
const subtle = webcrypto.subtle as unknown as SubtleCrypto;
const NONCE_PATH = `/api/v1/projects/${PROJECT}/decisions/${ID}/nonce`;
const ANSWERS_PATH = `/api/v1/projects/${PROJECT}/decisions/${ID}/answers`;

/** The contract's hash of one decision revision's binding text. */
function bindingHash(decision: DecisionRevision): string {
  return createHash("sha256")
    .update(decisionBindingText(decision), "utf8")
    .digest("hex");
}

const OLD_DECISION = decisionRevision({ question: "Ship it?" });
const CURRENT_HASH = bindingHash(
  decisionRevision({ question: "Ship the release?" }),
);

/**
 * The decision page's own fixture: two revisions with different texts, one
 * entry on each, and a head that agrees with the last revision. The stored
 * hash is the real binding hash of the current revision unless a test says
 * otherwise, so the happy path is the one page the server would accept.
 */
function viewOf(
  headOverrides: Partial<Head> = {},
  currentOverrides: Partial<DecisionRevision> = {},
  storedHash?: string,
) {
  const current = decisionRevision({
    question: "Ship the release?",
    ...currentOverrides,
  });
  const oldHash = bindingHash(OLD_DECISION);
  const currentHash = storedHash ?? bindingHash(current);
  return decisionResponse({
    head: inboxHead({
      revision: 2,
      revisions: 2,
      entries: 2,
      textSha256: currentHash,
      ...headOverrides,
    }),
    revisions: [
      storedRevision({
        revision: 1,
        textSha256: oldHash,
        receivedAt: "2026-10-07T12:00:00Z",
        decision: OLD_DECISION,
      }),
      storedRevision({
        revision: 2,
        textSha256: currentHash,
        receivedAt: "2026-10-08T12:00:00Z",
        decision: current,
      }),
    ],
    entries: [
      decisionEntry({ index: 0, revision: 1, textSha256: oldHash }),
      decisionEntry({ index: 1, revision: 2, textSha256: currentHash }),
    ],
  });
}

/** The model, from a response the page's own shape check accepts. */
function modelOf(
  headOverrides: Partial<Head> = {},
  currentOverrides: Partial<DecisionRevision> = {},
  storedHash?: string,
): DecisionModel {
  const view = viewOf(headOverrides, currentOverrides, storedHash);
  if (!drawableDecision(view, PROJECT, ID)) {
    throw new Error("the fixture is not a decision the page can draw");
  }
  return decisionModel(view);
}

/** A `fetch` that records every call and answers from a script. */
type Reply =
  | {
      readonly status: number;
      readonly body?: unknown;
      readonly jsonThrows?: boolean;
    }
  | { readonly reject: true };

type Scripted = Reply | (() => Reply | Promise<Reply>);

interface RecordedCall {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}

function recordingFetch(script: readonly Scripted[]) {
  const calls: RecordedCall[] = [];
  let at = 0;
  const fetchLike = async (
    path: string,
    init?: {
      readonly method?: string;
      readonly headers?: Readonly<Record<string, string>>;
      readonly body?: string;
    },
  ): Promise<{ readonly status: number; json(): Promise<unknown> }> => {
    const entry = script[at];
    at += 1;
    calls.push({
      method: init?.method ?? "GET",
      path,
      headers: { ...(init?.headers ?? {}) },
      ...(init?.body !== undefined ? { body: init.body } : {}),
    });
    if (entry === undefined) {
      throw new Error(`unexpected fetch call ${at - 1}`);
    }
    const reply = typeof entry === "function" ? await entry() : entry;
    if ("reject" in reply) {
      throw new Error("the network is down");
    }
    return {
      status: reply.status,
      json: async () => {
        if (reply.jsonThrows) {
          throw new Error("not JSON");
        }
        return reply.body;
      },
    };
  };
  return { fetch: fetchLike as AnswerFetch, calls };
}

/** A `credentials` whose `get` records its options and answers from a handler. */
type GetFn = (options: CredentialRequestOptions) => unknown;

function recordingCredentials(handler: GetFn) {
  const calls: CredentialRequestOptions[] = [];
  const credentials = {
    async get(options: CredentialRequestOptions): Promise<unknown> {
      calls.push(options);
      return handler(options);
    },
  };
  return { credentials, calls };
}

/** The bytes a base64url string spells, as an ArrayBuffer the browser hands over. */
function bufferOf(base64urlText: string): ArrayBuffer {
  const bytes = Buffer.from(base64urlText, "base64url");
  const out = new ArrayBuffer(bytes.length);
  new Uint8Array(out).set(bytes);
  return out;
}

/** An assertion shaped the way the browser returns one: ArrayBuffers. */
function browserAssertion(input: AssertionInput): unknown {
  return {
    rawId: bufferOf(input.credentialId),
    response: {
      authenticatorData: bufferOf(input.authenticatorData),
      clientDataJSON: bufferOf(input.clientDataJSON),
      signature: bufferOf(input.signature),
    },
  };
}

/** The same assertion with views over the bytes, which the page also accepts. */
function viewAssertion(input: AssertionInput): unknown {
  const view = (text: string) => new Uint8Array(Buffer.from(text, "base64url"));
  return {
    rawId: view(input.credentialId),
    response: {
      authenticatorData: view(input.authenticatorData),
      clientDataJSON: view(input.clientDataJSON),
      signature: view(input.signature),
    },
  };
}

/**
 * A real P-256 assertion over the challenge it was given: the client data
 * carries the base64url of exactly those bytes, and the signature covers the
 * authenticator data and the client data, as the server's verifier reads them.
 */
function assertionFor(challenge: Uint8Array, seed: string): Built {
  const clientData = {
    type: "webauthn.get",
    origin: EXPECTED_ORIGIN,
    challenge: Buffer.from(challenge).toString("base64url"),
    crossOrigin: false,
  };
  return buildAssertion({
    clientDataBytes: Buffer.from(JSON.stringify(clientData), "utf8"),
    credentialSeed: seed,
  });
}

/** A passkey that signs whatever challenge it is handed, and keeps its keys. */
function passkeyFor(seed: string) {
  let made: Built | undefined;
  const handler: GetFn = (options) => {
    const pk = (options as unknown as { publicKey: { challenge: Uint8Array } })
      .publicKey;
    made = assertionFor(pk.challenge, seed);
    return browserAssertion(made.input);
  };
  return {
    handler,
    made: (): Built => {
      if (made === undefined) {
        throw new Error("the passkey was never asked");
      }
      return made;
    },
  };
}

/** The nonce reply that agrees with the page's own count. */
const GOOD_NONCE: Reply = {
  status: 200,
  body: { nonce: NONCE, index: ENTRY_COUNT },
};

function okChoice(word: "yes" | "no" | "words", raw = ""): Choice {
  const result = choiceOf(word, raw);
  if (!result.ok) {
    throw new Error("the fixture choice was refused");
  }
  return result.choice;
}

/** One `sign` through a scripted fetch and a passkey handler, with the calls. */
async function signWith(
  model: DecisionModel,
  choice: Choice,
  script: readonly Scripted[],
  handler: GetFn,
) {
  const wired = recordingFetch(script);
  const creds = recordingCredentials(handler);
  const answerer = createAnswerer({
    fetch: wired.fetch,
    credentials: creds.credentials,
    subtle,
    location: LOCATION,
  });
  return {
    calls: wired.calls,
    getCalls: creds.calls,
    outcome: await answerer.sign(model, choice),
  };
}

/** The challenge the passkey was handed, as bytes. */
function challengeOf(
  getCalls: readonly CredentialRequestOptions[],
): Uint8Array {
  const first = getCalls[0];
  if (first === undefined) {
    throw new Error("the passkey was never asked");
  }
  return (first as unknown as { publicKey: { challenge: Uint8Array } })
    .publicKey.challenge;
}

describe("answerability", () => {
  it("says answerable for a waiting decision", () => {
    expect(answerability(modelOf())).toStrictEqual({ kind: "answerable" });
  });

  it("says answerable for a reported one, signed or not", () => {
    expect(
      answerability(
        modelOf({ group: "reported", state: "answered", source: "reported" }),
      ),
    ).toStrictEqual({ kind: "answerable" });
  });

  it("says closed for a closed or history group", () => {
    expect(
      answerability(modelOf({ group: "closed", state: "withdrawn" })),
    ).toStrictEqual({ kind: "no", reason: "closed" });
    expect(answerability(modelOf({ group: "history" }))).toStrictEqual({
      kind: "no",
      reason: "closed",
    });
  });

  it("says one-way-door for a door that is true or partly", () => {
    expect(
      answerability(
        modelOf({}, { hardToUndo: { value: true, reason: "gone for good" } }),
      ),
    ).toStrictEqual({ kind: "no", reason: "one-way-door" });
    expect(
      answerability(modelOf({}, { hardToUndo: { value: "partly" } })),
    ).toStrictEqual({ kind: "no", reason: "one-way-door" });
  });

  it("says act-elsewhere for an instruction acted on elsewhere", () => {
    expect(
      answerability(
        modelOf(
          {},
          { actElsewhere: { where: "your terminal", what: "yarn purge" } },
        ),
      ),
    ).toStrictEqual({ kind: "no", reason: "act-elsewhere" });
  });

  it("checks the group before the door", () => {
    expect(
      answerability(
        modelOf(
          { group: "closed", state: "withdrawn" },
          { hardToUndo: { value: true } },
        ),
      ),
    ).toStrictEqual({ kind: "no", reason: "closed" });
  });
});

describe("probeAnswering", () => {
  const CASES: [string, Reply, boolean][] = [
    ["true when the nonce path answers 405", { status: 405 }, true],
    ["false for a 404", { status: 404 }, false],
    [
      "false for a 200",
      { status: 200, body: { nonce: NONCE, index: 0 } },
      false,
    ],
    ["false for a 401", { status: 401 }, false],
    ["false for a 500", { status: 500 }, false],
    ["false for a rejected fetch", { reject: true }, false],
  ];

  for (const [name, reply, expected] of CASES) {
    it(`is ${expected} — ${name}`, async () => {
      const wired = recordingFetch([reply]);
      expect(await probeAnswering(wired.fetch, PROJECT, ID)).toBe(expected);
      expect(wired.calls).toStrictEqual([
        {
          method: "GET",
          path: NONCE_PATH,
          headers: { accept: "application/json" },
        },
      ]);
    });
  }

  it("builds the path with encodeURIComponent", async () => {
    const wired = recordingFetch([{ status: 405 }]);
    await probeAnswering(wired.fetch, "pro ject", "de cision");
    expect(wired.calls[0]?.path).toBe(
      "/api/v1/projects/pro%20ject/decisions/de%20cision/nonce",
    );
  });
});

describe("prepareWords", () => {
  it("normalises to NFC", () => {
    expect(prepareWords("e\u0301tape")).toStrictEqual({
      ok: true,
      words: "\u00e9tape",
    });
  });

  it("strips surrounding white space and keeps inner white space", () => {
    expect(prepareWords("\n  hello  there \n")).toStrictEqual({
      ok: true,
      words: "hello  there",
    });
  });

  it("strips U+0085 at the ends and keeps it inside", () => {
    expect(prepareWords("\u0085 yes \u0085")).toStrictEqual({
      ok: true,
      words: "yes",
    });
    expect(prepareWords("\u0085")).toStrictEqual({
      ok: false,
      reason: "empty",
    });
    expect(prepareWords("a\u0085b")).toStrictEqual({
      ok: true,
      words: "a\u0085b",
    });
  });

  it("refuses what is empty after normalising and trimming", () => {
    expect(prepareWords("")).toStrictEqual({ ok: false, reason: "empty" });
    expect(prepareWords("  \n ")).toStrictEqual({ ok: false, reason: "empty" });
  });

  it("accepts exactly the contract's maximum for words and refuses one over", () => {
    // The contract's rule for `words` is TEXT_RULE, whose bound is
    // MAX_TEXT_CHARS; the page copies that number into MAX_WORDS_CHARS, and
    // this holds the two together: the boundary is asked at the contract's
    // own number, so they cannot drift apart.
    expect(MAX_TEXT_CHARS).toBe(2000);
    const atTheBound = "x".repeat(MAX_TEXT_CHARS);
    expect(prepareWords(atTheBound)).toStrictEqual({
      ok: true,
      words: atTheBound,
    });
    expect(prepareWords(`${atTheBound}x`)).toStrictEqual({
      ok: false,
      reason: "too-long",
    });
  });

  it("refuses a control character inside the words before he signs", () => {
    // The server refuses `words` holding any character the contract's
    // isControlCode refuses — below 0x20 or 0x7f itself — so the page must
    // refuse them before the passkey is ever asked, not after.
    expect(prepareWords("a\nb")).toStrictEqual({
      ok: false,
      reason: "not-printable",
    });
    expect(prepareWords("a\tb")).toStrictEqual({
      ok: false,
      reason: "not-printable",
    });
    expect(prepareWords("a\u007fb")).toStrictEqual({
      ok: false,
      reason: "not-printable",
    });
    expect(prepareWords("a\u0000b")).toStrictEqual({
      ok: false,
      reason: "not-printable",
    });
    // U+0085 is above the refused range and stays allowed inside.
    expect(prepareWords("a\u0085b")).toStrictEqual({
      ok: true,
      words: "a\u0085b",
    });
    // The edges are stripped first, so newlines around the words are fine.
    expect(prepareWords(" \n yes \n ")).toStrictEqual({
      ok: true,
      words: "yes",
    });
    expect(choiceOf("words", "a\nb")).toStrictEqual({
      ok: false,
      reason: "not-printable",
    });
  });
});

describe("choiceOf", () => {
  it("maps yes to approved and no to declined, with no words of their own", () => {
    expect(choiceOf("yes", "")).toStrictEqual({
      ok: true,
      choice: { verdict: "approved" },
    });
    expect(choiceOf("no", "")).toStrictEqual({
      ok: true,
      choice: { verdict: "declined" },
    });
  });

  it("answers in his own words, normalised", () => {
    expect(choiceOf("words", "e\u0301")).toStrictEqual({
      ok: true,
      choice: { verdict: "answered", words: "\u00e9" },
    });
  });

  it("refuses empty and too-long words with their reason", () => {
    expect(choiceOf("words", " ")).toStrictEqual({
      ok: false,
      reason: "empty",
    });
    expect(choiceOf("words", "x".repeat(MAX_TEXT_CHARS + 1))).toStrictEqual({
      ok: false,
      reason: "too-long",
    });
  });

  it("throws for a verdict word this page does not build", () => {
    expect(() => choiceOf("maybe" as never, "")).toThrow();
  });
});

describe("sign: the order of the steps", () => {
  it("answers in-progress to a second sign and sends nothing for it", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let markNonceAsked: () => void = () => {};
    const nonceAsked = new Promise<void>((resolve) => {
      markNonceAsked = resolve;
    });
    const wired = recordingFetch([
      () => {
        markNonceAsked();
        return gate.then(() => GOOD_NONCE);
      },
      { status: 201, body: { index: ENTRY_COUNT, state: "approved" } },
    ]);
    const key = passkeyFor("in-progress");
    const creds = recordingCredentials(key.handler);
    const answerer = createAnswerer({
      fetch: wired.fetch,
      credentials: creds.credentials,
      subtle,
      location: LOCATION,
    });
    const model = modelOf();
    const first = answerer.sign(model, okChoice("yes"));
    // The first press is now parked on the nonce reply it was promised.
    await nonceAsked;
    const second = await answerer.sign(model, okChoice("yes"));
    expect(second).toStrictEqual({ kind: "in-progress" });
    // The second press sent nothing: one nonce ask is all the server saw.
    expect(wired.calls).toHaveLength(1);
    release?.();
    expect(await first).toStrictEqual({
      kind: "stored",
      index: ENTRY_COUNT,
      state: "approved",
    });
    expect(creds.calls).toHaveLength(1);
  });

  it("refuses a decision that is not answerable without sending anything", async () => {
    const CASES: [AnswerOutcome, DecisionModel][] = [
      [
        { kind: "not-answerable", reason: "closed" },
        modelOf({ group: "closed", state: "withdrawn" }),
      ],
      [
        { kind: "not-answerable", reason: "closed" },
        modelOf({ group: "history" }),
      ],
      [
        { kind: "not-answerable", reason: "one-way-door" },
        modelOf({}, { hardToUndo: { value: true, reason: "gone for good" } }),
      ],
      [
        { kind: "not-answerable", reason: "one-way-door" },
        modelOf({}, { hardToUndo: { value: "partly" } }),
      ],
      [
        { kind: "not-answerable", reason: "act-elsewhere" },
        modelOf(
          {},
          { actElsewhere: { where: "your terminal", what: "yarn purge" } },
        ),
      ],
    ];
    for (const [expected, model] of CASES) {
      const run = await signWith(
        model,
        okChoice("yes"),
        [{ status: 200, body: {} }],
        () => {
          throw new Error("the passkey should not have been asked");
        },
      );
      expect(run.outcome).toStrictEqual(expected);
      expect(run.calls).toHaveLength(0);
      expect(run.getCalls).toHaveLength(0);
    }
  });

  it("refuses a text the server's hash disagrees with, without sending anything", async () => {
    const model = modelOf({}, {}, "1".repeat(64));
    const run = await signWith(
      model,
      okChoice("yes"),
      [{ status: 200, body: {} }],
      () => {
        throw new Error("the passkey should not have been asked");
      },
    );
    expect(run.outcome).toStrictEqual({ kind: "text-mismatch" });
    expect(run.calls).toHaveLength(0);
    expect(run.getCalls).toHaveLength(0);
  });

  const NONCE_CASES: [string, Reply, AnswerOutcome][] = [
    ["off for a 404", { status: 404 }, { kind: "off" }],
    ["busy for a 429", { status: 429 }, { kind: "busy" }],
    ["failed for a 500", { status: 500 }, { kind: "failed" }],
    ["failed for a rejected fetch", { reject: true }, { kind: "failed" }],
    [
      "failed for a reply that is not JSON",
      { status: 200, jsonThrows: true },
      { kind: "failed" },
    ],
    [
      "failed for a null reply",
      { status: 200, body: null },
      { kind: "failed" },
    ],
    [
      "failed for a reply that is not an object",
      { status: 200, body: "nope" },
      { kind: "failed" },
    ],
    [
      "failed for a reply with no nonce",
      { status: 200, body: { index: ENTRY_COUNT } },
      { kind: "failed" },
    ],
    [
      "failed for a nonce that is not a string",
      { status: 200, body: { nonce: 5, index: ENTRY_COUNT } },
      { kind: "failed" },
    ],
    [
      "failed for an empty nonce",
      { status: 200, body: { nonce: "", index: ENTRY_COUNT } },
      { kind: "failed" },
    ],
    [
      "failed for a reply with no index",
      { status: 200, body: { nonce: NONCE } },
      { kind: "failed" },
    ],
    [
      "failed for a negative index",
      { status: 200, body: { nonce: NONCE, index: -1 } },
      { kind: "failed" },
    ],
    [
      "failed for an index that is not a whole number",
      { status: 200, body: { nonce: NONCE, index: 2.5 } },
      { kind: "failed" },
    ],
  ];

  for (const [name, reply, expected] of NONCE_CASES) {
    it(`answers ${name}, without asking the passkey`, async () => {
      const run = await signWith(modelOf(), okChoice("yes"), [reply], () => {
        throw new Error("the passkey should not have been asked");
      });
      expect(run.outcome).toStrictEqual(expected);
      expect(run.calls).toHaveLength(1);
      expect(run.getCalls).toHaveLength(0);
    });
  }

  it("answers moved when the server's index is not the page's count, without asking the passkey", async () => {
    const run = await signWith(
      modelOf(),
      okChoice("yes"),
      [{ status: 200, body: { nonce: NONCE, index: ENTRY_COUNT + 1 } }],
      () => {
        throw new Error("the passkey should not have been asked");
      },
    );
    expect(run.outcome).toStrictEqual({ kind: "moved" });
    expect(run.calls).toHaveLength(1);
    expect(run.getCalls).toHaveLength(0);
  });

  it("answers cancelled when the passkey prompt is refused", async () => {
    const run = await signWith(
      modelOf(),
      okChoice("yes"),
      [
        GOOD_NONCE,
        { status: 201, body: { index: ENTRY_COUNT, state: "approved" } },
      ],
      () => {
        throw new Error("NotAllowedError: the owner cancelled");
      },
    );
    expect(run.outcome).toStrictEqual({ kind: "cancelled" });
    // No answers POST: the nonce was asked for and spent, and nothing else.
    expect(run.calls).toHaveLength(1);
  });

  it("answers cancelled when the passkey returns null", async () => {
    const run = await signWith(
      modelOf(),
      okChoice("yes"),
      [
        GOOD_NONCE,
        { status: 201, body: { index: ENTRY_COUNT, state: "approved" } },
      ],
      () => null,
    );
    expect(run.outcome).toStrictEqual({ kind: "cancelled" });
    expect(run.calls).toHaveLength(1);
  });

  const RAW_ID = bufferOf("AAAAAAAAAAAAAAAAAAAAAA");
  const RAW_RESPONSE = {
    authenticatorData: bufferOf("A".repeat(56)),
    clientDataJSON: bufferOf("A".repeat(40)),
    signature: bufferOf("A".repeat(80)),
  };

  const MIS_SHAPEN: unknown[] = [
    "nope",
    7,
    {},
    { rawId: RAW_ID, response: null },
    { rawId: "not bytes", response: RAW_RESPONSE },
    {
      rawId: RAW_ID,
      response: { ...RAW_RESPONSE, authenticatorData: "not bytes" },
    },
    {
      rawId: RAW_ID,
      response: { ...RAW_RESPONSE, clientDataJSON: "not bytes" },
    },
    { rawId: RAW_ID, response: { ...RAW_RESPONSE, signature: "not bytes" } },
  ];

  for (const [at, assertion] of MIS_SHAPEN.entries()) {
    it(`answers cancelled for a misshapen assertion (${at}), without posting`, async () => {
      const run = await signWith(
        modelOf(),
        okChoice("yes"),
        [
          GOOD_NONCE,
          { status: 201, body: { index: ENTRY_COUNT, state: "approved" } },
        ],
        () => assertion,
      );
      expect(run.outcome).toStrictEqual({ kind: "cancelled" });
      expect(run.calls).toHaveLength(1);
    });
  }

  it("accepts an assertion whose byte strings are views over buffers", async () => {
    const handler: GetFn = (options) => {
      const pk = (
        options as unknown as { publicKey: { challenge: Uint8Array } }
      ).publicKey;
      return viewAssertion(assertionFor(pk.challenge, "views").input);
    };
    const run = await signWith(
      modelOf(),
      okChoice("yes"),
      [
        GOOD_NONCE,
        { status: 201, body: { index: ENTRY_COUNT, state: "approved" } },
      ],
      handler,
    );
    expect(run.outcome).toStrictEqual({
      kind: "stored",
      index: ENTRY_COUNT,
      state: "approved",
    });
  });

  it("a fetch that refuses to be called as a method still stores the answer", async () => {
    const wired = recordingFetch([
      GOOD_NONCE,
      { status: 201, body: { index: ENTRY_COUNT, state: "approved" } },
    ]);
    const innerFetch = wired.fetch;
    const browserFetch = async function (
      this: unknown,
      path: string,
      init?: {
        readonly method?: string;
        readonly headers?: Readonly<Record<string, string>>;
        readonly body?: string;
      },
    ): Promise<{ readonly status: number; json(): Promise<unknown> }> {
      if (this !== undefined && this !== globalThis) {
        throw new TypeError("Illegal invocation");
      }
      return innerFetch(path, init);
    };
    const creds = recordingCredentials(passkeyFor("unbound-fetch").handler);
    const answerer = createAnswerer({
      fetch: browserFetch,
      credentials: creds.credentials,
      subtle,
      location: LOCATION,
    });
    const model = modelOf();
    const outcome = await answerer.sign(model, okChoice("yes"));
    expect(outcome).toStrictEqual({
      kind: "stored",
      index: ENTRY_COUNT,
      state: "approved",
    });
    expect(wired.calls).toHaveLength(2);
    expect(wired.calls[0]?.path).toContain("nonce");
    expect(wired.calls[0]?.method).toBe("POST");
    expect(wired.calls[1]?.method).toBe("POST");
  });
});

describe("sign: what the answers route answers", () => {
  const key = passkeyFor("answers-route");

  const CASES: [string, Reply, AnswerOutcome][] = [
    [
      "stored for a 201",
      { status: 201, body: { index: ENTRY_COUNT, state: "approved" } },
      { kind: "stored", index: ENTRY_COUNT, state: "approved" },
    ],
    [
      "moved for a stale 409",
      { status: 409, body: { reason: "stale" } },
      { kind: "moved" },
    ],
    ["not-verified for a 403", { status: 403 }, { kind: "not-verified" }],
    ["off for a 404", { status: 404 }, { kind: "off" }],
    ["busy for a 429", { status: 429 }, { kind: "busy" }],
    ["failed for a 500", { status: 500 }, { kind: "failed" }],
    ["failed for a rejected fetch", { reject: true }, { kind: "failed" }],
    [
      "failed for a reply that is not JSON",
      { status: 201, jsonThrows: true },
      { kind: "failed" },
    ],
    [
      "failed for a null stored reply",
      { status: 201, body: null },
      { kind: "failed" },
    ],
    [
      "failed for a stored reply that is not an object",
      { status: 201, body: "nope" },
      { kind: "failed" },
    ],
    [
      "failed for a stored reply with no state",
      { status: 201, body: { index: ENTRY_COUNT } },
      { kind: "failed" },
    ],
    [
      "failed for a stored reply with an index that is not whole",
      { status: 201, body: { index: 2.5, state: "approved" } },
      { kind: "failed" },
    ],
    [
      "failed for a null refusal",
      { status: 409, body: null },
      { kind: "failed" },
    ],
    [
      "failed for a refusal that is not an object",
      { status: 409, body: "stale" },
      { kind: "failed" },
    ],
    [
      "failed for a refusal with no reason",
      { status: 409, body: {} },
      { kind: "failed" },
    ],
    [
      "failed for a reason the page does not know",
      { status: 409, body: { reason: "teapot" } },
      { kind: "failed" },
    ],
  ];

  for (const [name, reply, expected] of CASES) {
    it(`answers ${name}`, async () => {
      const run = await signWith(
        modelOf(),
        okChoice("yes"),
        [GOOD_NONCE, reply],
        key.handler,
      );
      expect(run.outcome).toStrictEqual(expected);
    });
  }

  const REFUSALS = [
    "one-way-door",
    "act-elsewhere",
    "signed-cap",
    "entry-ceiling",
  ];

  for (const reason of REFUSALS) {
    it(`answers refused for a 409 that says ${reason}`, async () => {
      const run = await signWith(
        modelOf(),
        okChoice("yes"),
        [GOOD_NONCE, { status: 409, body: { reason } }],
        key.handler,
      );
      expect(run.outcome).toStrictEqual({ kind: "refused", reason });
    });
  }
});

describe("the bytes the page signs", () => {
  const WORDS = "in my own words";

  for (const word of ["yes", "no", "words"] as const) {
    it(`are the contract's own challenge for the page's hash and count (${word})`, async () => {
      const choice = okChoice(word, WORDS);
      const key = passkeyFor(`answer-credential-${word}`);
      const run = await signWith(
        modelOf(),
        choice,
        [
          GOOD_NONCE,
          { status: 201, body: { index: ENTRY_COUNT, state: choice.verdict } },
        ],
        key.handler,
      );
      expect(run.outcome).toStrictEqual({
        kind: "stored",
        index: ENTRY_COUNT,
        state: choice.verdict,
      });

      // The challenge the passkey was handed is SHA-256 of the contract's
      // own challenge text, built from the page's own hash and count.
      const expectedText = contractAnswerChallengeText({
        project: PROJECT,
        decision: ID,
        textSha256: CURRENT_HASH,
        index: ENTRY_COUNT,
        verdict: choice.verdict,
        ...(word === "words" ? { words: WORDS } : {}),
        nonce: NONCE,
      });
      const expected = createHash("sha256")
        .update(expectedText, "utf8")
        .digest();
      expect(Buffer.from(challengeOf(run.getCalls)).toString("hex")).toBe(
        expected.toString("hex"),
      );

      // The posted body is an answer request the contract accepts, carrying
      // the page's own revision, hash, count and words.
      const posted = JSON.parse(String(run.calls[1]?.body)) as Record<
        string,
        unknown
      >;
      const checked = validateAnswerRequest(posted);
      if (!checked.ok) {
        throw new Error(JSON.stringify(checked.errors));
      }
      expect(checked.value.revision).toBe(2);
      expect(checked.value.textSha256).toBe(CURRENT_HASH);
      expect(checked.value.index).toBe(ENTRY_COUNT);
      expect(checked.value.verdict).toBe(choice.verdict);
      expect(checked.value.nonce).toBe(NONCE);
      if (word === "words") {
        expect(checked.value.words).toBe(WORDS);
      } else {
        expect(posted).not.toHaveProperty("words");
      }

      // The server's own verifier answers ok for that body against the
      // contract's challenge text built from the stored hash.
      const verified = verifyAssertion(
        {
          credentialId: checked.value.credentialId,
          authenticatorData: checked.value.authenticatorData,
          clientDataJSON: checked.value.clientDataJSON,
          signature: checked.value.signature,
        },
        expectedText,
        key.made().keys,
      );
      expect(verified.ok).toBe(true);
    });
  }
});

describe("the calls the ceremony makes", () => {
  const key = passkeyFor("calls");

  it("asks the nonce with no body and the answers as JSON", async () => {
    const run = await signWith(
      modelOf(),
      okChoice("yes"),
      [
        GOOD_NONCE,
        { status: 201, body: { index: ENTRY_COUNT, state: "approved" } },
      ],
      key.handler,
    );
    expect(run.outcome).toStrictEqual({
      kind: "stored",
      index: ENTRY_COUNT,
      state: "approved",
    });
    expect(run.calls[0]).toStrictEqual({
      method: "POST",
      path: NONCE_PATH,
      headers: { accept: "application/json" },
    });
    const answers = run.calls[1];
    expect(answers?.method).toBe("POST");
    expect(answers?.path).toBe(ANSWERS_PATH);
    expect(answers?.headers).toStrictEqual({
      "content-type": "application/json",
    });
    expect(typeof answers?.body).toBe("string");
  });

  it("builds both of its paths with encodeURIComponent", async () => {
    const model = modelOf();
    const renamed: DecisionModel = {
      ...model,
      head: { ...model.head, project: "al pha", id: "d 1" },
    };
    const run = await signWith(
      renamed,
      okChoice("yes"),
      [
        GOOD_NONCE,
        { status: 201, body: { index: ENTRY_COUNT, state: "approved" } },
      ],
      key.handler,
    );
    expect(run.outcome).toStrictEqual({
      kind: "stored",
      index: ENTRY_COUNT,
      state: "approved",
    });
    expect(run.calls.map((call) => call.path)).toStrictEqual([
      "/api/v1/projects/al%20pha/decisions/d%201/nonce",
      "/api/v1/projects/al%20pha/decisions/d%201/answers",
    ]);
  });

  it("asks the passkey for a discoverable, verified key on this host", async () => {
    const run = await signWith(
      modelOf(),
      okChoice("yes"),
      [
        GOOD_NONCE,
        { status: 201, body: { index: ENTRY_COUNT, state: "approved" } },
      ],
      key.handler,
    );
    const argument = run.getCalls[0];
    expect(argument).toBeDefined();
    expect(Object.keys(argument ?? {})).toStrictEqual(["publicKey"]);
    const pk = (argument as unknown as { publicKey: Record<string, unknown> })
      .publicKey;
    expect(pk.rpId).toBe(LOCATION.hostname);
    expect(pk.userVerification).toBe("required");
    // Shorter than the nonce's lifetime, so a slow but successful prompt
    // is not refused as not-verified after the nonce has already died.
    expect(pk.timeout).toBe(90_000);
    expect(pk.timeout).toBeLessThan(NONCE_TTL_MS);
    expect(pk).not.toHaveProperty("allowCredentials");
    expect(pk.challenge).toBeInstanceOf(Uint8Array);
    expect((pk.challenge as Uint8Array).length).toBe(32);
  });
});

describe("the guard", () => {
  it("lets a new sign run after a failed one", async () => {
    const key = passkeyFor("guard-failed");
    const wired = recordingFetch([
      { status: 500 },
      GOOD_NONCE,
      { status: 201, body: { index: ENTRY_COUNT, state: "approved" } },
    ]);
    const creds = recordingCredentials(key.handler);
    const answerer = createAnswerer({
      fetch: wired.fetch,
      credentials: creds.credentials,
      subtle,
      location: LOCATION,
    });
    const model = modelOf();
    const choice = okChoice("yes");
    expect(await answerer.sign(model, choice)).toStrictEqual({
      kind: "failed",
    });
    expect(await answerer.sign(model, choice)).toStrictEqual({
      kind: "stored",
      index: ENTRY_COUNT,
      state: "approved",
    });
  });

  it("lets a new sign run after a fetch that threw", async () => {
    const key = passkeyFor("guard-thrown");
    const wired = recordingFetch([
      GOOD_NONCE,
      { status: 201, body: { index: ENTRY_COUNT, state: "approved" } },
    ]);
    let calls = 0;
    const throwing: AnswerFetch = (path, init) => {
      calls += 1;
      if (calls === 1) {
        throw new Error("the fake broke");
      }
      return wired.fetch(path, init);
    };
    const creds = recordingCredentials(key.handler);
    const answerer = createAnswerer({
      fetch: throwing,
      credentials: creds.credentials,
      subtle,
      location: LOCATION,
    });
    const model = modelOf();
    const choice = okChoice("yes");
    expect(await answerer.sign(model, choice)).toStrictEqual({
      kind: "failed",
    });
    expect(await answerer.sign(model, choice)).toStrictEqual({
      kind: "stored",
      index: ENTRY_COUNT,
      state: "approved",
    });
  });
});
