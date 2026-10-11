import type { DecisionModel } from "./decision-model.js";

/**
 * The answer lane's half of the page, as its controller hands it over: the node
 * to draw where the controls belong, and the sentence the footer says instead
 * of the page's own. Left out, the footer keeps the page's own sentence.
 */
export interface DecisionAnswer {
  readonly node: HTMLElement;
  /** The footer's sentence; the page's own when left out. */
  readonly footer?: string;
}

/** The optional second argument of `renderDecision`. */
export interface DecisionAnswerOptions {
  readonly answer: DecisionAnswer;
}

/**
 * The full decision page, read-only, assembled from the model — with the
 * answer lane's half drawn in only when it is given.
 */
export declare function renderDecision(
  model: DecisionModel,
  answer?: DecisionAnswerOptions,
): HTMLElement;
