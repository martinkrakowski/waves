import type { InboxView } from "../src/application/notice-read-model.js";

/**
 * Whether a value is an inbox view this page can draw: `{ projects: [...] }`,
 * one entry per registered project, each holding the four counts and the
 * heads of the decisions still in the reader's inbox.
 */
export declare function drawableInbox(view: unknown): view is InboxView;
