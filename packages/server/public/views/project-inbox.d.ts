import type { ProjectInboxView } from "../../src/application/notice-read-model.js";
import type { StoredEvent } from "../../src/application/ports/notice-store.js";

/**
 * The page for one project's inbox: the project's own four counts and the
 * decisions that wait on it — its own, in all four groups, plus the standing
 * instructions other projects raised against it (marked `from`). The page
 * reuses the inbox's card, group block and count line so the two read the same
 * way. History heads — decisions that left the inbox after fourteen days — are
 * drawn as a collapsed details block, and the project's notice events are
 * listed beside them. `name` is the project's display name from the projects
 * listing, or the project id when the listing has none. `events` is the
 * checked events the page draws beside the decisions.
 */
export declare function renderProjectInbox(
  view: ProjectInboxView,
  name: string,
  events: readonly StoredEvent[],
  nowMs: number,
): HTMLElement;
