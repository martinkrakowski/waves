/**
 * What the answer page signs, computed in the browser (design 6.2 step 3).
 *
 * The page builds the challenge itself from the revision it is showing, so a
 * server cannot choose the bytes the owner signs. `public/` has no build step
 * and cannot import the contract package, so the two text functions are
 * written here again by hand and a parity test holds them to the contract's,
 * byte for byte. Everything else arrives as an argument: the `SubtleCrypto` the
 * hashes are made with, and the assertion exactly as the browser returns it.
 */

import { base64url } from "./enrol-key.js";

/** The schema marker every answer challenge text begins with. */
const ANSWER_CHALLENGE_SCHEMA = "waves-answer/v1";

/**
 * The binding text of design 4.3 for one revision's decision: one JSON text
 * with exactly these keys in exactly this order, built from named fields the
 * way the contract's `decisionBindingText` builds it. The object literal below
 * is the whole of the text — never the caller's object — so a caller's key
 * order and any extra key it carries cannot reach it, and no two different
 * decisions share text.
 */
export function bindingText(decision) {
  const bindings = {
    question: decision.question,
    shape: decision.shape,
    options: decision.options.map((o) => ({
      key: o.key,
      text: o.text,
      cost: o.cost,
    })),
    recommended: decision.recommended
      ? {
          option: decision.recommended.option,
          reason: decision.recommended.reason,
        }
      : null,
    hardToUndo: {
      value: decision.hardToUndo.value,
      reason: decision.hardToUndo.reason ?? null,
    },
    commits: [...decision.commits],
    decider: decision.decider,
    appliesTo: [...decision.appliesTo],
    actElsewhere: decision.actElsewhere
      ? {
          where: decision.actElsewhere.where,
          what: decision.actElsewhere.what,
        }
      : null,
  };
  return JSON.stringify(bindings);
}

/**
 * The bytes the owner signs (design W61): one JSON text with exactly these
 * keys in exactly this order, no white space between tokens, strings escaped
 * as `JSON.stringify` escapes them. Absent `option` and `words` are `null` in
 * the text, and the object literal below is the whole of the text — never the
 * caller's object — so a caller's key order and any extra key it carries
 * cannot reach it.
 */
export function answerChallengeText(values) {
  const bindings = {
    v: ANSWER_CHALLENGE_SCHEMA,
    project: values.project,
    decision: values.decision,
    textSha256: values.textSha256,
    index: values.index,
    verdict: values.verdict,
    option: values.option ?? null,
    words: values.words ?? null,
    nonce: values.nonce,
  };
  return JSON.stringify(bindings);
}

/** The lower-case hex of SHA-256 of the UTF-8 bytes of `text`. */
export async function sha256Hex(subtle, text) {
  const bytes = new Uint8Array(
    await subtle.digest("SHA-256", new TextEncoder().encode(text)),
  );
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * The 32 SHA-256 bytes of the UTF-8 challenge text: what goes into
 * `navigator.credentials.get({ publicKey: { challenge } })`. The browser
 * shows the owner this hash, and the assertion he signs carries it back.
 */
export async function challengeBytes(subtle, text) {
  return new Uint8Array(
    await subtle.digest("SHA-256", new TextEncoder().encode(text)),
  );
}

/**
 * The JSON-ready body of `POST …/answers`: exactly the contract's
 * `AnswerRequest` keys, with `option` and `words` left out when absent (the
 * validator reads their absence, never a `null`). The assertion is a
 * `PublicKeyCredential` as the browser returns it — `rawId` and the three byte
 * strings of `response` are `ArrayBuffer`s, each spelled as canonical
 * base64url — and the signature goes over as the browser gives it, in DER.
 */
export function answerBody(values, assertion) {
  const response = assertion.response;
  return {
    revision: values.revision,
    textSha256: values.textSha256,
    index: values.index,
    verdict: values.verdict,
    ...(values.option !== undefined ? { option: values.option } : {}),
    ...(values.words !== undefined ? { words: values.words } : {}),
    nonce: values.nonce,
    credentialId: base64url(assertion.rawId),
    authenticatorData: base64url(response.authenticatorData),
    clientDataJSON: base64url(response.clientDataJSON),
    signature: base64url(response.signature),
  };
}
