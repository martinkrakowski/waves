import type { EventView } from "../src/application/notice-read-model.js";

/**
 * Whether `view` is a project's events view this page can draw for the project
 * the page was opened for: an `events` array of at most 200 members, each a
 * stored event whose event names that project.
 */
export declare function drawableProjectEvents(
  view: unknown,
  project: string,
): view is EventView;
