import type { ProjectInboxView } from "../src/application/notice-read-model.js";

/**
 * Whether a value is one project's inbox view this page can draw for the project
 * the page was opened for: `project` is the id string of that project, `counts`
 * holds the four counts the inbox checks, and every decision passes the inbox's
 * `head` check, with `history` allowed as an extra group.
 */
export declare function drawableProjectInbox(
  view: unknown,
  project: string,
): view is ProjectInboxView;
