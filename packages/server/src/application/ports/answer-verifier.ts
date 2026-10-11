/**
 * The assertion of a signed answer, exactly as the request carried it: the
 * four strings the owner's device produced. No `node:*` type reaches this
 * port — `Uint8Array` and the verifier's exceptions stay in the adapter.
 */
export interface AnswerAssertion {
  readonly credentialId: string;
  readonly authenticatorData: string;
  readonly clientDataJSON: string;
  readonly signature: string;
}

/**
 * Whether the assertion is the owner's: `ok` carries the label of the key
 * that signed (which names the owner on the stored entry), and a refusal
 * carries its reason. The reason goes to the log only, never into the
 * outcome a caller can read.
 */
export type AnswerVerdictResult =
  | { readonly ok: true; readonly label: string }
  | { readonly ok: false; readonly reason: string };

/**
 * The answer side of signature verification, injected into the answer model
 * so it stays free of `node:crypto`. The challenge text is the exact string
 * the owner signed, built by the model from what is stored.
 */
export type AnswerVerifier = (
  assertion: AnswerAssertion,
  expectedChallengeText: string,
) => AnswerVerdictResult;
