import type { DecisionView } from "../src/application/notice-read-model.js";

/**
 * Whether a response is the decision page this app can draw: the whole record of
 * one decision, with its head, revisions and state entries, where the head's
 * `project` and `id` equal the ones the page asked for.
 */
export declare function drawableDecision(
  view: unknown,
  project: string,
  id: string,
): view is DecisionView;
