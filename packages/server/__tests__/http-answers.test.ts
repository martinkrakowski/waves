import { createHash } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import {
  MAX_DECISIONS_PER_PROJECT,
  answerChallengeText,
  validateStoredStateEntry,
  type AnswerChallengeValues,
  type AnswerRequest,
  type DecisionRevision,
} from "@hexagen-monaco/waves-contract";

import { MemoryStore } from "../src/index.js";
import { FAILURE_LIMIT } from "../src/application/limiters.js";
import { EXPECTED_ORIGIN } from "../src/infrastructure/assertion-verifier.js";
import type { LoadedKey } from "../src/infrastructure/owner-keys-file.js";
import {
  cleanupHarnesses,
  finalStatus,
  logLeaks,
  NOW_MS,
  startHarness,
  type Started,
} from "./http-harness.js";
import {
  buildAssertion,
  type Built,
  type Changes,
} from "./assertion-helper.js";
import {
  decisionRevision,
  stateEntryRequest,
  storedEntry,
  storedRevision,
} from "./notice-contract.js";

const PROJECT_TOKEN = "project-token-0123456789abcdefghijklmnopq";
const ADMIN_TOKEN = "admin-token-0123456789abcdefghijklmnopqrstuv";
const READ_TOKEN = "read-token-0123456789abcdefghijklmnopqrs";
const LABEL = "Test key";

const PROJECT = "alpha";
const ID = "d1";
const OTHER = "d2";
const HASH = "0".repeat(64);
const REVISED_HASH = "1".repeat(64);

const BEARER = (token: string) => ({ authorization: `Bearer ${token}` });

function digestOf(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function noncePath(id = ID, project = PROJECT): string {
  return `/api/v1/projects/${project}/decisions/${id}/nonce`;
}
function answersPath(id = ID, project = PROJECT): string {
  return `/api/v1/projects/${project}/decisions/${id}/answers`;
}
function statesPath(id = ID, project = PROJECT): string {
  return `/api/v1/projects/${project}/decisions/${id}/states`;
}
function decisionPath(id = ID, project = PROJECT): string {
  return `/api/v1/projects/${project}/decisions/${id}`;
}

function clock() {
  let at = NOW_MS;
  return {
    now: () => at,
    pass: (ms = 1_000) => {
      at += ms;
    },
  };
}

/**
 * The nonce source of every test: a counter, so no test depends on the bytes
 * of a random value. Each nonce is 43 base64url characters in the one
 * spelling the contract accepts, with the counter away from the last
 * character, whose bits the spelling pins.
 */
function nonceCounter(): { source: () => string; issued: readonly string[] } {
  const issued: string[] = [];
  return {
    source: () => {
      const value = `${"n".repeat(39)}${issued.length
        .toString(36)
        .padStart(3, "a")}0`;
      issued.push(value);
      return value;
    },
    issued,
  };
}

interface Wired {
  readonly started: Started;
  readonly store: MemoryStore;
  readonly pass: (ms?: number) => void;
  /** The assertion whose public key the harness holds as the owner's. */
  readonly owner: Built;
}

async function wired(
  options: {
    readonly readToken?: string;
    readonly adminToken?: string;
    readonly trustProxy?: boolean;
    /** The owner keys to load; a freshly built assertion by default. */
    readonly ownerKeys?: readonly LoadedKey[];
  } = {},
): Promise<Wired> {
  const store = new MemoryStore();
  await store.putProject({
    id: PROJECT,
    name: "Alpha",
    repo: "https://example.com/alpha.git",
    tokenSha256: digestOf(PROJECT_TOKEN),
    registeredAt: "2026-10-01T12:00:00Z",
  });
  await store.appendRevision(
    PROJECT,
    ID,
    storedRevision(1, ID),
    0,
    MAX_DECISIONS_PER_PROJECT,
  );
  const clk = clock();
  const counter = nonceCounter();
  const owner = buildAssertion();
  const started = await startHarness({
    store,
    now: clk.now,
    ownerKeys: options.ownerKeys ?? owner.keys,
    nonceSource: counter.source,
    readToken: options.readToken,
    adminToken: options.adminToken,
    trustProxy: options.trustProxy,
  });
  return { started, store, pass: clk.pass, owner };
}

/** What the owner says with his answer: a verdict and, for `answered`, more. */
interface Answer {
  readonly verdict: "approved" | "declined" | "answered";
  readonly option?: string;
  readonly words?: string;
}

interface AnswerOptions {
  /** Changes for the assertion the helper builds (another signer, tampering). */
  readonly changes?: Changes;
  /** The challenge text to sign, from the values the body pins. */
  readonly challenge?: (values: AnswerChallengeValues) => string;
  /** Overrides on the body the helper posts, after the signature is made. */
  readonly body?: Partial<AnswerRequest>;
  /** Headers both the nonce ask and the answer carry. */
  readonly headers?: Record<string, string>;
  /** The `Origin` the answer posts; the page's own origin by default. */
  readonly origin?: string | false;
}

/** The facts an answer pins: where the decision stands right now. */
async function trioOf(
  store: MemoryStore,
  project: string,
  decision: string,
): Promise<{ revision: number; textSha256: string }> {
  const stored = await store.getDecision(project, decision);
  const current = stored!.revisions[stored!.revisions.length - 1]!;
  return { revision: current.revision, textSha256: current.textSha256 };
}

/** One nonce ask, with whatever headers the test wants to send. */
async function askNonce(
  h: Wired,
  decision: string,
  headers: Record<string, string> = {},
  project = PROJECT,
): Promise<{ nonce: string; index: number }> {
  const response = await fetch(
    `${h.started.origin}${noncePath(decision, project)}`,
    {
      method: "POST",
      headers,
    },
  );
  expect(response.status).toBe(200);
  const granted = (await response.json()) as { nonce: string; index: number };
  return granted;
}

/**
 * The signed body of one answer, built the way the page builds it: the
 * challenge from the decision as it stands, the signature from the owner's
 * own key, the pin from what the nonce ask answered.
 */
function signedBody(
  h: Wired,
  decision: string,
  answer: Answer,
  pin: { nonce: string; index: number; revision: number; textSha256: string },
  options: AnswerOptions = {},
  project = PROJECT,
): AnswerRequest {
  const values: AnswerChallengeValues = {
    project,
    decision,
    textSha256: pin.textSha256,
    index: pin.index,
    verdict: answer.verdict,
    ...(answer.option !== undefined ? { option: answer.option } : {}),
    ...(answer.words !== undefined ? { words: answer.words } : {}),
    nonce: pin.nonce,
  };
  const text = options.challenge?.(values) ?? answerChallengeText(values);
  const built = buildAssertion({
    challengeText: text,
    signingKey: h.owner.privateKey,
    ...options.changes,
  });
  return {
    revision: pin.revision,
    textSha256: pin.textSha256,
    index: pin.index,
    verdict: answer.verdict,
    ...(answer.option !== undefined ? { option: answer.option } : {}),
    ...(answer.words !== undefined ? { words: answer.words } : {}),
    nonce: pin.nonce,
    credentialId: built.input.credentialId,
    authenticatorData: built.input.authenticatorData,
    clientDataJSON: built.input.clientDataJSON,
    signature: built.input.signature,
    ...options.body,
  };
}

/** Posts one answer body, with whatever headers the test wants to send. */
function postAnswer(
  h: Wired,
  decision: string,
  body: unknown,
  options: {
    readonly headers?: Record<string, string>;
    readonly origin?: string | false;
  } = {},
  project = PROJECT,
): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...options.headers,
  };
  if (options.origin !== false) {
    headers.origin = options.origin ?? EXPECTED_ORIGIN;
  }
  return fetch(`${h.started.origin}${answersPath(decision, project)}`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/**
 * One whole answer: a fresh second, a nonce ask, the challenge signed over
 * the decision as it stands, and the body posted.
 */
async function answerOnce(
  h: Wired,
  decision: string,
  answer: Answer,
  options: AnswerOptions = {},
  project = PROJECT,
): Promise<Response> {
  h.pass();
  const granted = await askNonce(h, decision, options.headers ?? {}, project);
  const trio = await trioOf(h.store, project, decision);
  const body = signedBody(
    h,
    decision,
    answer,
    { ...granted, ...trio },
    options,
    project,
  );
  return postAnswer(
    h,
    decision,
    body,
    { headers: options.headers, origin: options.origin },
    project,
  );
}

/** The warn lines the model wrote, as objects: the reasons only the log has. */
function warnLines(h: Wired): Record<string, unknown>[] {
  return h.started
    .logLines()
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((line) => line.level === "warn");
}

afterEach(() => cleanupHarnesses().then(() => expect(logLeaks()).toEqual([])));

describe("the answers route with keys loaded", () => {
  describe("a good signature on a fresh pin is stored", () => {
    it.each([
      ["approved", { verdict: "approved" } as const, {}],
      ["declined", { verdict: "declined" } as const, {}],
      [
        "answered in words",
        { verdict: "answered", words: "do it now" } as const,
        { words: "do it now" },
      ],
      [
        "answered with an option",
        { verdict: "answered", option: "b" } as const,
        { option: "b" },
      ],
    ])("%s", async (_name, answer, carried) => {
      const h = await wired();
      const response = await answerOnce(h, ID, answer);

      expect(response.status).toBe(201);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({
        index: 0,
        state: answer.verdict,
      });

      const stored = await h.store.getDecision(PROJECT, ID);
      const entry = stored!.entries[0]!;
      const { index: _i, receivedAt: _r, ...held } = entry;
      void _i;
      void _r;
      const validated = validateStoredStateEntry(held);
      expect(validated.ok).toBe(true);
      expect(entry).toMatchObject({
        state: answer.verdict,
        source: "signed",
        by: LABEL,
        signature: { index: 0 },
        ...carried,
      });

      // The read route shows what the answer route stored, unchanged.
      const view = await fetch(`${h.started.origin}${decisionPath()}`);
      expect(view.status).toBe(200);
      const document = (await view.json()) as {
        entries: readonly Record<string, unknown>[];
      };
      expect(document.entries[0]).toMatchObject({
        state: answer.verdict,
        source: "signed",
        by: LABEL,
      });
    });
  });

  it("answers 404 for an unknown project and an unknown decision", async () => {
    const h = await wired();
    h.pass();
    const granted = await askNonce(h, ID);
    const trio = await trioOf(h.store, PROJECT, ID);
    const body = signedBody(
      h,
      ID,
      { verdict: "approved" },
      {
        ...granted,
        ...trio,
      },
    );

    const unknownProject = await postAnswer(h, ID, body, {}, "beta");
    expect(unknownProject.status).toBe(404);
    expect(await unknownProject.json()).toEqual({ error: "not found" });

    h.pass();
    const unknownDecision = await postAnswer(h, "absent", body, {});
    expect(unknownDecision.status).toBe(404);
    expect(await unknownDecision.json()).toEqual({ error: "not found" });
    const stored = await h.store.getDecision(PROJECT, ID);
    expect(stored!.entries).toEqual([]);
  });

  describe("no token is an answer", () => {
    it("stores the same answer with a project token, the admin token and none", async () => {
      const h = await wired({ adminToken: ADMIN_TOKEN });

      for (const headers of [BEARER(PROJECT_TOKEN), BEARER(ADMIN_TOKEN), {}]) {
        const response = await answerOnce(
          h,
          ID,
          { verdict: "approved" },
          {
            headers,
          },
        );
        expect(response.status).toBe(201);
      }
      const stored = await h.store.getDecision(PROJECT, ID);
      expect(stored!.entries).toHaveLength(3);
    });

    it("refuses a bad signature the same way with each of them", async () => {
      const h = await wired({ adminToken: ADMIN_TOKEN });
      const other = buildAssertion();

      for (const headers of [BEARER(PROJECT_TOKEN), BEARER(ADMIN_TOKEN), {}]) {
        const response = await answerOnce(
          h,
          ID,
          { verdict: "approved" },
          { headers, changes: { signingKey: other.privateKey } },
        );
        expect(response.status).toBe(403);
      }
      const stored = await h.store.getDecision(PROJECT, ID);
      expect(stored!.entries).toEqual([]);
    });
  });

  it("answers 403 with one body whatever made the signature bad, and the reason only in the log", async () => {
    const h = await wired();
    const other = buildAssertion();

    const response = await answerOnce(
      h,
      ID,
      { verdict: "approved" },
      {
        changes: { signingKey: other.privateKey },
      },
    );

    expect(response.status).toBe(403);
    const text = await response.text();
    expect(text).toBe('{"error":"not verified","reason":"not-verified"}');
    expect(text).not.toContain("bad-signature");
    expect(warnLines(h)).toEqual([
      {
        level: "warn",
        msg: "answer refused",
        project: PROJECT,
        decision: ID,
        reason: "bad-signature",
      },
    ]);
    const stored = await h.store.getDecision(PROJECT, ID);
    expect(stored!.entries).toEqual([]);
  });

  describe("the nonce is one attempt, whatever the attempt ends in", () => {
    it("refuses a replayed body: the nonce is gone", async () => {
      const h = await wired();
      h.pass();
      const granted = await askNonce(h, ID);
      const trio = await trioOf(h.store, PROJECT, ID);
      const body = signedBody(
        h,
        ID,
        { verdict: "approved" },
        {
          ...granted,
          ...trio,
        },
      );

      const first = await postAnswer(h, ID, body, {});
      expect(first.status).toBe(201);

      h.pass();
      const replay = await postAnswer(h, ID, body, {});
      expect(replay.status).toBe(403);
      expect(await replay.json()).toEqual({
        error: "not verified",
        reason: "not-verified",
      });
      const stored = await h.store.getDecision(PROJECT, ID);
      expect(stored!.entries).toHaveLength(1);
    });

    it("refuses an expired nonce", async () => {
      const h = await wired();
      h.pass();
      const granted = await askNonce(h, ID);
      const trio = await trioOf(h.store, PROJECT, ID);
      const body = signedBody(
        h,
        ID,
        { verdict: "approved" },
        {
          ...granted,
          ...trio,
        },
      );

      h.pass(121_000);
      const response = await postAnswer(h, ID, body, {});
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: "not verified",
        reason: "not-verified",
      });
    });

    it("refuses a nonce issued for another decision", async () => {
      const h = await wired();
      await h.store.appendRevision(
        PROJECT,
        OTHER,
        storedRevision(1, OTHER),
        0,
        MAX_DECISIONS_PER_PROJECT,
      );
      const granted = await askNonce(h, ID);
      const trio = await trioOf(h.store, PROJECT, OTHER);

      const response = await postAnswer(
        h,
        OTHER,
        signedBody(
          h,
          OTHER,
          { verdict: "approved" },
          {
            nonce: granted.nonce,
            index: 0,
            ...trio,
          },
        ),
        {},
      );

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: "not verified",
        reason: "not-verified",
      });
      const other = await h.store.getDecision(PROJECT, OTHER);
      expect(other!.entries).toEqual([]);
    });

    it("refuses a nonce that was never issued", async () => {
      const h = await wired();
      h.pass();
      // A nonce in the one spelling the contract accepts, but one no route
      // ever minted: 43 base64url characters with the trailing bits at zero.
      const invented = `${"z".repeat(42)}0`;
      const trio = await trioOf(h.store, PROJECT, ID);
      const body = signedBody(
        h,
        ID,
        { verdict: "approved" },
        { nonce: invented, index: 0, ...trio },
      );
      expect(body.nonce).toBe(invented);

      const response = await postAnswer(h, ID, body, {});
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: "not verified",
        reason: "not-verified",
      });
      const stored = await h.store.getDecision(PROJECT, ID);
      expect(stored!.entries).toEqual([]);
    });
  });

  describe("a stale pin is refused with the current trio", () => {
    it("refuses an answer whose text was revised between nonce and answer", async () => {
      const h = await wired();
      h.pass();
      const granted = await askNonce(h, ID);
      const trio = await trioOf(h.store, PROJECT, ID);
      const body = signedBody(
        h,
        ID,
        { verdict: "approved" },
        {
          ...granted,
          ...trio,
        },
      );

      await h.store.appendRevision(
        PROJECT,
        ID,
        { ...storedRevision(2, ID), textSha256: REVISED_HASH },
        1,
        MAX_DECISIONS_PER_PROJECT,
      );
      const response = await postAnswer(h, ID, body, {});

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: "the decision changed",
        reason: "stale",
        revision: 2,
        textSha256: REVISED_HASH,
        entries: 0,
      });
      const stored = await h.store.getDecision(PROJECT, ID);
      expect(stored!.entries).toEqual([]);
    });

    it("refuses an answer a session entry moved past", async () => {
      const h = await wired();
      h.pass();
      const granted = await askNonce(h, ID);
      const trio = await trioOf(h.store, PROJECT, ID);
      const body = signedBody(
        h,
        ID,
        { verdict: "approved" },
        {
          ...granted,
          ...trio,
        },
      );

      await h.store.appendEntry(PROJECT, ID, storedEntry(0), 0, 1);
      const response = await postAnswer(h, ID, body, {});

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: "the decision changed",
        reason: "stale",
        revision: 1,
        textSha256: HASH,
        entries: 1,
      });
    });

    it("refuses a body whose index is not the next entry's", async () => {
      const h = await wired();
      const response = await answerOnce(
        h,
        ID,
        { verdict: "approved" },
        {
          body: { index: 5 },
        },
      );

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: "the decision changed",
        reason: "stale",
        revision: 1,
        textSha256: HASH,
        entries: 0,
      });
      const stored = await h.store.getDecision(PROJECT, ID);
      expect(stored!.entries).toEqual([]);
    });
  });

  it("lets exactly one of two racing answers for one index in", async () => {
    const h = await wired({ trustProxy: true });
    const first = await askNonce(h, ID, { "x-forwarded-for": "198.51.100.1" });
    const second = await askNonce(h, ID, { "x-forwarded-for": "198.51.100.2" });
    const trio = await trioOf(h.store, PROJECT, ID);

    const raced = await Promise.all([
      postAnswer(
        h,
        ID,
        signedBody(h, ID, { verdict: "approved" }, { ...first, ...trio }),
        { headers: { "x-forwarded-for": "198.51.100.1" } },
      ),
      postAnswer(
        h,
        ID,
        signedBody(h, ID, { verdict: "approved" }, { ...second, ...trio }),
        { headers: { "x-forwarded-for": "198.51.100.2" } },
      ),
    ]);

    expect(raced.map((one) => one.status).sort()).toEqual([201, 409]);
    const stored = await h.store.getDecision(PROJECT, ID);
    expect(stored!.entries).toHaveLength(1);
  });

  describe("the one-way doors of W68", () => {
    it.each([
      [
        "a hard-to-undo decision, door shut",
        { hardToUndo: { value: true, reason: "the door is shut" } },
        "one-way-door",
        "the decision is a one-way door",
      ],
      [
        "a hard-to-undo decision, door half shut",
        { hardToUndo: { value: "partly", reason: "half shut" } },
        "one-way-door",
        "the decision is a one-way door",
      ],
      [
        "a decision acted on elsewhere",
        { actElsewhere: { where: "elsewhere", what: "a different thing" } },
        "act-elsewhere",
        "the decision is acted on elsewhere",
      ],
    ] as readonly [string, Partial<DecisionRevision>, string, string][])(
      "%s is refused and nothing is stored",
      async (_name, overrides, reason, sentence) => {
        const h = await wired();
        const id = `door-${reason}`;
        await h.store.appendRevision(
          PROJECT,
          id,
          storedRevision(1, decisionRevision(id, PROJECT, overrides)),
          0,
          MAX_DECISIONS_PER_PROJECT,
        );

        const response = await answerOnce(h, id, { verdict: "approved" });

        expect(response.status).toBe(409);
        expect(await response.json()).toEqual({ error: sentence, reason });
        const stored = await h.store.getDecision(PROJECT, id);
        expect(stored!.entries).toEqual([]);
      },
    );
  });

  describe("a signature over another challenge is not the owner's answer", () => {
    it.each([
      [
        "another verdict",
        (values: AnswerChallengeValues) =>
          answerChallengeText({ ...values, verdict: "declined" }),
      ],
      [
        "another index",
        (values: AnswerChallengeValues) =>
          answerChallengeText({ ...values, index: values.index + 1 }),
      ],
      [
        "another decision",
        (values: AnswerChallengeValues) =>
          answerChallengeText({ ...values, decision: OTHER }),
      ],
      [
        "another project",
        (values: AnswerChallengeValues) =>
          answerChallengeText({ ...values, project: "beta" }),
      ],
    ])("%s", async (_name, challenge) => {
      const h = await wired();
      const response = await answerOnce(
        h,
        ID,
        { verdict: "approved" },
        {
          challenge,
        },
      );

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: "not verified",
        reason: "not-verified",
      });
      const stored = await h.store.getDecision(PROJECT, ID);
      expect(stored!.entries).toEqual([]);
    });
  });

  describe("framing", () => {
    it("refuses a body that is not JSON", async () => {
      const h = await wired();
      const response = await postAnswer(h, ID, "{}", {
        headers: { "content-type": "text/plain" },
      });
      expect(response.status).toBe(415);
      expect(await response.json()).toEqual({
        error: "unsupported media type",
      });
    });

    it("413s a declared body over the cap", async () => {
      const h = await wired();
      const response = await postAnswer(h, ID, "x".repeat(20_000), {});
      expect(response.status).toBe(413);
      expect(await response.json()).toEqual({ error: "body too large" });
    });

    it("413s a chunked body past the cap, and stops reading it", async () => {
      const h = await wired();
      const payload = "x".repeat(16_385);
      const raw = await h.started.raw(
        `POST ${answersPath()} HTTP/1.1`,
        [
          "Content-Type: application/json",
          "Transfer-Encoding: chunked",
          "Connection: close",
        ],
        `${(16_385).toString(16)}\r\n${payload}\r\n0\r\n\r\n`,
      );
      expect(finalStatus(raw)).toBe("HTTP/1.1 413");
      expect(raw).toContain('{"error":"body too large"}');
    });

    it("400s a body that is not utf-8, and one that is not json", async () => {
      const h = await wired();
      const notUtf8 = await h.started.raw(
        `POST ${answersPath()} HTTP/1.1`,
        [
          "Content-Type: application/json",
          "Content-Length: 3",
          "Connection: close",
        ],
        Buffer.from([0xc3, 0x28, 0xff]),
      );
      expect(finalStatus(notUtf8)).toBe("HTTP/1.1 400");
      expect(notUtf8).toContain('{"error":"not utf-8"}');

      h.pass();
      const notJson = await h.started.raw(
        `POST ${answersPath()} HTTP/1.1`,
        [
          "Content-Type: application/json",
          "Content-Length: 1",
          "Connection: close",
        ],
        "{",
      );
      expect(finalStatus(notJson)).toBe("HTTP/1.1 400");
      expect(notJson).toContain('{"error":"bad json"}');
    });

    it("400s a valid json that is not an answer, naming the paths", async () => {
      const h = await wired();
      const response = await postAnswer(h, ID, { schema: "x" }, {});
      expect(response.status).toBe(400);
      const document = (await response.json()) as { errors: unknown[] };
      expect(Array.isArray(document.errors)).toBe(true);
      expect(document.errors.length).toBeGreaterThan(0);
    });

    it("400s a non-canonical base64url spelling of the signature", async () => {
      const h = await wired();
      h.pass();
      const granted = await askNonce(h, ID);
      const trio = await trioOf(h.store, PROJECT, ID);
      const body = signedBody(
        h,
        ID,
        { verdict: "approved" },
        {
          ...granted,
          ...trio,
        },
      );

      const nonCanonical = await postAnswer(
        h,
        ID,
        {
          ...body,
          signature: `${body.signature}=`,
        },
        {},
      );

      expect(nonCanonical.status).toBe(400);
      const document = (await nonCanonical.json()) as { errors: unknown[] };
      expect(Array.isArray(document.errors)).toBe(true);
      const stored = await h.store.getDecision(PROJECT, ID);
      expect(stored!.entries).toEqual([]);
    });

    it("refuses a query string", async () => {
      const h = await wired();
      const response = await fetch(`${h.started.origin}${answersPath()}?x=1`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "bad query" });
    });

    it("refuses a foreign Origin and consumes nothing; its own Origin is accepted", async () => {
      const h = await wired();
      h.pass();
      const granted = await askNonce(h, ID);
      const trio = await trioOf(h.store, PROJECT, ID);
      const body = signedBody(
        h,
        ID,
        { verdict: "approved" },
        {
          ...granted,
          ...trio,
        },
      );

      const foreign = await postAnswer(h, ID, body, {
        origin: "https://evil.example",
      });
      expect(foreign.status).toBe(403);
      expect(await foreign.json()).toEqual({
        error: "cross-origin writes refused",
      });

      // The refused request never reached the nonce or the allowance, so the
      // same body answers now that the origin is the page's own.
      const own = await postAnswer(h, ID, body, { origin: EXPECTED_ORIGIN });
      expect(own.status).toBe(201);
      expect(await own.json()).toEqual({ index: 0, state: "approved" });
    });
  });

  it("429s a second answer from one address within a second", async () => {
    const h = await wired();
    const first = await answerOnce(h, ID, { verdict: "approved" });
    expect(first.status).toBe(201);

    const second = await postAnswer(h, ID, "{}", {});
    expect(second.status).toBe(429);
    expect(second.headers.get("retry-after")).toBe("1");
    expect(await second.json()).toEqual({ error: "too many writes" });
  });

  it("429s an address the answer path has locked out, even for a valid body", async () => {
    const h = await wired();
    const other = buildAssertion();

    // The valid body is asked and signed before the failures, so the lockout
    // is what refuses it and not a refusal of the nonce ask.
    h.pass();
    const granted = await askNonce(h, ID);
    const trio = await trioOf(h.store, PROJECT, ID);
    const valid = signedBody(
      h,
      ID,
      { verdict: "approved" },
      {
        ...granted,
        ...trio,
      },
    );

    for (let attempt = 0; attempt < FAILURE_LIMIT; attempt += 1) {
      const refused = await answerOnce(
        h,
        ID,
        { verdict: "approved" },
        {
          changes: { signingKey: other.privateKey },
        },
      );
      expect(refused.status).toBe(403);
    }

    const response = await postAnswer(h, ID, valid, {});
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "too many failures" });
    const stored = await h.store.getDecision(PROJECT, ID);
    expect(stored!.entries).toEqual([]);
  });

  describe("a read token", () => {
    const CREDENTIAL = {
      authorization: `Basic ${Buffer.from(`waves:${READ_TOKEN}`).toString("base64")}`,
    };

    it("is owed by the answers route, like the reads", async () => {
      const h = await wired({ readToken: READ_TOKEN });

      const refused = await postAnswer(h, ID, "{}", {});
      expect(refused.status).toBe(401);
      expect(await refused.json()).toEqual({ error: "unauthorized" });

      h.pass();
      const nonceAsk = await fetch(`${h.started.origin}${noncePath()}`, {
        method: "POST",
      });
      expect(nonceAsk.status).toBe(401);
    });

    it("accepts a good answer with the right credential", async () => {
      const h = await wired({ readToken: READ_TOKEN });
      const response = await answerOnce(
        h,
        ID,
        { verdict: "approved" },
        {
          headers: CREDENTIAL,
        },
      );
      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({ index: 0, state: "approved" });
    });
  });

  describe("after a signed answer", () => {
    it("refuses a reported state entry on the same text, and a signed one from a token", async () => {
      const h = await wired();
      const answer = await answerOnce(h, ID, { verdict: "approved" });
      expect(answer.status).toBe(201);

      h.pass();
      const reported = await fetch(`${h.started.origin}${statesPath()}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...BEARER(PROJECT_TOKEN),
        },
        body: JSON.stringify(
          stateEntryRequest({
            revision: 1,
            textSha256: HASH,
            expectedEntries: 1,
            source: "reported",
          }),
        ),
      });
      expect(reported.status).toBe(409);
      expect(await reported.json()).toMatchObject({
        error: "a signed answer exists on this text",
      });

      h.pass();
      const signed = await fetch(`${h.started.origin}${statesPath()}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...BEARER(PROJECT_TOKEN),
        },
        body: JSON.stringify({
          ...stateEntryRequest({
            revision: 1,
            textSha256: HASH,
            expectedEntries: 1,
          }),
          // A token cannot write a signed entry: the body claims one anyway,
          // and the refusal is the contract's own.
          source: "signed",
        }),
      });
      expect(signed.status).toBe(400);
      const document = (await signed.json()) as { errors: unknown[] };
      expect(Array.isArray(document.errors)).toBe(true);
    });
  });

  it("answers 500 and stores nothing when the entry the key names cannot be stored", async () => {
    // The key's label is the one field the owner-keys file bounds that no
    // request can carry: a label the stored entry would refuse makes the
    // model's own last check fail, and the answer is the plain 500.
    const owner = buildAssertion();
    const relabelled: readonly LoadedKey[] = [
      {
        key: { ...owner.keys[0]!.key, label: "" },
        publicKey: owner.keys[0]!.publicKey,
      },
    ];
    const h = await wired({ ownerKeys: relabelled });
    const response = await answerOnce(
      h,
      ID,
      { verdict: "approved" },
      {
        changes: { signingKey: owner.privateKey },
      },
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "internal" });
    const stored = await h.store.getDecision(PROJECT, ID);
    expect(stored!.entries).toEqual([]);
  });
});

describe("GET and HEAD on the answer paths", () => {
  it.each(["GET", "HEAD"] as const)(
    "answers 405 with Allow: POST on both paths, for a known and an unknown decision",
    async (method) => {
      const h = await wired();

      for (const path of [noncePath(), answersPath()]) {
        for (const id of [ID, "absent"]) {
          const response = await fetch(
            `${h.started.origin}${path.replace(ID, id)}`,
            { method },
          );
          expect(response.status).toBe(405);
          expect(response.headers.get("allow")).toBe("POST");
          if (method === "GET") {
            expect(await response.json()).toEqual({
              error: "method not allowed",
            });
          }
        }
      }
    },
  );

  it("issues no nonce and touches nothing: a nonce asked before still answers", async () => {
    const h = await wired();
    const granted = await askNonce(h, ID);
    const trio = await trioOf(h.store, PROJECT, ID);

    for (const method of ["GET", "HEAD"] as const) {
      for (const path of [noncePath(), answersPath()]) {
        const response = await fetch(`${h.started.origin}${path}`, {
          method,
        });
        expect(response.status).toBe(405);
      }
    }

    const body = signedBody(
      h,
      ID,
      { verdict: "approved" },
      {
        ...granted,
        ...trio,
      },
    );
    const answer = await postAnswer(h, ID, body, {});
    expect(answer.status).toBe(201);
    expect(await answer.json()).toEqual({ index: 0, state: "approved" });
  });

  it("stays 401 without the read token when one is configured", async () => {
    const h = await wired({ readToken: READ_TOKEN });

    const response = await fetch(`${h.started.origin}${answersPath()}`);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(response.headers.get("www-authenticate")).toBe(
      'Basic realm="waves", charset="UTF-8"',
    );
  });
});

describe("no owner keys, no answers route", () => {
  const UNKNOWN_LAST = "absentword";

  function withoutDate(raw: string): string {
    return raw.replace(/^Date: .*$/m, "");
  }

  async function startedWithoutKeys(): Promise<Started> {
    const store = new MemoryStore();
    await store.putProject({
      id: PROJECT,
      name: "Alpha",
      repo: "https://example.com/alpha.git",
      tokenSha256: digestOf(PROJECT_TOKEN),
      registeredAt: "2026-10-01T12:00:00Z",
    });
    await store.appendRevision(
      PROJECT,
      ID,
      storedRevision(1, ID),
      0,
      MAX_DECISIONS_PER_PROJECT,
    );
    return startHarness({ store });
  }

  it.each(["GET", "HEAD", "POST"] as const)(
    "answers %s on the answers path exactly like an unknown path",
    async (method) => {
      const started = await startedWithoutKeys();

      const answers = withoutDate(
        await started.raw(`${method} ${answersPath()} HTTP/1.1`),
      );
      const nonce = withoutDate(
        await started.raw(`${method} ${noncePath()} HTTP/1.1`),
      );
      const unknown = withoutDate(
        await started.raw(
          `${method} ${noncePath().replace("nonce", UNKNOWN_LAST)} HTTP/1.1`,
        ),
      );

      expect(answers).toBe(unknown);
      expect(nonce).toBe(unknown);
    },
  );
});
