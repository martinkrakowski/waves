import type {
  Head,
  InboxView,
  NoticeCounts,
} from "../../src/application/notice-read-model.js";

/** One project in the inbox model, with its decisions split into the three groups. */
export interface InboxProjectModel {
  readonly id: string;
  readonly name: string;
  /** The four counts, each naming what it is and never summed into one. */
  readonly counts: NoticeCounts;
  /** The heads waiting on the reader, in the order the server sorted them. */
  readonly waiting: readonly Head[];
  /** The heads reported as answered. */
  readonly reported: readonly Head[];
  /** The heads closed by a session. */
  readonly closed: readonly Head[];
}

/** The inbox's model: sorted projects and the four totals across all of them. */
export interface InboxModel {
  readonly projects: readonly InboxProjectModel[];
  readonly totals: NoticeCounts;
}

/**
 * One project's four counts as one line: "3 waiting (1 one-way door) · 2 reported
 * · 1 closed by a session". The same wording for the page's totals and for a
 * project's own line, so a reader never has to read two ways.
 */
export declare function countLine(counts: NoticeCounts): string;

/**
 * The inbox's model, built from the checked response: the projects sorted with the
 * ones that have decisions first, each split into the three groups, and the four
 * totals that headline the page.
 */
export declare function inboxModel(view: InboxView): InboxModel;
