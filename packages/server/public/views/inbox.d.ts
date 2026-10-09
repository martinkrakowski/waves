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

/** The line at the foot of the page, saying what the page is for. */
export declare const FOOTER: string;

/** The three group headings, in the order the page draws them. */
export declare const GROUP_HEAD: {
  readonly waiting: string;
  readonly reported: string;
  readonly closed: string;
};

/** The door band text for a head, or `undefined` when the door is `false`. */
export declare function doorBand(head: Head): string | undefined;

/** The state nodes a head carries, by its group. */
export declare function stateNodes(head: Head): HTMLElement[];

/** The "an earlier text was answered" note, or undefined when the head has none. */
export declare function earlierAnswerNode(head: Head): HTMLElement | undefined;

/** One decision card, built from a checked head. */
export declare function card(head: Head, nowMs: number): HTMLElement;

/** One group of cards under its heading, or nothing when the group is empty. */
export declare function groupBlock(
  label: string,
  cls: string,
  heads: readonly Head[],
  nowMs: number,
): HTMLElement | undefined;

export declare function renderInbox(
  model: InboxModel,
  nowMs: number,
): HTMLElement;
