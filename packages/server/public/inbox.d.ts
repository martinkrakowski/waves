import type { InboxView } from "../src/application/notice-read-model.js";

/**
 * Whether a value is an inbox view this page can draw: `{ projects: [...] }`,
 * one entry per registered project, each holding the four counts and the
 * heads of the decisions still in the reader's inbox.
 */
export declare function drawableInbox(view: unknown): view is InboxView;

/**
 * A head the inbox can draw. `groups` and `groupStates` default to the inbox's
 * own closed sets; a caller that also accepts `history` passes both so the
 * check reuses the same logic instead of copying it.
 */
export declare function head(
  entry: unknown,
  groups?: readonly string[],
  groupStates?: Readonly<Record<string, readonly string[]>>,
): boolean;
