import {
  SHA256_RULE,
  TEXT_RULE,
  readNoticeText,
  readOptionKey,
} from "./notice.js";
import type { AnswerRequest, AnswerSignature, AnswerVerdict } from "./model.js";
import type { Collector, StringRule, ValidationResult } from "./validation.js";
import {
  IssueCollector,
  normalise,
  own,
  readClosedObject,
  readEnum,
  readIntegerAtLeast,
  readOptional,
  readText,
} from "./validation.js";

export const ANSWER_CHALLENGE_SCHEMA = "waves-answer/v1";

const ANSWER_REQUEST_KEYS = [
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
];

export const ANSWER_SIGNATURE_KEYS = [
  "credentialId",
  "authenticatorData",
  "clientDataJSON",
  "signature",
  "nonce",
  "index",
];

const ANSWER_VERDICTS = ["approved", "declined", "answered"] as const;

/** Base64url with no padding: the alphabet of the bytes a browser hands over.
 * `+`, `/` and `=` are refused, a length of 4n+1 decodes to no whole number of
 * bytes and is refused, and the bits at the end of the last character that no
 * byte uses must be zero — so one run of bytes has one spelling. The two
 * trailing forms are the two lengths that are not a multiple of four: two
 * characters whose last is in `AQgw`, three whose last is in
 * `AEIMQUYcgkosw048`. The empty string matches; the `minChars` of each rule is
 * what refuses it. */
const BASE64URL_PATTERN =
  /^(?:[A-Za-z0-9_-]{4})*(?:[A-Za-z0-9_-][AQgw]|[A-Za-z0-9_-]{2}[AEIMQUYcgkosw048])?$/;

/** 43 base64url characters is 32 bytes, the size of a nonce. */
export const NONCE_RULE: StringRule = {
  minChars: 43,
  maxChars: 43,
  pattern: BASE64URL_PATTERN,
};
export const CREDENTIAL_ID_RULE: StringRule = {
  minChars: 16,
  maxChars: 1366,
  pattern: BASE64URL_PATTERN,
};
export const AUTHENTICATOR_DATA_RULE: StringRule = {
  minChars: 50,
  maxChars: 1024,
  pattern: BASE64URL_PATTERN,
};
export const CLIENT_DATA_RULE: StringRule = {
  minChars: 20,
  maxChars: 2048,
  pattern: BASE64URL_PATTERN,
};
export const ANSWER_SIGNATURE_RULE: StringRule = {
  minChars: 8,
  maxChars: 200,
  pattern: BASE64URL_PATTERN,
};

/** The values a challenge is built from: what is being answered, where it will
 * stand, and what was said. Absent `option` and `words` are `undefined` here
 * and `null` in the text. */
export interface AnswerChallengeValues {
  readonly project: string;
  readonly decision: string;
  readonly textSha256: string;
  readonly index: number;
  readonly verdict: AnswerVerdict;
  readonly option?: string;
  readonly words?: string;
  readonly nonce: string;
}

/**
 * The bytes the owner signs (design W61): one JSON text with exactly these keys
 * in exactly this order, no white space between tokens, strings escaped as
 * `JSON.stringify` escapes them. The object literal below is the whole of the
 * text — never the caller's object — so a caller's key order and any extra key
 * it carries cannot reach it, and no two different sets of values share text.
 */
export function answerChallengeText(values: AnswerChallengeValues): string {
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

/** The assertion the owner signed, as a stored entry keeps it: the six fields
 * with the same bounds the answer request gives them. */
export function readAnswerSignature(
  ctx: Collector,
  value: unknown,
  path: string,
): AnswerSignature | undefined {
  const record = readClosedObject(ctx, value, path, ANSWER_SIGNATURE_KEYS);
  if (record === undefined) return undefined;
  const credentialId = readText(
    ctx,
    own(record, "credentialId"),
    `${path}/credentialId`,
    CREDENTIAL_ID_RULE,
  );
  const authenticatorData = readText(
    ctx,
    own(record, "authenticatorData"),
    `${path}/authenticatorData`,
    AUTHENTICATOR_DATA_RULE,
  );
  const clientDataJSON = readText(
    ctx,
    own(record, "clientDataJSON"),
    `${path}/clientDataJSON`,
    CLIENT_DATA_RULE,
  );
  const signature = readText(
    ctx,
    own(record, "signature"),
    `${path}/signature`,
    ANSWER_SIGNATURE_RULE,
  );
  const nonce = readText(
    ctx,
    own(record, "nonce"),
    `${path}/nonce`,
    NONCE_RULE,
  );
  const index = readIntegerAtLeast(
    ctx,
    own(record, "index"),
    `${path}/index`,
    0,
  );
  if (
    credentialId === undefined ||
    authenticatorData === undefined ||
    clientDataJSON === undefined ||
    signature === undefined ||
    nonce === undefined ||
    index === undefined
  ) {
    return undefined;
  }
  return {
    credentialId,
    authenticatorData,
    clientDataJSON,
    signature,
    nonce,
    index,
  };
}

/** What a verdict says about itself: `answered` carries an option or his own
 * words, `declined` carries no option. Nothing else is inferred from the
 * verdict, and a field that fails is refused, never repaired. */
function applyAnswerRules(
  ctx: Collector,
  verdict: AnswerVerdict | undefined,
  optionPresent: boolean,
  wordsPresent: boolean,
): void {
  if (verdict === "answered" && !optionPresent && !wordsPresent) {
    ctx.add("/verdict", "expected option or words for an answered verdict");
  }
  if (verdict === "declined" && optionPresent) {
    ctx.add("/option", "expected no option for a declined verdict");
  }
}

function readAnswerRequest(
  ctx: Collector,
  input: unknown,
): AnswerRequest | undefined {
  const record = readClosedObject(ctx, input, "", ANSWER_REQUEST_KEYS);
  if (record === undefined) return undefined;

  const revision = readIntegerAtLeast(
    ctx,
    own(record, "revision"),
    "/revision",
    1,
  );
  const textSha256 = readText(
    ctx,
    own(record, "textSha256"),
    "/textSha256",
    SHA256_RULE,
  );
  const index = readIntegerAtLeast(ctx, own(record, "index"), "/index", 0);
  const verdict = readEnum(
    ctx,
    own(record, "verdict"),
    "/verdict",
    ANSWER_VERDICTS,
  );
  const option = readOptional(
    ctx,
    own(record, "option"),
    "/option",
    readOptionKey,
  );
  const words = readOptional(ctx, own(record, "words"), "/words", (c, v, p) =>
    readNoticeText(c, v, p, TEXT_RULE),
  );
  const nonce = readText(ctx, own(record, "nonce"), "/nonce", NONCE_RULE);
  const credentialId = readText(
    ctx,
    own(record, "credentialId"),
    "/credentialId",
    CREDENTIAL_ID_RULE,
  );
  const authenticatorData = readText(
    ctx,
    own(record, "authenticatorData"),
    "/authenticatorData",
    AUTHENTICATOR_DATA_RULE,
  );
  const clientDataJSON = readText(
    ctx,
    own(record, "clientDataJSON"),
    "/clientDataJSON",
    CLIENT_DATA_RULE,
  );
  const signature = readText(
    ctx,
    own(record, "signature"),
    "/signature",
    ANSWER_SIGNATURE_RULE,
  );

  applyAnswerRules(
    ctx,
    verdict,
    own(record, "option") !== undefined,
    own(record, "words") !== undefined,
  );

  if (ctx.issues.length > 0) return undefined;

  return {
    revision: revision!,
    textSha256: textSha256!,
    index: index!,
    verdict: verdict!,
    option,
    words,
    nonce: nonce!,
    credentialId: credentialId!,
    authenticatorData: authenticatorData!,
    clientDataJSON: clientDataJSON!,
    signature: signature!,
  };
}

/** The body of a signed answer (design W61). A closed object: an unknown key is
 * refused. This validator says nothing about whether the signature is good —
 * that is `node:crypto` work in an adapter — only that the bytes he signed are
 * present and within their bounds. */
export function validateAnswerRequest(
  input: unknown,
): ValidationResult<AnswerRequest> {
  const normalised = normalise(input, "answer request");
  if (!normalised.ok) {
    return { ok: false, errors: normalised.errors };
  }
  const ctx = new IssueCollector();
  const value = readAnswerRequest(ctx, normalised.value);
  if (value === undefined) {
    return { ok: false, errors: ctx.issues };
  }
  return { ok: true, value };
}
