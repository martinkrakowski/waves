import type { DecisionModel } from "./decision-model.js";

/** The history timeline: revisions and entries merged by time, newest first. */
export declare function historyBlock(model: DecisionModel): HTMLElement;

/** The earlier texts as collapsed `<details>`, one per prior revision. */
export declare function earlierTextsBlock(
  model: DecisionModel,
): HTMLElement | undefined;
