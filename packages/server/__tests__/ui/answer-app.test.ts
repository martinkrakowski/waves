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
  textOf,
  textsOf,
  timerStub,
} from "./helpers.js";

const NONCE = (id: string) => `/api/v1/projects/alpha/decisions/${id}/nonce`;
const DECISION = (id: string) => `/api/v1/projects/alpha/decisions/${id}`;
const ANSWERS = (id: string) =>
  `/api/v1/projects/alpha/decisions/${id}/answers`;

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
function challengeTextFor(overrides: {
  verdict: AnswerVerdict;
  words?: string;
}): string {
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

/** The challenge bytes the passkey was asked to sign. */
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

/**
 * The harness for the answer ceremony: gives the app `crypto` and `credentials`
 * with the right origin, so the signing tests drive the real ceremony from the
 * page's buttons through the real WebCrypto hashes.
 */
function signingHarness(
  pathname: string,
  fetchImpl: ReturnType<typeof signingFetch>,
  getCreds: GetFn,
  cryptoless = false,
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
    AbortController,
    ...(cryptoless ? {} : { crypto: webcrypto as unknown as Crypto }),
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
  return root().querySelector(`[data-key="${key}"]`) as HTMLTextAreaElement;
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

describe("the answer flow's signing", () => {
  /** A nonce reply that agrees with the page's zero-entry count. */
  const GOOD_NONCE: SigningReply = {
    status: 200,
    body: { nonce: NONCE_VALUE, index: 0 },
  };
  const GOOD_ANSWERS: SigningReply = {
    status: 201,
    body: { index: 0, state: "approved" },
  };

  it("signs Yes and reads back the entry it made", async () => {
    let releaseGet!: () => void;
    const innerFetch = signingFetch({
      nonce: () => GOOD_NONCE,
      answers: () => GOOD_ANSWERS,
      decision: openDecision(),
    });
    // In a real browser `fetch` is a named method: `browser.fetch(...)`
    // throws "Illegal invocation" until the page takes it into a local
    // first. Wrap the fake the same way to prove the page calls it unbound.
    const fetchImpl = Object.assign(
      function (
        this: unknown,
        ...args: Parameters<typeof innerFetch>
      ): ReturnType<typeof innerFetch> {
        if (this !== undefined && this !== globalThis) {
          throw new TypeError("Illegal invocation");
        }
        return innerFetch(...args);
      },
      { calls: innerFetch.calls, setDecision: innerFetch.setDecision },
    );
    const h = signingHarness("/p/alpha/d/d1", fetchImpl, (options) => {
      const pk = (
        options as unknown as { publicKey: { challenge: Uint8Array } }
      ).publicKey;
      const made = assertionFor(pk.challenge, "yes-stored");
      return new Promise<unknown>((resolve) => {
        releaseGet = () => resolve(browserAssertion(made.input));
      });
    });
    h.app.start();
    await settle();

    press("answer-yes");
    await flush();

    press("answer-sign");
    await settle();

    // While the ceremony is open: buttons held back, working shown.
    expect(
      (root().querySelector('[data-key="answer-sign"]') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (root().querySelector('[data-key="answer-cancel"]') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(root().querySelector("p.answer-working")).not.toBeNull();

    // The passkey was asked once, on this host, for the right challenge.
    expect(h.getCalls).toHaveLength(1);
    const pk = (
      h.getCalls[0] as unknown as {
        publicKey: Record<string, unknown>;
      }
    ).publicKey;
    expect(pk.rpId).toBe(RELYING_PARTY_ID);
    expect(pk.userVerification).toBe("required");
    expect(Buffer.from(pk.challenge as Uint8Array).toString("hex")).toBe(
      expectedChallenge("approved").toString("hex"),
    );

    // Release, then put the signed entry on the re-read decision.
    releaseGet();
    fetchImpl.setDecision(openDecision([signedApprovedEntry()]));
    await settle();

    // Idle with the stored message and the three buttons.
    expect(messageText()).toBe("Signed and recorded.");
    expect(textsOf(root(), "section.answer button")).toEqual([
      "Yes",
      "No",
      "Answer in my own words",
    ]);

    // Exactly one POST nonce, one POST answers, then the re-read GET.
    expect(
      fetchImpl.calls.filter(
        (c) => c.method === "POST" && c.path === NONCE("d1"),
      ),
    ).toHaveLength(1);
    expect(
      fetchImpl.calls.filter(
        (c) => c.method === "POST" && c.path === ANSWERS("d1"),
      ),
    ).toHaveLength(1);
    const answersIdx = fetchImpl.calls.findIndex(
      (c) => c.method === "POST" && c.path === ANSWERS("d1"),
    );
    const readIdx = fetchImpl.calls.findLastIndex(
      (c) => c.method === "GET" && c.path === DECISION("d1"),
    );
    expect(readIdx).toBeGreaterThan(answersIdx);

    // The posted body: revision, hash, index, verdict, nonce, no option/words.
    const body = fetchImpl.calls.find(
      (c) => c.method === "POST" && c.path === ANSWERS("d1"),
    )!.body as Record<string, unknown>;
    expect(body.revision).toBe(1);
    expect(body.textSha256).toBe(HASH);
    expect(body.index).toBe(0);
    expect(body.verdict).toBe("approved");
    expect(body.nonce).toBe(NONCE_VALUE);
    expect(body).not.toHaveProperty("option");
    expect(body).not.toHaveProperty("words");

    // The new entry is on the page.
    expect(
      root().querySelector(".decision-history")?.textContent ?? "",
    ).toContain("signed with your passkey");

    h.app.stop();
  });

  it("signs a second answer on the same visit through the answerer it already has", async () => {
    let signs = 0;
    const fetchImpl = signingFetch({
      nonce: () => {
        signs += 1;
        return { status: 200, body: { nonce: NONCE_VALUE, index: signs - 1 } };
      },
      answers: () => GOOD_ANSWERS,
      decision: openDecision(),
    });
    const key = passkeyFor("twice-on-one-visit");
    let held = true;
    let releaseFirst!: () => void;
    const h = signingHarness("/p/alpha/d/d1", fetchImpl, (options) => {
      const made = key.handler(options) as unknown;
      if (!held) {
        return made;
      }
      return new Promise<unknown>((resolve) => {
        releaseFirst = () => resolve(made);
      });
    });
    h.app.start();
    await settle();

    press("answer-yes");
    await flush();
    press("answer-sign");
    await settle();
    fetchImpl.setDecision(openDecision([signedApprovedEntry()]));
    held = false;
    releaseFirst();
    await settle();
    expect(messageText()).toBe("Signed and recorded.");

    press("answer-yes");
    await flush();
    press("answer-sign");
    await settle();

    expect(messageText()).toBe("Signed and recorded.");
    expect(
      fetchImpl.calls.filter(
        (c) => c.method === "POST" && c.path === NONCE("d1"),
      ),
    ).toHaveLength(2);
    const second = fetchImpl.calls.findLast(
      (c) => c.method === "POST" && c.path === ANSWERS("d1"),
    )!.body as Record<string, unknown>;
    expect(second.index).toBe(1);

    h.app.stop();
  });

  it("ends with the failed outcome when the page has no WebCrypto to hash with", async () => {
    const fetchImpl = signingFetch({
      nonce: () => {
        throw new Error("nonce should not be asked");
      },
      answers: () => {
        throw new Error("answers should not be asked");
      },
      decision: openDecision(),
    });
    const h = signingHarness(
      "/p/alpha/d/d1",
      fetchImpl,
      () => {
        throw new Error("get should not be asked");
      },
      true,
    );
    h.app.start();
    await settle();

    press("answer-yes");
    await flush();
    press("answer-sign");
    await settle();

    expect(messageText()).toBe("The answer was not recorded. Try again.");
    expect(h.getCalls).toHaveLength(0);
    expect(fetchImpl.calls.filter((c) => c.method === "POST")).toHaveLength(0);

    h.app.stop();
  });

  it("signs own words, sends the trimmed words, and clears the draft", async () => {
    const WORDS = "hello in my own words";
    let releaseGet!: () => void;
    const fetchImpl = signingFetch({
      nonce: () => GOOD_NONCE,
      answers: () => ({
        status: 201,
        body: { index: 0, state: "answered" },
      }),
      decision: openDecision(),
    });
    const h = signingHarness("/p/alpha/d/d1", fetchImpl, (options) => {
      const pk = (
        options as unknown as { publicKey: { challenge: Uint8Array } }
      ).publicKey;
      const made = assertionFor(pk.challenge, "own-words");
      return new Promise<unknown>((resolve) => {
        releaseGet = () => resolve(browserAssertion(made.input));
      });
    });
    h.app.start();
    await settle();

    press("answer-words-open");
    await flush();

    const area = textarea("answer-words");
    // Padded with white space on both sides, which the page must trim away
    // before it builds the challenge and the body.
    area.value = `  ${WORDS} \n`;
    area.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();

    press("answer-continue");
    await flush();
    expect(
      textOf(root().querySelector("blockquote.answer-confirm-words")),
    ).toBe(WORDS);

    press("answer-sign");
    await settle();

    // Challenge is over the own-words text.
    expect(h.getCalls).toHaveLength(1);
    expect(Buffer.from(challengeOf(h.getCalls)).toString("hex")).toBe(
      expectedChallenge("answered", WORDS).toString("hex"),
    );

    releaseGet();
    fetchImpl.setDecision(
      openDecision([
        signedDecisionEntry({
          index: 0,
          state: "answered",
          revision: 1,
          textSha256: HASH,
        }),
      ]),
    );
    await settle();

    expect(messageText()).toBe("Signed and recorded.");

    // Body carries the verdict and the words.
    const body = fetchImpl.calls.find(
      (c) => c.method === "POST" && c.path === ANSWERS("d1"),
    )!.body as Record<string, unknown>;
    expect(body.verdict).toBe("answered");
    expect(body.words).toBe(WORDS);
    expect(body).not.toHaveProperty("option");

    // Opening words again shows an empty textarea (draft was cleared).
    press("answer-words-open");
    await flush();
    expect(textarea("answer-words").value).toBe("");

    h.app.stop();
  });

  it("signs No with verdict declined", async () => {
    let releaseGet!: () => void;
    const fetchImpl = signingFetch({
      nonce: () => GOOD_NONCE,
      answers: () => ({
        status: 201,
        body: { index: 0, state: "declined" },
      }),
      decision: openDecision(),
    });
    const h = signingHarness("/p/alpha/d/d1", fetchImpl, (options) => {
      const pk = (
        options as unknown as { publicKey: { challenge: Uint8Array } }
      ).publicKey;
      const made = assertionFor(pk.challenge, "no-stored");
      return new Promise<unknown>((resolve) => {
        releaseGet = () => resolve(browserAssertion(made.input));
      });
    });
    h.app.start();
    await settle();

    press("answer-no");
    await flush();
    press("answer-sign");
    await settle();

    expect(Buffer.from(challengeOf(h.getCalls)).toString("hex")).toBe(
      expectedChallenge("declined").toString("hex"),
    );

    releaseGet();
    fetchImpl.setDecision(
      openDecision([
        signedDecisionEntry({
          index: 0,
          state: "declined",
          revision: 1,
          textSha256: HASH,
        }),
      ]),
    );
    await settle();

    const body = fetchImpl.calls.find(
      (c) => c.method === "POST" && c.path === ANSWERS("d1"),
    )!.body as Record<string, unknown>;
    expect(body.verdict).toBe("declined");

    h.app.stop();
  });

  const REFUSAL_GETS: [string, GetFn][] = [
    ["rejects", () => Promise.reject(new Error("owner cancelled"))],
    ["resolves null", () => null],
  ];

  for (const [name, getHandler] of REFUSAL_GETS) {
    it(`cancels when the passkey ${name}, keeps the own-words draft`, async () => {
      const WORDS = "my own words";
      const fetchImpl = signingFetch({
        nonce: () => GOOD_NONCE,
        answers: () => GOOD_ANSWERS,
        decision: openDecision(),
      });
      const h = signingHarness("/p/alpha/d/d1", fetchImpl, getHandler);
      h.app.start();
      await settle();

      press("answer-words-open");
      await flush();
      const area = textarea("answer-words");
      area.value = WORDS;
      area.dispatchEvent(new Event("input", { bubbles: true }));
      await flush();
      press("answer-continue");
      await flush();
      press("answer-sign");
      await settle();

      expect(messageText()).toBe(
        "The passkey prompt was cancelled or timed out. Nothing was signed.",
      );
      expect(
        h.fetchImpl.calls.filter(
          (c) => c.method === "POST" && c.path === ANSWERS("d1"),
        ),
      ).toHaveLength(0);
      expect(textsOf(root(), "section.answer button")).toEqual([
        "Yes",
        "No",
        "Answer in my own words",
      ]);
      expect(
        root().querySelectorAll("section.answer button[disabled]"),
      ).toHaveLength(0);
      expect(root().querySelector("p.answer-working")).toBeNull();

      press("answer-words-open");
      await flush();
      expect(textarea("answer-words").value).toBe(WORDS);

      h.app.stop();
    });
  }

  it("moves when the nonce index disagrees, and re-reads", async () => {
    const fetchImpl = signingFetch({
      nonce: () => ({
        status: 200,
        body: { nonce: NONCE_VALUE, index: 1 },
      }),
      answers: () => {
        throw new Error("answers should not be asked");
      },
      decision: openDecision(),
    });
    const h = signingHarness("/p/alpha/d/d1", fetchImpl, () => null);
    h.app.start();
    await settle();

    press("answer-yes");
    await flush();

    const before = h.getCalls.length;
    press("answer-sign");
    await settle();

    expect(h.getCalls).toHaveLength(before);
    expect(
      h.fetchImpl.calls.filter(
        (c) => c.method === "POST" && c.path === ANSWERS("d1"),
      ),
    ).toHaveLength(0);
    expect(messageText()).toBe(
      "This decision changed while you were answering. Nothing was recorded. Read it again before you answer.",
    );
    expect(textsOf(root(), "section.answer button")).toEqual([
      "Yes",
      "No",
      "Answer in my own words",
    ]);

    // The re-read happened.
    const decisionGets = h.fetchImpl.calls.filter(
      (c) => c.method === "GET" && c.path === DECISION("d1"),
    );
    expect(decisionGets.length).toBeGreaterThan(1);

    h.app.stop();
  });

  it("moves when the answer is stale, and re-reads", async () => {
    let releaseGet!: () => void;
    const fetchImpl = signingFetch({
      nonce: () => GOOD_NONCE,
      answers: () => ({
        status: 409,
        body: { reason: "stale" },
      }),
      decision: openDecision(),
    });
    const h = signingHarness("/p/alpha/d/d1", fetchImpl, (options) => {
      const pk = (
        options as unknown as { publicKey: { challenge: Uint8Array } }
      ).publicKey;
      const made = assertionFor(pk.challenge, "stale");
      return new Promise<unknown>((resolve) => {
        releaseGet = () => resolve(browserAssertion(made.input));
      });
    });
    h.app.start();
    await settle();

    press("answer-yes");
    await flush();

    press("answer-sign");
    await settle();

    // The passkey was asked (moved at the answer, not the nonce).
    expect(h.getCalls).toHaveLength(1);

    releaseGet();
    fetchImpl.setDecision(openDecision([signedApprovedEntry()]));
    await settle();

    expect(messageText()).toBe(
      "This decision changed while you were answering. Nothing was recorded. Read it again before you answer.",
    );
    expect(textsOf(root(), "section.answer button")).toEqual([
      "Yes",
      "No",
      "Answer in my own words",
    ]);

    // One more decision GET followed the refusal, and the replacement
    // decision it read back is drawn with its entry on the page.
    expect(
      fetchImpl.calls.filter(
        (c) => c.method === "GET" && c.path === DECISION("d1"),
      ),
    ).toHaveLength(2);
    expect(
      root().querySelector(".decision-history")?.textContent ?? "",
    ).toContain("signed with your passkey");

    h.app.stop();
  });

  it("re-reads once more when the answer stored under a pass already in flight", async () => {
    let releaseAnswers!: (reply: SigningReply) => void;
    const base = signingFetch({
      nonce: () => GOOD_NONCE,
      answers: () =>
        new Promise<SigningReply>((resolve) => {
          releaseAnswers = resolve;
        }),
      decision: openDecision(),
    });
    // Every decision GET after the page's first load is held open until the
    // test releases it, and answers with whatever body `setDecision` holds at
    // that moment, so a pass can be caught in flight and released stale.
    let decisionGets = 0;
    const held: (() => void)[] = [];
    const calls: SigningCall[] = [];
    const fetchImpl = Object.assign(
      async (
        path: string,
        init?: {
          method?: string;
          headers?: Record<string, string>;
          body?: string;
        },
      ): Promise<Awaited<ReturnType<typeof base>>> => {
        const method = init?.method ?? "GET";
        calls.push({
          method,
          path,
          ...(init?.body !== undefined
            ? { body: JSON.parse(init.body) }
            : {}),
        });
        if (path === DECISION("d1") && method === "GET") {
          decisionGets += 1;
          if (decisionGets > 1) {
            return new Promise((resolve) => {
              held.push(() => {
                resolve(base(path, init));
              });
            });
          }
        }
        return base(path, init);
      },
      { calls, setDecision: base.setDecision },
    );
    const key = passkeyFor("re-read-under-a-held-pass");
    const h = signingHarness("/p/alpha/d/d1", fetchImpl, key.handler);
    h.app.start();
    await settle();

    press("answer-yes");
    await flush();
    press("answer-sign");
    await settle();

    // A ten-second pass starts now and is caught holding the decision GET.
    h.timers.runLast();
    await flush();
    expect(held).toHaveLength(1);

    // The answer stores while that pass is still in flight.
    releaseAnswers({ status: 201, body: { index: 0, state: "approved" } });
    await flush();

    // The pass the outcome waited for is released with the OLD decision, so
    // the entry is not on the page it drew.
    held.shift()?.();
    await settle();
    expect(messageText()).toBe("Signed and recorded.");
    expect(
      root().querySelector(".decision-history")?.textContent ?? "",
    ).not.toContain("signed with your passkey");

    // One more decision GET follows — the in-flight pass read the decision
    // before the answer — and it is drawn with the entry the answer became.
    expect(held).toHaveLength(1);
    fetchImpl.setDecision(openDecision([signedApprovedEntry()]));
    held.shift()?.();
    await settle();

    expect(decisionGets).toBe(3);
    expect(
      root().querySelector(".decision-history")?.textContent ?? "",
    ).toContain("signed with your passkey");

    h.app.stop();
  });

  const END_CASES: [string, SigningReply, SigningReply, string][] = [
    [
      "nonce 404",
      { status: 404 },
      { status: 500 },
      "Answering in the page is not switched on.",
    ],
    [
      "nonce 429",
      { status: 429 },
      { status: 500 },
      "Too many tries. Wait a moment and try again.",
    ],
    [
      "answers 403",
      GOOD_NONCE,
      { status: 403 },
      "The server did not accept the signature. Nothing was recorded.",
    ],
    [
      "answers 409 signed-cap",
      GOOD_NONCE,
      { status: 409, body: { reason: "signed-cap" } },
      "This decision cannot take another answer.",
    ],
    [
      "answers 500",
      GOOD_NONCE,
      { status: 500 },
      "The answer was not recorded. Try again.",
    ],
  ];

  for (const [name, nonceReply, answersReply, expectedMessage] of END_CASES) {
    it(`ends with "${expectedMessage}" — ${name}`, async () => {
      const fetchImpl = signingFetch({
        nonce: () => nonceReply,
        answers: () => answersReply,
        decision: openDecision(),
      });
      const key = passkeyFor("end-case");
      const h = signingHarness("/p/alpha/d/d1", fetchImpl, key.handler);
      h.app.start();
      await settle();

      press("answer-yes");
      await flush();
      press("answer-sign");
      await settle();

      expect(messageText()).toBe(expectedMessage);
      expect(textsOf(root(), "section.answer button")).toEqual([
        "Yes",
        "No",
        "Answer in my own words",
      ]);
      expect(
        root().querySelectorAll("section.answer button[disabled]"),
      ).toHaveLength(0);
      expect(root().querySelector("p.answer-working")).toBeNull();

      h.app.stop();
    });
  }

  it("re-reads the decision at once when the answer's reply was a 500", async () => {
    const fetchImpl = signingFetch({
      nonce: () => GOOD_NONCE,
      answers: () => ({ status: 500 }),
      decision: openDecision(),
    });
    const key = passkeyFor("answers-500");
    const h = signingHarness("/p/alpha/d/d1", fetchImpl, key.handler);
    h.app.start();
    await settle();

    press("answer-yes");
    await flush();
    const getsBefore = h.fetchImpl.calls.filter(
      (c) => c.method === "GET" && c.path === DECISION("d1"),
    ).length;

    press("answer-sign");
    // No timer is run for this settle: the stub only fires a timer it is told
    // to, so a `GET` that lands now can only come from the outcome itself.
    await settle();

    const postAt = h.fetchImpl.calls.findIndex(
      (c) => c.method === "POST" && c.path === ANSWERS("d1"),
    );
    expect(postAt).toBeGreaterThanOrEqual(0);
    const getAfters = h.fetchImpl.calls.filter(
      (c) => c.method === "GET" && c.path === DECISION("d1"),
    );
    expect(getAfters).toHaveLength(getsBefore + 1);
    expect(
      h.fetchImpl.calls.indexOf(getAfters[getAfters.length - 1]!),
    ).toBeGreaterThan(postAt);
    expect(messageText()).toBe("The answer was not recorded. Try again.");

    h.app.stop();
  });

  it("re-reads the decision at once when the ceremony was cancelled", async () => {
    const fetchImpl = signingFetch({
      nonce: () => GOOD_NONCE,
      answers: () => {
        throw new Error("answers should not be asked");
      },
      decision: openDecision(),
    });
    const h = signingHarness("/p/alpha/d/d1", fetchImpl, () => null);
    h.app.start();
    await settle();

    press("answer-yes");
    await flush();
    const getsBefore = h.fetchImpl.calls.filter(
      (c) => c.method === "GET" && c.path === DECISION("d1"),
    ).length;

    press("answer-sign");
    // No timer is run for this settle: the stub only fires a timer it is told
    // to, so a `GET` that lands now can only come from the outcome itself.
    await settle();

    expect(messageText()).toBe(
      "The passkey prompt was cancelled or timed out. Nothing was signed.",
    );
    const getAfters = h.fetchImpl.calls.filter(
      (c) => c.method === "GET" && c.path === DECISION("d1"),
    );
    expect(getAfters).toHaveLength(getsBefore + 1);

    h.app.stop();
  });

  it("refuses a text the page's hash disagrees with, with no request after the press", async () => {
    const fetchImpl = signingFetch({
      nonce: () => {
        throw new Error("nonce should not be asked");
      },
      answers: () => {
        throw new Error("answers should not be asked");
      },
      decision: decisionResponse({
        head: inboxHead({ textSha256: "0".repeat(64) }),
        revisions: [storedRevision({ textSha256: "0".repeat(64) })] as never[],
      }),
    });
    const h = signingHarness("/p/alpha/d/d1", fetchImpl, () => {
      throw new Error("get should not be asked");
    });
    h.app.start();
    await settle();

    press("answer-yes");
    await flush();
    const before = h.fetchImpl.calls.length;
    press("answer-sign");
    await settle();

    // No nonce, no answer and no passkey — but the outcome still re-reads
    // the decision at once, so the page he is on is the one the server has.
    expect(h.fetchImpl.calls.slice(before)).toEqual([
      { method: "GET", path: "/api/v1/projects" },
      { method: "GET", path: "/api/v1/attention" },
      { method: "GET", path: DECISION("d1") },
    ]);
    expect(h.getCalls).toHaveLength(0);
    expect(messageText()).toBe(
      "The text on this page does not match the server's record of it. Nothing was signed. Reload the page.",
    );
    expect(textsOf(root(), "section.answer button")).toEqual([
      "Yes",
      "No",
      "Answer in my own words",
    ]);
    expect(
      root().querySelectorAll("section.answer button[disabled]"),
    ).toHaveLength(0);
    expect(root().querySelector("p.answer-working")).toBeNull();

    h.app.stop();
  });

  it("asks the nonce only once for two quick sign presses", async () => {
    let releaseNonce!: () => void;
    const fetchImpl = signingFetch({
      nonce: () =>
        new Promise<SigningReply>((resolve) => {
          releaseNonce = () =>
            resolve({
              status: 200,
              body: { nonce: NONCE_VALUE, index: 0 },
            });
        }),
      answers: () => GOOD_ANSWERS,
      decision: openDecision(),
    });
    const h = signingHarness("/p/alpha/d/d1", fetchImpl, () => null);
    h.app.start();
    await settle();

    press("answer-yes");
    await flush();

    const signButton = root().querySelector(
      '[data-key="answer-sign"]',
    ) as HTMLButtonElement;
    signButton.click();
    signButton.click();

    await settle();

    expect(
      h.fetchImpl.calls.filter(
        (c) => c.method === "POST" && c.path === NONCE("d1"),
      ),
    ).toHaveLength(1);

    releaseNonce();
    await settle();
    h.app.stop();
  });

  it("a press that slips past the held-back buttons signs nothing twice", async () => {
    let releaseNonce!: () => void;
    const fetchImpl = signingFetch({
      nonce: () =>
        new Promise<SigningReply>((resolve) => {
          releaseNonce = () =>
            resolve({ status: 200, body: { nonce: NONCE_VALUE, index: 0 } });
        }),
      answers: () => GOOD_ANSWERS,
      decision: openDecision(),
    });
    const key = passkeyFor("slipping-press");
    const h = signingHarness("/p/alpha/d/d1", fetchImpl, key.handler);
    h.app.start();
    await settle();

    press("answer-yes");
    await flush();
    press("answer-sign");
    await settle();

    // A press that slips past the held-back buttons reaches the flow off the
    // step it signs from: the working step stays, nothing is asked again.
    const signButton = root().querySelector(
      '[data-key="answer-sign"]',
    ) as HTMLButtonElement;
    signButton.dispatchEvent(new Event("click"));
    await settle();

    expect(root().querySelector("p.answer-working")).not.toBeNull();
    expect(messageText()).toBe("");

    releaseNonce();
    await settle();

    expect(messageText()).toBe("Signed and recorded.");
    expect(
      h.fetchImpl.calls.filter(
        (c) => c.method === "POST" && c.path === NONCE("d1"),
      ),
    ).toHaveLength(1);

    h.app.stop();
  });
});
describe("the answer flow's steps before signing", () => {
  function setup() {
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
    void settle();
    return h;
  }

  it("confirms Yes before any request is made", async () => {
    const h = setup();
    await settle();

    press("answer-yes");
    await flush();

    expect(textOf(root().querySelector("p.answer-confirm-verdict"))).toBe(
      "Your answer: Yes (approved)",
    );
    expect(textOf(root().querySelector("p.answer-confirm-question"))).toBe(
      "Go?",
    );
    expect(textsOf(root(), ".answer-confirm .option-head")).toEqual([
      "a: Yes",
      "b: No",
    ]);
    expect(textOf(root().querySelector("p.answer-confirm-facts"))).toBe(
      "Revision 1 · this will be entry 1 on this decision",
    );
    expect(h.fetchImpl.calls.filter((c) => c.method === "POST")).toHaveLength(
      0,
    );

    h.app.stop();
  });

  it("confirms No with its own verdict line", async () => {
    const fetchImpl = signingFetch({
      nonce: () => ({
        status: 200,
        body: { nonce: NONCE_VALUE, index: 0 },
      }),
      answers: () => ({
        status: 201,
        body: { index: 0, state: "declined" },
      }),
      decision: openDecision(),
    });
    const h = signingHarness("/p/alpha/d/d1", fetchImpl, () => null);
    h.app.start();
    await settle();

    press("answer-no");
    await flush();

    expect(textOf(root().querySelector("p.answer-confirm-verdict"))).toBe(
      "Your answer: No (declined)",
    );

    h.app.stop();
  });

  it("shows a problem and keeps the draft for empty own words", async () => {
    const h = setup();
    await settle();

    press("answer-words-open");
    await flush();

    press("answer-continue");
    await flush();

    expect(textOf(root().querySelector("p.answer-problem"))).toBe(
      "Write your answer first.",
    );
    expect(textarea("answer-words").value).toBe("");

    h.app.stop();
  });

  it("shows a problem and keeps the draft for too-long own words", async () => {
    const h = setup();
    await settle();

    press("answer-words-open");
    await flush();

    const area = textarea("answer-words");
    area.value = "x".repeat(2001);
    area.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();

    press("answer-continue");
    await flush();

    expect(textOf(root().querySelector("p.answer-problem"))).toBe(
      "That is too long to sign.",
    );
    expect(textarea("answer-words").value).toBe("x".repeat(2001));

    h.app.stop();
  });

  it("shows a problem and keeps the draft for words with a line break", async () => {
    const h = setup();
    await settle();

    press("answer-words-open");
    await flush();

    const area = textarea("answer-words");
    area.value = "line one\nline two";
    area.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();

    press("answer-continue");
    await flush();

    expect(textOf(root().querySelector("p.answer-problem"))).toBe(
      "Write it as one line: a line break or a tab cannot be signed.",
    );
    expect(textarea("answer-words").value).toBe("line one\nline two");
    expect(root().querySelector("div.answer-confirm")).toBeNull();
    expect(
      h.fetchImpl.calls.filter(
        (c) => c.method === "POST" && c.path === NONCE("d1"),
      ),
    ).toHaveLength(0);

    h.app.stop();
  });

  it("trims own words before confirming them", async () => {
    const h = setup();
    await settle();

    press("answer-words-open");
    await flush();

    const area = textarea("answer-words");
    area.value = "  Do it, after the backup.  ";
    area.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();

    press("answer-continue");
    await flush();

    const blockquote = root().querySelector(
      "blockquote.answer-confirm-words",
    ) as HTMLQuoteElement;
    expect(blockquote.textContent).toBe("Do it, after the backup.");
    expect(blockquote.childNodes).toHaveLength(1);
    expect(blockquote.childNodes[0]!.nodeType).toBe(Node.TEXT_NODE);

    h.app.stop();
  });

  it("cancels from words and from confirm, and keeps the draft", async () => {
    const h = setup();
    await settle();

    press("answer-words-open");
    await flush();

    const area = textarea("answer-words");
    area.value = "hello";
    area.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();

    press("answer-cancel");
    await flush();
    expect(textsOf(root(), "section.answer button")).toEqual([
      "Yes",
      "No",
      "Answer in my own words",
    ]);

    press("answer-words-open");
    await flush();
    expect(textarea("answer-words").value).toBe("hello");

    press("answer-continue");
    await flush();
    expect(
      textOf(root().querySelector("blockquote.answer-confirm-words")),
    ).toBe("hello");

    press("answer-cancel");
    await flush();
    expect(textsOf(root(), "section.answer button")).toEqual([
      "Yes",
      "No",
      "Answer in my own words",
    ]);

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

describe("a refresh must not let him sign something he has not read", () => {
  const MOVED =
    "This decision changed while you were answering. Nothing was recorded. Read it again before you answer.";

  /** A second revision of the same decision, and its real hash. */
  const REVISION_2 = decisionRevision({
    question: "Go, now that the backup is done?",
  });
  const HASH_2 = createHash("sha256")
    .update(decisionBindingText(REVISION_2), "utf8")
    .digest("hex");

  /** A nonce reply that agrees with the page's zero-entry count. */
  const NONCE_REPLY: SigningReply = {
    status: 200,
    body: { nonce: NONCE_VALUE, index: 0 },
  };

  /**
   * The three ways a pass can bring a different decision than the one the
   * reader is answering: a second revision, the same revision under another
   * text, and one more entry — each with head and arrays in agreement.
   */
  const MOVED_CASES: [string, () => unknown][] = [
    [
      "a second revision",
      () =>
        decisionResponse({
          head: inboxHead({
            question: "Go, now that the backup is done?",
            revision: 2,
            revisions: 2,
            textSha256: HASH_2,
          }),
          revisions: [
            storedRevision({ textSha256: HASH, decision: REVISION }),
            storedRevision({
              revision: 2,
              textSha256: HASH_2,
              decision: REVISION_2,
            }),
          ] as never,
        }),
    ],
    [
      "the same revision under another text",
      () =>
        decisionResponse({
          head: inboxHead({ textSha256: HASH_2 }),
          revisions: [storedRevision({ textSha256: HASH_2 })] as never,
        }),
    ],
    [
      "one more entry",
      () =>
        decisionResponse({
          head: inboxHead({ textSha256: HASH, entries: 1 }),
          revisions: [
            storedRevision({ textSha256: HASH, decision: REVISION }),
          ] as never,
          entries: [signedApprovedEntry()] as never,
        }),
    ],
  ];

  for (const [name, moved] of MOVED_CASES) {
    it(`takes the confirm step back to the choices when a refresh brings ${name}`, async () => {
      const fetchImpl = signingFetch({
        nonce: () => {
          throw new Error("nonce should not be asked");
        },
        answers: () => {
          throw new Error("answers should not be asked");
        },
        decision: openDecision(),
      });
      const h = signingHarness("/p/alpha/d/d1", fetchImpl, () => {
        throw new Error("the passkey should not be asked");
      });
      h.app.start();
      await settle();

      press("answer-yes");
      await flush();

      fetchImpl.setDecision(moved());
      h.timers.runLast();
      await settle();

      expect(messageText()).toBe(MOVED);
      expect(textsOf(root(), "section.answer button")).toEqual([
        "Yes",
        "No",
        "Answer in my own words",
      ]);
      expect(root().querySelector('[data-key="answer-sign"]')).toBeNull();
      expect(fetchImpl.calls.filter((c) => c.method === "POST")).toHaveLength(
        0,
      );

      h.app.stop();
    });
  }

  for (const [name, moved] of MOVED_CASES) {
    it(`takes the words step back to the choices when a refresh brings ${name}, and keeps the draft`, async () => {
      const fetchImpl = signingFetch({
        nonce: () => {
          throw new Error("nonce should not be asked");
        },
        answers: () => {
          throw new Error("answers should not be asked");
        },
        decision: openDecision(),
      });
      const h = signingHarness("/p/alpha/d/d1", fetchImpl, () => {
        throw new Error("the passkey should not be asked");
      });
      h.app.start();
      await settle();

      press("answer-words-open");
      await flush();
      const area = textarea("answer-words");
      area.value = "my own words";
      area.dispatchEvent(new Event("input", { bubbles: true }));
      await flush();

      fetchImpl.setDecision(moved());
      h.timers.runLast();
      await settle();

      expect(messageText()).toBe(MOVED);
      expect(textsOf(root(), "section.answer button")).toEqual([
        "Yes",
        "No",
        "Answer in my own words",
      ]);
      expect(root().querySelector('[data-key="answer-sign"]')).toBeNull();
      expect(fetchImpl.calls.filter((c) => c.method === "POST")).toHaveLength(
        0,
      );

      press("answer-words-open");
      await flush();
      expect(textarea("answer-words").value).toBe("my own words");

      h.app.stop();
    });
  }

  it("redraws the confirm step unchanged when a refresh brings the same decision", async () => {
    const fetchImpl = signingFetch({
      nonce: () => {
        throw new Error("nonce should not be asked");
      },
      answers: () => {
        throw new Error("answers should not be asked");
      },
      decision: openDecision(),
    });
    const h = signingHarness("/p/alpha/d/d1", fetchImpl, () => {
      throw new Error("the passkey should not be asked");
    });
    h.app.start();
    await settle();

    press("answer-yes");
    await flush();
    const before = root().querySelector("div.answer-confirm")!.innerHTML;

    h.timers.runLast();
    await settle();

    expect(root().querySelector("div.answer-confirm")!.innerHTML).toBe(before);
    expect(root().querySelector('[data-key="answer-sign"]')).not.toBeNull();

    h.app.stop();
  });

  it("puts the focus back on the sign button when a refresh redraws the same decision", async () => {
    const fetchImpl = signingFetch({
      nonce: () => {
        throw new Error("nonce should not be asked");
      },
      answers: () => {
        throw new Error("answers should not be asked");
      },
      decision: openDecision(),
    });
    const h = signingHarness("/p/alpha/d/d1", fetchImpl, () => {
      throw new Error("the passkey should not be asked");
    });
    h.app.start();
    await settle();

    press("answer-yes");
    await flush();
    (
      root().querySelector('[data-key="answer-sign"]') as HTMLButtonElement
    ).focus();
    expect(document.activeElement?.getAttribute("data-key")).toBe(
      "answer-sign",
    );

    h.timers.runLast();
    await settle();

    const drawnAgain = root().querySelector(
      '[data-key="answer-sign"]',
    ) as HTMLButtonElement;
    expect(document.activeElement).toBe(drawnAgain);

    h.app.stop();
  });

  it("holds a sign in flight through a refresh, and answers for itself", async () => {
    let releaseGet!: () => void;
    const fetchImpl = signingFetch({
      nonce: () => NONCE_REPLY,
      answers: () => ({ status: 409, body: { reason: "stale" } }),
      decision: openDecision(),
    });
    const h = signingHarness("/p/alpha/d/d1", fetchImpl, (options) => {
      const pk = (
        options as unknown as { publicKey: { challenge: Uint8Array } }
      ).publicKey;
      const made = assertionFor(pk.challenge, "refresh-while-working");
      return new Promise<unknown>((resolve) => {
        releaseGet = () => resolve(browserAssertion(made.input));
      });
    });
    h.app.start();
    await settle();

    press("answer-yes");
    await flush();
    press("answer-sign");
    await settle();

    // While the passkey prompt is open, a refresh that brings a new revision
    // changes nothing he can see: the buttons stay held back and the working
    // line stays, over the text he was shown at the press.
    const before = root().querySelector("section.answer")!.innerHTML;
    fetchImpl.setDecision(MOVED_CASES[0]![1]());
    h.timers.runLast();
    await settle();

    expect(root().querySelector("section.answer")!.innerHTML).toBe(before);
    expect(
      (root().querySelector('[data-key="answer-sign"]') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (root().querySelector('[data-key="answer-cancel"]') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(root().querySelector("p.answer-working")).not.toBeNull();

    // The ceremony ends against the text that was on screen at the press, and
    // the server's refusal is what tells him the page has moved on.
    releaseGet();
    await settle();

    const posted = fetchImpl.calls.find(
      (c) => c.method === "POST" && c.path === ANSWERS("d1"),
    )!.body as Record<string, unknown>;
    expect(posted.revision).toBe(1);
    expect(posted.textSha256).toBe(HASH);
    expect(messageText()).toBe(MOVED);

    h.app.stop();
  });
});

describe("leaving the decision resets the answer flow", () => {
  /** A nonce reply that agrees with the page's zero-entry count. */
  const NONCE_OK: SigningReply = {
    status: 200,
    body: { nonce: NONCE_VALUE, index: 0 },
  };

  /** d2's decision, as `GET …/decisions/d2` answers it. */
  const otherDecision = () =>
    decisionResponse({
      head: inboxHead({ id: "d2" }),
      revisions: [
        storedRevision({ decision: decisionRevision({ id: "d2" }) }),
      ] as never,
    });

  /**
   * signingFetch's shape, but serving several decisions so a test can
   * navigate between them: the probe answers 405 and the nonce POST is
   * test-supplied for every decision alike, and `setDecision` replaces d1's
   * body the same way the refresh tests do.
   */
  function leavingFetch(options: {
    nonce?: () => SigningReply;
    answers?: () => SigningReply;
    decisions: Record<string, unknown>;
  }) {
    const calls: SigningCall[] = [];
    const bodies = new Map(Object.entries(options.decisions));
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
      } else {
        reply = { status: 404 };
        for (const [id, body] of bodies) {
          if (path === NONCE(id) && method === "GET") {
            reply = { status: 405 };
          } else if (path === NONCE(id) && method === "POST") {
            reply =
              options.nonce === undefined ? { status: 405 } : options.nonce();
          } else if (path === ANSWERS(id) && method === "POST") {
            reply =
              options.answers === undefined
                ? { status: 201, body: { index: 0, state: "approved" } }
                : options.answers();
          } else if (path === DECISION(id)) {
            reply = { status: 200, body };
          } else {
            continue;
          }
          break;
        }
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
        bodies.set("d1", body);
      },
    });
  }

  /** The three states the flow can be left in on the decision it belongs to. */
  const ARRIVALS: [string, () => Promise<void>][] = [
    [
      "from the confirm step",
      async () => {
        press("answer-yes");
        await flush();
      },
    ],
    [
      "from his own words with a draft typed",
      async () => {
        press("answer-words-open");
        await flush();
        const area = textarea("answer-words");
        area.value = "my own words";
        area.dispatchEvent(new Event("input", { bubbles: true }));
        await flush();
      },
    ],
    [
      "from a message after a cancelled ceremony",
      async () => {
        press("answer-yes");
        await flush();
        press("answer-sign");
        await settle();
        expect(messageText()).toBe(
          "The passkey prompt was cancelled or timed out. Nothing was signed.",
        );
      },
    ],
  ];

  for (const [name, arrive] of ARRIVALS) {
    it(`resets the answer flow when the reader leaves ${name}`, async () => {
      const fetchImpl = leavingFetch({
        nonce: () => NONCE_OK,
        decisions: { d1: openDecision(), d2: otherDecision() },
      });
      const h = signingHarness("/p/alpha/d/d1", fetchImpl, () => null);
      h.app.start();
      await settle();

      await arrive();
      h.app.navigate("/p/alpha/d/d2");
      await settle();

      expect(textsOf(root(), "section.answer button")).toEqual([
        "Yes",
        "No",
        "Answer in my own words",
      ]);
      expect(root().querySelector("p.answer-message")).toBeNull();

      press("answer-words-open");
      await flush();
      expect(textarea("answer-words").value).toBe("");

      h.app.navigate("/p/alpha/d/d1");
      await settle();
      expect(root().querySelector("p.answer-message")).toBeNull();

      press("answer-words-open");
      await flush();
      expect(textarea("answer-words").value).toBe("");

      h.app.stop();
    });
  }

  it("drops an answer that settles after the reader has left", async () => {
    let releaseGet!: () => void;
    const fetchImpl = leavingFetch({
      nonce: () => NONCE_OK,
      answers: () => ({ status: 201, body: { index: 0, state: "approved" } }),
      decisions: { d1: openDecision(), d2: otherDecision() },
    });
    const h = signingHarness("/p/alpha/d/d1", fetchImpl, (options) => {
      const pk = (
        options as unknown as { publicKey: { challenge: Uint8Array } }
      ).publicKey;
      const made = assertionFor(pk.challenge, "settled-after-leaving");
      return new Promise<unknown>((resolve) => {
        releaseGet = () => resolve(browserAssertion(made.input));
      });
    });
    h.app.start();
    await settle();

    press("answer-yes");
    await flush();
    press("answer-sign");
    await settle();

    const getsBefore = fetchImpl.calls.filter(
      (c) => c.method === "GET" && c.path === DECISION("d1"),
    ).length;

    h.app.navigate("/");
    await settle();

    expect(root().querySelector("section.answer")).toBeNull();
    expect(root().querySelector("p.answer-message")).toBeNull();

    releaseGet();
    await settle();

    expect(root().querySelector("section.answer")).toBeNull();
    expect(root().querySelector("p.answer-message")).toBeNull();
    expect(root().textContent ?? "").not.toContain("Signed and recorded.");
    expect(
      fetchImpl.calls.filter(
        (c) => c.method === "GET" && c.path === DECISION("d1"),
      ),
    ).toHaveLength(getsBefore);

    h.app.navigate("/p/alpha/d/d1");
    await settle();
    expect(root().querySelector("p.answer-message")).toBeNull();
    expect(root().textContent ?? "").not.toContain("Signed and recorded.");

    h.app.stop();
  });

  it("says nothing on the next decision about an answer that settles after leaving", async () => {
    let releaseGet!: () => void;
    const fetchImpl = leavingFetch({
      nonce: () => NONCE_OK,
      answers: () => ({ status: 201, body: { index: 0, state: "approved" } }),
      decisions: { d1: openDecision(), d2: otherDecision() },
    });
    const h = signingHarness("/p/alpha/d/d1", fetchImpl, (options) => {
      const pk = (
        options as unknown as { publicKey: { challenge: Uint8Array } }
      ).publicKey;
      const made = assertionFor(pk.challenge, "settled-on-next-decision");
      return new Promise<unknown>((resolve) => {
        releaseGet = () => resolve(browserAssertion(made.input));
      });
    });
    h.app.start();
    await settle();

    press("answer-yes");
    await flush();
    press("answer-sign");
    await settle();

    h.app.navigate("/p/alpha/d/d2");
    await settle();
    expect(root().querySelector("p.answer-message")).toBeNull();

    releaseGet();
    await settle();

    expect(root().querySelector("p.answer-message")).toBeNull();
    expect(root().textContent ?? "").not.toContain("Signed and recorded.");

    h.app.stop();
  });

  it("abandons the prompt it leaves open, and posts nothing when it settles", async () => {
    let releaseGet!: () => void;
    const fetchImpl = leavingFetch({
      nonce: () => NONCE_OK,
      answers: () => ({ status: 201, body: { index: 0, state: "approved" } }),
      decisions: { d1: openDecision(), d2: otherDecision() },
    });
    const h = signingHarness("/p/alpha/d/d1", fetchImpl, (options) => {
      const pk = (
        options as unknown as { publicKey: { challenge: Uint8Array } }
      ).publicKey;
      const made = assertionFor(pk.challenge, "prompt-abandoned-on-leaving");
      return new Promise<unknown>((resolve) => {
        releaseGet = () => resolve(browserAssertion(made.input));
      });
    });
    h.app.start();
    await settle();

    press("answer-yes");
    await flush();
    press("answer-sign");
    await settle();
    expect(h.getCalls).toHaveLength(1);
    const signal = h.getCalls[0]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);

    h.app.navigate("/p/alpha/d/d2");
    await settle();

    expect(signal?.aborted).toBe(true);

    releaseGet();
    await settle();

    expect(
      fetchImpl.calls.filter(
        (c) => c.method === "POST" && c.path === ANSWERS("d1"),
      ),
    ).toHaveLength(0);

    h.app.stop();
  });

  it("leaves a decision page it never pressed Sign on without a throw", async () => {
    const fetchImpl = leavingFetch({
      decisions: { d1: openDecision(), d2: otherDecision() },
    });
    const h = signingHarness("/p/alpha/d/d1", fetchImpl, () => null);
    h.app.start();
    await settle();

    expect(() => h.app.navigate("/p/alpha/d/d2")).not.toThrow();
    await settle();
    expect(root().querySelector("p.answer-message")).toBeNull();

    h.app.stop();
  });

  it("does not carry a prompt left open on one visit over to the next", async () => {
    const fetchImpl = leavingFetch({
      nonce: () => NONCE_OK,
      answers: () => ({ status: 201, body: { index: 0, state: "approved" } }),
      decisions: { d1: openDecision(), d2: otherDecision() },
    });
    let heldOpen = true;
    const h = signingHarness("/p/alpha/d/d1", fetchImpl, (options) => {
      const pk = (
        options as unknown as { publicKey: { challenge: Uint8Array } }
      ).publicKey;
      const made = assertionFor(pk.challenge, "prompt-left-open");
      if (heldOpen) {
        return new Promise<unknown>(() => {});
      }
      return browserAssertion(made.input);
    });
    h.app.start();
    await settle();

    press("answer-yes");
    await flush();
    press("answer-sign");
    await settle();
    expect(h.getCalls).toHaveLength(1);

    h.app.navigate("/");
    await settle();
    h.app.navigate("/p/alpha/d/d1");
    await settle();

    heldOpen = false;
    press("answer-yes");
    await flush();
    press("answer-sign");
    await settle();

    expect(
      h.fetchImpl.calls.filter(
        (c) => c.method === "POST" && c.path === NONCE("d1"),
      ),
    ).toHaveLength(2);
    expect(messageText()).toBe("Signed and recorded.");

    h.app.stop();
  });
});
