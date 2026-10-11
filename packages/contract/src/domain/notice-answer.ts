import type { AnswerVerdict } from "./model.js";

export const ANSWER_CHALLENGE_SCHEMA = "waves-answer/v1";

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
