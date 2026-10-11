import { Buffer } from "node:buffer";
import { createHash, webcrypto } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  answerChallengeText,
  decisionBindingText,
} from "@hexagen-monaco/waves-contract";
import type { DecisionRevision } from "@hexagen-monaco/waves-contract";

import type { AppGlobals } from "../../public/app.js";
import { createApp } from "../../public/app.js";
import { ANSWER_FOOTER } from "../../public/views/answer.js";
import {
  EXPECTED_ORIGIN,
  RELYING_PARTY_ID,
  type AssertionInput,
} from "../../src/infrastructure/assertion-verifier.js";
import { buildAssertion, type Built } from "../assertion-helper.js";

import {
  attentionView,
  decisionResponse,
  decisionRevision,
  inboxHead,
  projectCard,
  signedDecisionEntry,
  storedRevision,
} from "./fixtures.js";
import type { Answer } from "./helpers.js";
import {
  browserGlobals,
  flush,
  freshRoot,
  root,
  textsOf,
  timerStub,
} from "./helpers.js";

const NONCE = (id: string) => `/api/v1/projects/alpha/decisions/${id}/nonce`;
const DECISION = (id: string) => `/api/v1/projects/alpha/decisions/${id}`;
const ANSWERS = (id: string) => `/api/v1/projects/alpha/decisions/${id}/answers`;

/** A fixed nonce the test controls: the page never sees a random value. */
const NONCE_VALUE = "A".repeat(43);

/**
 * The revision the answer flow signs over, and the real SHA-256 of its binding
 * text — the fixture's hash, not the placeholder `"0".repeat(64)`.
 */
const REVISION: DecisionRevision = decisionRevision();
const HASH = createHash("sha256")
  .update(decisionBindingText(REVISION), "utf8")
  .digest("hex");

/**
 * One open decision with a real hash: zero entries by default, or some entries
 * passed in (as the re-read after a stored answer adds).
 */
const openDecision = (entries: unknown[] = []) =>
  decisionResponse({
    head: inboxHead({ textSha256: HASH, entries: entries.length }),
    revisions: [
      storedRevision({ textSha256: HASH, decision: REVISION }),
    ] as never,
    entries: entries as never,
  });

/** One signed entry on revision 1, for the decision the fixture above shows. */
const signedApprovedEntry = () =>
  signedDecisionEntry({
    index: 0,
    state: "approved",
    revision: 1,
    textSha256: HASH,
  });

/** The answer challenge text the page should hand to the passkey. */
function challengeTextFor(
  overrides: { verdict: AnswerVerdict; words?: string },
): string {
  return answerChallengeText({
    project: "alpha",
    decision: "d1",
    textSha256: HASH,
    index: 0,
    verdict: overrides.verdict,
    ...(overrides.words !== undefined ? { words: overrides.words } : {}),
    nonce: NONCE_VALUE,
  });
}

type AnswerVerdict = "approved" | "declined" | "answered";

/** The bytes the page should hand to `credentials.get`. */
function expectedChallenge(verdict: AnswerVerdict, words?: string): Buffer {
  return createHash("sha256")
    .update(challengeTextFor({ verdict, words }), "utf8")
    .digest();
}

/** One record of a fetch call: method, path, and the parsed JSON body if any. */
interface SigningCall {
  method: string;
  path: string;
  body?: unknown;
}

/** A reply the signing fetch hands back: a status and optional JSON body. */
type SigningReply = { status: number; body?: unknown };

/**
 * The richer fetch: records `METHOD path` and each POST's parsed JSON body,
 * answers the probe `GET …/nonce` with 405, runs `POST …/nonce` and
 * `POST …/answers` through the test-supplied functions, and answers
 * `GET …/decisions/d1` from a mutable body the test can replace.
 */
function signingFetch(options: {
  nonce: () => Promise<SigningReply> | SigningReply;
  answers: () => Promise<SigningReply> | SigningReply;
  decision: unknown;
}) {
  const calls: SigningCall[] = [];
  let decisionBody = options.decision;
  const impl = async (
    path: string,
    init?: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
    },
  ) => {
    const method = init?.method ?? "GET";
    calls.push({
      method,
      path,
      ...(init?.body !== undefined ? { body: JSON.parse(init.body) } : {}),
    });
    let reply: SigningReply;
    if (path === "/api/v1/projects") {
      reply = { status: 200, body: [projectCard()] };
    } else if (path === "/api/v1/attention") {
      reply = { status: 200, body: attentionView() };
    } else if (path === NONCE("d1") && method === "GET") {
      reply = { status: 405 };
    } else if (path === NONCE("d1") && method === "POST") {
      reply = await options.nonce();
    } else if (path === ANSWERS("d1") && method === "POST") {
      reply = await options.answers();
    } else if (path === DECISION("d1")) {
      reply = { status: 200, body: decisionBody };
    } else {
      reply = { status: 404 };
    }
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      json: () => Promise.resolve(reply.body),
    };
  };
  return Object.assign(impl, {
    calls,
    setDecision: (body: unknown) => {
      decisionBody = body;
    },
  });
}

/** A `credentials.get` that records its options and delegates to `handler`. */
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

/** A real P-256 assertion over the challenge it was given. */
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
    const pk = (
      options as unknown as { publicKey: { challenge: Uint8Array } }
    ).publicKey;
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

/** The challenge bytes the passkey was asked to sign. */
function challengeOf(
  getCalls: readonly CredentialRequestOptions[],
): Uint8Array {
  const first = getCalls[0];
  if (first === undefined) {
    throw new Error("the passkey was never asked");
  }
  return (
    first as unknown as { publicKey: { challenge: Uint8Array } }
  ).publicKey.challenge;
}

/**
 * The harness for the answer ceremony: gives the app `crypto` and `credentials`
 * with the right origin, so the signing tests drive the real ceremony from the
 * page's buttons through the real WebCrypto hashes.
 */
function signingHarness(
  pathname: string,
  fetchImpl: ReturnType<typeof signingFetch>,
  getCreds: GetFn,
) {
  freshRoot();
  const timers = timerStub();
  const browser = browserGlobals(pathname, "", "https://waves.midnight.lan");
  const getCalls: CredentialRequestOptions[] = [];
  const app = createApp({
    doc: document,
    location: browser.location,
    history: browser.history,
    win: browser.win,
    fetch: fetchImpl,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    clock: () => Date.parse("2026-04-01T12:00:00.000Z"),
    crypto: webcrypto as unknown as Crypto,
    credentials: {
      create: () => {
        throw new Error("create not expected");
      },
      get: async (options: CredentialRequestOptions) => {
        getCalls.push(options);
        return getCreds(options);
      },
    },
  } satisfies AppGlobals);
  return { app, browser, timers, fetchImpl, getCalls };
}

/** Flushes enough microtask ticks for real async work (WebCrypto, fetches) to settle. */
async function settle(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) {
    await flush();
  }
}

/** Clicks the button the page owns by its `data-key`. */
function press(key: string): void {
  const button = root().querySelector(
    `[data-key="${key}"]`,
  ) as HTMLButtonElement | null;
  expect(button).not.toBeNull();
  button!.click();
}

/** The textarea the page owns by its `data-key`. */
function textarea(key: string): HTMLTextAreaElement {
  return root().querySelector(
    `[data-key="${key}"]`,
  ) as HTMLTextAreaElement;
}

/** The page's idle answer message, if one. */
function messageText(): string {
  return root().querySelector("p.answer-message")?.textContent ?? "";
}

/** A fetch that records `METHOD path` and answers by path; `probe` answers the nonce path. */
function answerFetch(options: {
  decisions: Record<string, unknown>;
  probe: (id: string) => Promise<Answer>;
}) {
  const calls: string[] = [];
  const impl = async (
    path: string,
    init?: { method?: string; headers?: Readonly<Record<string, string>> },
  ) => {
    calls.push(`${init?.method ?? "GET"} ${path}`);
    let answer: Answer = { status: 404 };
    if (path === "/api/v1/projects") {
      answer = { status: 200, body: [projectCard()] };
    } else if (path === "/api/v1/attention") {
      answer = { status: 200, body: attentionView() };
    } else {
      for (const [id, body] of Object.entries(options.decisions)) {
        if (path === NONCE(id)) {
          answer = await options.probe(id);
        } else if (path === DECISION(id)) {
          answer = { status: 200, body };
        }
      }
    }
    return {
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      json: () => Promise.resolve(answer.body),
    };
  };
  return Object.assign(impl, { calls });
}

function harness(pathname: string, fetchImpl: ReturnType<typeof answerFetch>) {
  freshRoot();
  const timers = timerStub();
  const browser = browserGlobals(pathname, "");
  const app = createApp({
    doc: document,
    location: browser.location,
    history: browser.history,
    win: browser.win,
    fetch: fetchImpl,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    clock: () => Date.parse("2026-04-01T12:00:00.000Z"),
  } satisfies AppGlobals);
  return { app, browser, timers };
}

async function load(h: ReturnType<typeof harness>, flushes = 2): Promise<void> {
  h.app.start();
  for (let i = 0; i < flushes; i++) {
    await flush();
  }
}

describe("the decision page offers answer controls only when the server takes answers", () => {
  it("is dark when answers are off, and identical to not knowing", async () => {
    const body = decisionResponse({});

    const off: (id: string) => Promise<Answer> = async () => ({
      status: 404,
    });
    const rejecting: (id: string) => Promise<Answer> = async () => {
      throw new Error("network");
    };
    const never: (id: string) => Promise<Answer> = () =>
      new Promise<Answer>(() => {});

    const html: string[] = [];
    for (const probe of [off, rejecting, never]) {
      const fetchImpl = answerFetch({ decisions: { d1: body }, probe });
      const h = harness("/p/alpha/d/d1", fetchImpl);
      await load(h);
      html.push(root().innerHTML);
      expect(root().querySelector("section.decision button")).toBeNull();
      expect(root().innerHTML).not.toContain('class="answer"');
      h.app.stop();
    }

    expect(html[0]).toBe(html[1]);
    expect(html[1]).toBe(html[2]);
  });

  it("shows the answer controls when the server takes answers", async () => {
    const body = decisionResponse({
      revisions: [
        storedRevision({
          decision: decisionRevision({
            commits: ["the owner is bound to the outcome"],
            evidence: [
              { label: "evidence", href: "https://ev.example.test/x" },
            ],
          }),
        }),
      ],
    });
    const fetchImpl = answerFetch({
      decisions: { d1: body },
      probe: async () => ({ status: 405 }),
    });
    const h = harness("/p/alpha/d/d1", fetchImpl);
    await load(h);

    expect(textsOf(root(), "section.answer button")).toEqual([
      "Yes",
      "No",
      "Answer in my own words",
    ]);
    expect(root().querySelector(".decision-footer")?.textContent).toBe(
      ANSWER_FOOTER,
    );

    const answer = root().querySelector("section.answer");
    const commits = root().querySelector(".decision-commits");
    const evidence = root().querySelector(".decision-evidence");
    expect(answer).not.toBeNull();
    expect(commits).not.toBeNull();
    expect(evidence).not.toBeNull();
    expect(
      answer!.compareDocumentPosition(commits!) &
        Node.DOCUMENT_POSITION_PRECEDING,
    ).not.toBe(0);
    expect(
      answer!.compareDocumentPosition(evidence!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);

    h.app.stop();
  });

  it("shows the closed note, not the controls, for a one-way door", async () => {
    const body = decisionResponse({
      head: inboxHead({ door: { value: true } }),
      revisions: [
        storedRevision({
          decision: decisionRevision({
            hardToUndo: { value: true, reason: "one-way door" },
          }),
        }),
      ],
    });

    const darkFetch = answerFetch({
      decisions: { d1: body },
      probe: async () => ({ status: 404 }),
    });
    const dark = harness("/p/alpha/d/d1", darkFetch);
    await load(dark);
    const darkFooter =
      root().querySelector(".decision-footer")?.textContent ?? "";
    dark.app.stop();

    const onFetch = answerFetch({
      decisions: { d1: body },
      probe: async () => ({ status: 405 }),
    });
    const on = harness("/p/alpha/d/d1", onFetch);
    await load(on);

    expect(root().querySelector("section.answer")).toBeNull();
    expect(textsOf(root(), "section.answer button")).toEqual([]);
    expect(root().querySelectorAll("p.answer-closed")).toHaveLength(1);
    const onFooter =
      root().querySelector(".decision-footer")?.textContent ?? "";
    expect(onFooter).toBe(darkFooter);
    expect(onFooter).not.toBe(ANSWER_FOOTER);

    on.app.stop();
  });

  it("draws nothing extra for the closed and act-elsewhere reasons", async () => {
    const closed = decisionResponse({
      head: inboxHead({ group: "closed", state: "withdrawn" }),
    });
    const elsewhere = decisionResponse({
      head: inboxHead({
        actElsewhere: { where: "terminal", what: "answer the relay" },
      }),
      revisions: [
        storedRevision({
          decision: decisionRevision({
            actElsewhere: { where: "terminal", what: "answer the relay" },
          }),
        }),
      ],
    });

    for (const body of [closed, elsewhere]) {
      const darkFetch = answerFetch({
        decisions: { d1: body },
        probe: async () => ({ status: 404 }),
      });
      const dark = harness("/p/alpha/d/d1", darkFetch);
      await load(dark);
      const darkHtml = root().innerHTML;
      dark.app.stop();

      const onFetch = answerFetch({
        decisions: { d1: body },
        probe: async () => ({ status: 405 }),
      });
      const on = harness("/p/alpha/d/d1", onFetch);
      await load(on);
      const onHtml = root().innerHTML;
      expect(onHtml).toBe(darkHtml);
      expect(root().querySelector("section.answer")).toBeNull();
      expect(textsOf(root(), "section.answer button")).toEqual([]);
      on.app.stop();
    }
  });

  it("asks the answer probe once, and only on the decision route", async () => {
    const body1 = decisionResponse({});
    const body2 = decisionResponse({
      head: inboxHead({ id: "d2" }),
      revisions: [storedRevision({ decision: decisionRevision({ id: "d2" }) })],
    });
    const fetchImpl = answerFetch({
      decisions: { d1: body1, d2: body2 },
      probe: async () => ({ status: 405 }),
    });
    const h = harness("/p/alpha/d/d1", fetchImpl);
    h.app.start();
    await flush();
    for (let i = 0; i < 3; i++) {
      h.timers.runLast();
      await flush();
    }

    const nonceCalls = (id: string) =>
      fetchImpl.calls.filter((c) => c === `GET ${NONCE(id)}`).length;
    expect(nonceCalls("d1")).toBe(1);
    expect(fetchImpl.calls.some((c) => c.startsWith("POST"))).toBe(false);

    h.app.navigate("/p/alpha/d/d2");
    await flush();
    expect(nonceCalls("d2")).toBe(1);

    h.app.navigate("/");
    await flush();
    expect(nonceCalls("d1")).toBe(1);
    expect(nonceCalls("d2")).toBe(1);

    h.app.stop();
  });

  it("does not draw answer controls when the probe settles after the reader has left", async () => {
    const body1 = decisionResponse({});
    const body2 = decisionResponse({
      head: inboxHead({ id: "d2" }),
      revisions: [storedRevision({ decision: decisionRevision({ id: "d2" }) })],
    });

    let resolveProbe!: (a: Answer) => void;
    const probe = (id: string): Promise<Answer> => {
      if (id === "d1") {
        return new Promise<Answer>((resolve) => {
          resolveProbe = resolve;
        });
      }
      return Promise.resolve({ status: 404 });
    };

    const fetchImpl = answerFetch({
      decisions: { d1: body1, d2: body2 },
      probe,
    });
    const h = harness("/p/alpha/d/d1", fetchImpl);
    h.app.start();
    await flush();
    expect(root().querySelector("section.answer")).toBeNull();

    h.app.navigate("/");
    await flush();
    resolveProbe({ status: 405 });
    await flush();
    expect(root().querySelector("section.answer")).toBeNull();

    h.app.navigate("/p/alpha/d/d2");
    await flush();
    await flush();
    expect(root().querySelector("section.answer")).toBeNull();

    h.app.stop();
  });

  it("does not redraw answer controls when a past decision's probe settles on a later one", async () => {
    const body1 = decisionResponse({});
    const body2 = decisionResponse({
      head: inboxHead({ id: "d2" }),
      revisions: [storedRevision({ decision: decisionRevision({ id: "d2" }) })],
    });

    let resolveProbe!: (a: Answer) => void;
    const probe = (id: string): Promise<Answer> => {
      if (id === "d1") {
        return new Promise<Answer>((resolve) => {
          resolveProbe = resolve;
        });
      }
      return Promise.resolve({ status: 404 });
    };

    const fetchImpl = answerFetch({
      decisions: { d1: body1, d2: body2 },
      probe,
    });
    const h = harness("/p/alpha/d/d1", fetchImpl);
    h.app.start();
    await flush();

    h.app.navigate("/p/alpha/d/d2");
    await flush();
    await flush();
    expect(root().querySelector("section.answer")).toBeNull();

    resolveProbe({ status: 405 });
    await flush();
    expect(root().querySelector("section.answer")).toBeNull();

    h.app.stop();
  });
});

describe("the answer flow keeps its draft across a redraw", () => {
  it("keeps what was typed when the page redraws", async () => {
    const fetchImpl = signingFetch({
      nonce: () => ({
        status: 200,
        body: { nonce: NONCE_VALUE, index: 0 },
      }),
      answers: () => ({
        status: 201,
        body: { index: 0, state: "approved" },
      }),
      decision: openDecision(),
    });
    const h = signingHarness("/p/alpha/d/d1", fetchImpl, () => null);
    h.app.start();
    await settle();

    press("answer-words-open");
    await flush();

    const area = textarea("answer-words");
    area.value = "hello world";
    area.dispatchEvent(new Event("input", { bubbles: true }));
    area.setSelectionRange(5, 5);
    area.focus();

    h.timers.runLast();
    await settle();

    const redrawn = textarea("answer-words");
    expect(redrawn.value).toBe("hello world");
    expect(document.activeElement).toBe(redrawn);
    expect(redrawn.selectionStart).toBe(5);

    h.app.stop();
  });
});
