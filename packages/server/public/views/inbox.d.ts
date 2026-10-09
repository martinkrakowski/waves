import type { Head } from "../../src/application/notice-read-model.js";
import type { InboxModel } from "./inbox-model.js";

/** The three shapes in a word: "choice", "action only you run", "standing instruction". */
export declare const SHAPE_WORD: {
  readonly choice: string;
  readonly action: string;
  readonly instruction: string;
};

/** Who may decide, in a word: "yours to decide" or "may be decided under delegation". */
export declare const DECIDER_WORD: {
  readonly owner: string;
  readonly delegated: string;
};

/** The door band text for a head, or `undefined` when the door is `false`. */
export declare function doorBand(head: Head): string | undefined;

/** The state nodes a head carries, by its group. */
export declare function stateNodes(head: Head): HTMLElement[];

export declare function renderInbox(
  model: InboxModel,
  nowMs: number,
): HTMLElement;
