/**
 * The shape check for `GET /api/v1/projects/<project>/decisions`, the response
 * one project's inbox page draws. It reuses the inbox's `head` check — the
 * heaviest thing either page carries — and extends its closed list of groups
 * with `history`: a decision that left the inbox after fourteen days is kept as
 * a count on its project, not drawn as a card, so the page has a line for it
 * instead.
 *
 * The `project` it is shown for is what the page links its breadcrumb and cards
 * from, so a response whose project id is not the one asked for is a broken
 * endpoint the way a head the page cannot read is: the app treats it as a failed
 * load, never a half-filled page.
 */

import { GROUPS, GROUP_STATES, STATES, count, head } from "./inbox.js";

const PROJECT_GROUPS = [...GROUPS, "history"];
const PROJECT_GROUP_STATES = { ...GROUP_STATES, history: STATES };

/**
 * Whether `view` is one project's inbox this page can draw for `project`: its
 * `project.id` is the one the page was opened for, its four counts pass the
 * inbox's count check, and every decision passes the inbox's `head` check,
 * with `history` allowed as an extra group.
 */
export function drawableProjectInbox(view, project) {
  return (
    view !== null &&
    typeof view === "object" &&
    view.project !== null &&
    typeof view.project === "object" &&
    view.project.id === project &&
    typeof view.project.name === "string" &&
    (view.project.repo === undefined ||
      typeof view.project.repo === "string") &&
    view.counts !== null &&
    typeof view.counts === "object" &&
    count(view.counts.waiting) &&
    count(view.counts.oneWay) &&
    count(view.counts.reported) &&
    count(view.counts.closed) &&
    view.counts.oneWay <= view.counts.waiting &&
    Array.isArray(view.decisions) &&
    view.decisions.every((entry) =>
      head(entry, PROJECT_GROUPS, PROJECT_GROUP_STATES),
    )
  );
}
