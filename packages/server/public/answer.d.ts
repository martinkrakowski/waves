import type { AnswerVerdict } from "@hexagen-monaco/waves-contract";

import type { DecisionModel } from "./views/decision-model.js";

/**
 * The answer page's logic, with no DOM in it: the browser objects it reads
 * from — `fetch`, `credentials`, `subtle`, `location` — all arrive as
 * arguments, so a test can pass fakes for every one of them.
 */

/** Why a decision is not answerable on this page, in the page's own words. */
export type NoAnswerReason = "closed" | "one-way-door" | "act-elsewhere";

export type Answerability =
  | { readonly kind: "answerable" }
  | { readonly kind: "no"; readonly reason: NoAnswerReason };

/** What `prepareWords` says about the owner's own words before he signs them. */
export type PreparedWords =
  | { readonly ok: true; readonly words: string }
  | { readonly ok: false; readonly reason: "empty" | "too-long" };

/**
 * The choice a button stands for, as the challenge and the body spell it:
 * `approved`, `declined`, or `answered` in the owner's own words. No `option`
 * is ever sent by this page.
 */
export type Choice =
  | { readonly verdict: "approved" }
  | { readonly verdict: "declined" }
  | { readonly verdict: "answered"; readonly words: string };

export type ChoiceResult =
  | { readonly ok: true; readonly choice: Choice }
  | { readonly ok: false; readonly reason: "empty" | "too-long" };

/** The four reasons the server refuses a signed answer for. */
export type RefusalReason =
  "one-way-door" | "act-elsewhere" | "signed-cap" | "entry-ceiling";

/**
 * Every way the ceremony can end, and the only things the buttons are told.
 * Nothing a response said reaches an outcome except the checked `index`,
 * `state` and the four known reason words.
 */
export type AnswerOutcome =
  | { readonly kind: "stored"; readonly index: number; readonly state: string }
  | { readonly kind: "off" }
  | { readonly kind: "busy" }
  | { readonly kind: "moved" }
  | { readonly kind: "text-mismatch" }
  | { readonly kind: "cancelled" }
  | { readonly kind: "not-verified" }
  | { readonly kind: "refused"; readonly reason: RefusalReason }
  | { readonly kind: "not-answerable"; readonly reason: NoAnswerReason }
  | { readonly kind: "in-progress" }
  | { readonly kind: "failed" };

/** A response as this page reads it: the status and, when it asks, the JSON. */
export interface AnswerResponse {
  readonly status: number;
  json(): Promise<unknown>;
}

/** A `fetch` this page can call, faked in tests. */
export type AnswerFetch = (
  path: string,
  init?: {
    readonly method?: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly body?: string;
  },
) => Promise<AnswerResponse>;

/** The browser objects the answerer reads from, faked in tests. */
export interface AnswererDeps {
  readonly fetch: AnswerFetch;
  readonly credentials: {
    get(options: CredentialRequestOptions): Promise<unknown>;
  };
  readonly subtle: SubtleCrypto;
  readonly location: { readonly hostname: string };
}

/** The answerer the buttons call; one `sign` runs at a time. */
export interface Answerer {
  sign(model: DecisionModel, choice: Choice): Promise<AnswerOutcome>;
}

/**
 * Whether the page may offer answer controls for the model it is showing,
 * and if not, the one reason why.
 */
export declare function answerability(model: DecisionModel): Answerability;

/**
 * Whether the server is taking signed answers for this decision at all:
 * only when a `GET` of the nonce path answers `405`. Never throws.
 */
export declare function probeAnswering(
  fetchImpl: AnswerFetch,
  project: string,
  decision: string,
): Promise<boolean>;

/**
 * What the owner's own words become before he signs them: NFC-normalised,
 * with no leading or trailing white space, and inside the contract's bound.
 */
export declare function prepareWords(raw: string): PreparedWords;

/** The choice a button stands for; an unknown verdict word throws. */
export declare function choiceOf(
  verdictWord: "yes" | "no" | "words",
  raw: string,
): ChoiceResult;

/** Build a fresh answerer bound to the given browser objects. */
export declare function createAnswerer(deps: AnswererDeps): Answerer;
