import type { ProjectInboxView } from "../../src/application/notice-read-model.js";

/**
 * The page for one project's inbox: the project's own four counts and the
 * decisions that wait on it — its own, in all four groups, plus the standing
 * instructions other projects raised against it (marked `from`). The page
 * reuses the inbox's card, group block and count line so the two read the same
 * way. `name` is the project's display name from the projects listing, or the
 * project id when the listing has none.
 */
export declare function renderProjectInbox(
  view: ProjectInboxView,
  nowMs: number,
  name: string,
): HTMLElement;
