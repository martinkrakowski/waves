/**
 * The answer ceremony behind a decision page's answer controls (design 6.2):
 * the controller with no DOM in it. The page asks the server for a nonce,
 * hashes the revision it is showing, builds the challenge itself, asks the
 * passkey to sign it, and posts the answer. Nothing here reads the browser:
 * `fetch`, `credentials`, `subtle` and `location` all arrive as arguments, so
 * a test can pass fakes for every one of them, and the outcomes are all the
 * buttons will ever be told.
 */

import {
  answerBody,
  answerChallengeText,
  bindingText,
  challengeBytes,
  sha256Hex,
} from "./answer-challenge.js";

/**
 * The contract's bound on `words` (`MAX_TEXT_CHARS`), copied into a name
 * because `public/` has no build step and cannot import the contract package;
 * the test imports the contract's number and holds the two together.
 */
const MAX_WORDS_CHARS = 2000;

/**
 * A second, in milliseconds: shorter than the enrol page's ceiling on purpose,
 * because the server's nonce only lives 120 s — the answer page must give up
 * before the nonce does, so a slow but successful prompt is never refused as
 * `not-verified` and counted as a failure against the owner's address.
 */
const TIMEOUT_MS = 90_000;

/**
 * The four reasons the server refuses a signed answer for, in the words the
 * page has a sentence for. A 409 carrying anything else reads as `failed`,
 * and no other text of a response is ever put into an outcome.
 */
const REFUSAL_REASONS = [
  "one-way-door",
  "act-elsewhere",
  "signed-cap",
  "entry-ceiling",
];

const ACCEPT_JSON = { accept: "application/json" };

function noncePath(project, decision) {
  const base = `/api/v1/projects/${encodeURIComponent(project)}/decisions/${encodeURIComponent(decision)}`;
  return `${base}/nonce`;
}

function answersPath(project, decision) {
  const base = `/api/v1/projects/${encodeURIComponent(project)}/decisions/${encodeURIComponent(decision)}`;
  return `${base}/answers`;
}

/**
 * Whether the page may offer answer controls for the model it is showing, and
 * if not, the one reason why. A decision whose group is `closed` or `history`
 * is closed to answers; a one-way door is the owner's own decision W68 and is
 * never answered here; an act-elsewhere instruction is answered where it says,
 * not signed here. `waiting` and `reported` are both answerable: a signed
 * answer may follow a reported one or an earlier signed one.
 */
export function answerability(model) {
  if (model.head.group === "closed" || model.head.group === "history") {
    return { kind: "no", reason: "closed" };
  }
  const door = model.currentRevision.decision.hardToUndo.value;
  if (door === true || door === "partly") {
    return { kind: "no", reason: "one-way-door" };
  }
  if (model.currentRevision.decision.actElsewhere !== undefined) {
    return { kind: "no", reason: "act-elsewhere" };
  }
  return { kind: "answerable" };
}

/**
 * Whether the server is taking signed answers for this decision at all: it is
 * only when a `GET` of the nonce path answers `405` — the answer route is
 * routed, and the method difference is the probe, so nothing is spent asking.
 * Every other status, and a fetch that never lands, says `false`; never throws.
 */
export async function probeAnswering(fetchImpl, project, decision) {
  try {
    const response = await fetchImpl(noncePath(project, decision), {
      method: "GET",
      headers: ACCEPT_JSON,
    });
    return response.status === 405;
  } catch {
    return false;
  }
}

/**
 * What the owner's own words become before he signs them: NFC-normalised, with
 * no leading or trailing white space. Empty after that is `empty`; longer than
 * the contract's bound on `words` is `too-long`. What this returns is exactly
 * what will be signed and shown to him before he signs.
 */
export function prepareWords(raw) {
  // JavaScript's `trim()` does not strip U+0085 (NEXT LINE), and the server
  // refuses words that begin or end with it; strip it at the edges here.
  const words = raw.normalize("NFC").replace(/^[\s\u0085]+|[\s\u0085]+$/g, "");
  if (words === "") {
    return { ok: false, reason: "empty" };
  }
  // The server refuses `words` holding any control character, and this must
  // happen before he signs: a two-line answer would otherwise be confirmed,
  // signed with the passkey and then refused.
  for (let at = 0; at < words.length; at += 1) {
    const code = words.charCodeAt(at);
    if (code < 0x20 || code === 0x7f) {
      return { ok: false, reason: "not-printable" };
    }
  }
  if (words.length > MAX_WORDS_CHARS) {
    return { ok: false, reason: "too-long" };
  }
  return { ok: true, words };
}

/**
 * The choice a button stands for, as the challenge and the body spell it:
 * `yes` approves, `no` declines, and `words` answers in his own words once
 * they pass `prepareWords`. No `option` is ever sent by this page. Anything
 * else is a button this page did not build, and throws.
 */
export function choiceOf(verdictWord, raw) {
  if (verdictWord === "yes") {
    return { ok: true, choice: { verdict: "approved" } };
  }
  if (verdictWord === "no") {
    return { ok: true, choice: { verdict: "declined" } };
  }
  if (verdictWord === "words") {
    const prepared = prepareWords(raw);
    if (!prepared.ok) {
      return prepared;
    }
    return { ok: true, choice: { verdict: "answered", words: prepared.words } };
  }
  throw new Error(`unknown verdict word: ${verdictWord}`);
}

/** Byte strings as the browser hands them over: buffers, or views over them. */
function isBytes(value) {
  return value instanceof ArrayBuffer || ArrayBuffer.isView(value);
}

/**
 * An assertion shaped the way `credentials.get` answers one: a `rawId` and a
 * `response` carrying the three byte strings. A null or misshapen result is
 * the owner cancelling, not a failure to tell him about.
 */
function isAssertion(value) {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const response = value.response;
  if (response === null || typeof response !== "object") {
    return false;
  }
  return (
    isBytes(value.rawId) &&
    isBytes(response.authenticatorData) &&
    isBytes(response.clientDataJSON) &&
    isBytes(response.signature)
  );
}

/** The nonce reply as the answer route answers it, and nothing else. */
function isNonceReply(reply) {
  return (
    reply !== null &&
    typeof reply === "object" &&
    typeof reply.nonce === "string" &&
    reply.nonce !== "" &&
    typeof reply.index === "number" &&
    Number.isInteger(reply.index) &&
    reply.index >= 0
  );
}

/** The stored reply of `POST …/answers`: an index and a state, and nothing else. */
function isStoredReply(reply) {
  return (
    reply !== null &&
    typeof reply === "object" &&
    Number.isInteger(reply.index) &&
    typeof reply.state === "string"
  );
}

/**
 * The one `sign` of the ceremony, run with no two signs at once. Each step is
 * ordered the way the design's security properties read: a second press while
 * one runs is refused before anything is sent; a page that may not answer is
 * refused before anything is sent; the text the page shows is hashed and held
 * against the server's own hash before a nonce is even asked for, because the
 * owner signs what this page shows, never what a server says it shows; and the
 * index he signs is the count this page shows, with the server's number only
 * compared. The answer never rejects: whatever happens, it is one of the
 * outcomes the buttons can be told.
 */
async function signOnce(model, choice, browser) {
  const answerable = answerability(model);
  if (answerable.kind !== "answerable") {
    return { kind: "not-answerable", reason: answerable.reason };
  }
  const textSha256 = await sha256Hex(
    browser.subtle,
    bindingText(model.currentRevision.decision),
  );
  if (textSha256 !== model.currentRevision.textSha256) {
    return { kind: "text-mismatch" };
  }
  const fetchImpl = browser.fetch;

  const nonceResponse = await fetchImpl(
    noncePath(model.head.project, model.head.id),
    { method: "POST", headers: ACCEPT_JSON },
  );
  if (nonceResponse.status === 404) {
    return { kind: "off" };
  }
  if (nonceResponse.status === 429) {
    return { kind: "busy" };
  }
  if (nonceResponse.status !== 200) {
    return { kind: "failed" };
  }
  const nonceReply = await nonceResponse.json();
  if (!isNonceReply(nonceReply)) {
    return { kind: "failed" };
  }
  const index = model.currentEntries.length + model.earlierEntries.length;
  if (nonceReply.index !== index) {
    return { kind: "moved" };
  }

  const challenge = await challengeBytes(
    browser.subtle,
    answerChallengeText({
      project: model.head.project,
      decision: model.head.id,
      textSha256,
      index,
      verdict: choice.verdict,
      words: choice.words,
      nonce: nonceReply.nonce,
    }),
  );
  let assertion;
  try {
    assertion = await browser.credentials.get({
      publicKey: {
        rpId: browser.location.hostname,
        challenge,
        userVerification: "required",
        timeout: TIMEOUT_MS,
      },
    });
  } catch {
    return { kind: "cancelled" };
  }
  if (!isAssertion(assertion)) {
    return { kind: "cancelled" };
  }

  const answerResponse = await fetchImpl(
    answersPath(model.head.project, model.head.id),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        answerBody(
          {
            revision: model.currentRevision.revision,
            textSha256,
            index,
            verdict: choice.verdict,
            words: choice.words,
            nonce: nonceReply.nonce,
          },
          assertion,
        ),
      ),
    },
  );
  if (answerResponse.status === 201) {
    const stored = await answerResponse.json();
    if (!isStoredReply(stored)) {
      return { kind: "failed" };
    }
    return { kind: "stored", index: stored.index, state: stored.state };
  }
  if (answerResponse.status === 409) {
    const refused = await answerResponse.json();
    if (refused === null || typeof refused !== "object") {
      return { kind: "failed" };
    }
    if (refused.reason === "stale") {
      return { kind: "moved" };
    }
    if (REFUSAL_REASONS.includes(refused.reason)) {
      return { kind: "refused", reason: refused.reason };
    }
    return { kind: "failed" };
  }
  if (answerResponse.status === 403) {
    return { kind: "not-verified" };
  }
  if (answerResponse.status === 404) {
    return { kind: "off" };
  }
  if (answerResponse.status === 429) {
    return { kind: "busy" };
  }
  return { kind: "failed" };
}

/**
 * The answerer the buttons will call, bound to the browser objects it reads
 * from: `fetch` for the two routes, `credentials` for the passkey, `subtle`
 * for the hashes and `location` for the relying party. One `sign` runs at a
 * time on the same answerer — a press while one runs answers `in-progress` —
 * and the guard is released in a `finally` whatever happened, so a failed or
 * thrown attempt never wedges the page.
 */
export function createAnswerer({ fetch, credentials, subtle, location }) {
  let signing = false;
  return {
    async sign(model, choice) {
      if (signing) {
        return { kind: "in-progress" };
      }
      signing = true;
      try {
        return await signOnce(model, choice, {
          fetch,
          credentials,
          subtle,
          location,
        });
      } catch {
        return { kind: "failed" };
      } finally {
        signing = false;
      }
    },
  };
}
