import type { DecisionModel } from "./decision-model.js";

/** Which of the three answers a confirmation is about to sign. */
export type AnswerChoice =
  | { readonly verdict: "approved" }
  | { readonly verdict: "declined" }
  | { readonly verdict: "answered"; readonly words: string };

/** One step of the answer flow, as the logic lane hands it to this view. */
export type AnswerUi =
  | {
      readonly kind: "idle";
      /** The outcome of the last try, drawn above the choices when there was one. */
      readonly message?: string;
    }
  | {
      readonly kind: "words";
      readonly draft: string;
      /** Why the draft cannot be signed as it stands, when it cannot. */
      readonly problem?: "empty" | "too-long";
    }
  | { readonly kind: "confirm"; readonly choice: AnswerChoice }
  | { readonly kind: "working"; readonly choice: AnswerChoice };

/** What the page does when a control is pressed; `maxWords` caps the draft. */
export interface AnswerHandlers {
  onYes(): void;
  onNo(): void;
  onWords(): void;
  onDraft(value: string): void;
  onContinue(): void;
  onCancel(): void;
  onSign(): void;
  readonly maxWords: number;
}

/** How the answer flow ended, as the logic lane reports it to the page. */
export type AnswerOutcome =
  | { readonly kind: "stored" }
  | { readonly kind: "moved" }
  | { readonly kind: "off" }
  | { readonly kind: "busy" }
  | { readonly kind: "cancelled" }
  | { readonly kind: "not-verified" }
  | { readonly kind: "text-mismatch" }
  | { readonly kind: "refused"; readonly reason?: string }
  | { readonly kind: "not-answerable" }
  | { readonly kind: "in-progress" }
  | { readonly kind: "failed" };

/** The line the page puts under the answer controls, wherever it draws them. */
export declare const ANSWER_FOOTER: string;

/** The textarea's id, so the page can put the caret back after a redraw. */
export declare const WORDS_ID: string;

/**
 * The note that replaces the controls for a decision this page cannot answer.
 * Only `one-way-door` has one; every other reason is the state's to word.
 */
export declare function notAnswerableNote(
  reason: string,
): HTMLElement | undefined;

/** The sentence for an outcome the answer flow ended in. */
export declare function outcomeMessage(outcome: AnswerOutcome): string;

/**
 * Draws the answer controls from the state the logic lane holds. Throws for a
 * `ui.kind` that is not one of the four steps this view knows.
 */
export declare function answerSection(
  model: DecisionModel,
  ui: AnswerUi,
  handlers: AnswerHandlers,
): HTMLElement;
