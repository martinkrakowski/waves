import type { DecisionModel } from "./decision-model.js";

/** One section of the decision page, or nothing when the section does not apply. */
export declare function optionsBlock(
  model: DecisionModel,
): HTMLElement | undefined;

/** The commitments the current text's approval would bind the reader to. */
export declare function commitmentsBlock(
  model: DecisionModel,
): HTMLElement | undefined;

/** The evidence links and the references as plain text, or nothing. */
export declare function evidenceBlock(
  model: DecisionModel,
): HTMLElement | undefined;
