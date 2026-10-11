import type {
  AnswerRequest,
  AnswerVerdict,
  DecisionRevision,
} from "@hexagen-monaco/waves-contract";

/** The values an answer challenge is built from: what is being answered,
 * where it will stand, and what was said. Absent `option` and `words` are
 * `undefined` here and `null` in the text. */
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

/** The answer-request half of the same values: the challenge fields the body
 * of `POST …/answers` carries, plus the revision it answers. */
export interface AnswerBodyValues {
  readonly revision: number;
  readonly textSha256: string;
  readonly index: number;
  readonly verdict: AnswerVerdict;
  readonly option?: string;
  readonly words?: string;
  readonly nonce: string;
}

/** An assertion as the browser returns it from `credentials.get`: byte
 * strings as `ArrayBuffer`s, or as a view over them. */
export interface AssertionResponse {
  readonly authenticatorData: ArrayBuffer | Uint8Array;
  readonly clientDataJSON: ArrayBuffer | Uint8Array;
  readonly signature: ArrayBuffer | Uint8Array;
}

export interface Assertion {
  readonly rawId: ArrayBuffer | Uint8Array;
  readonly response: AssertionResponse;
}

/** The binding text of design 4.3 for one revision's decision. */
export declare function bindingText(decision: DecisionRevision): string;

/** The challenge text the owner signs (design W61). */
export declare function answerChallengeText(
  values: AnswerChallengeValues,
): string;

/** The lower-case hex of SHA-256 of the UTF-8 bytes of `text`. */
export declare function sha256Hex(
  subtle: SubtleCrypto,
  text: string,
): Promise<string>;

/** The 32 SHA-256 bytes of the UTF-8 challenge text, for
 * `navigator.credentials.get({ publicKey: { challenge } })`. */
export declare function challengeBytes(
  subtle: SubtleCrypto,
  text: string,
): Promise<Uint8Array>;

/** The JSON-ready body of `POST …/answers`, with `option` and `words` left out
 * when absent. */
export declare function answerBody(
  values: AnswerBodyValues,
  assertion: Assertion,
): AnswerRequest;
