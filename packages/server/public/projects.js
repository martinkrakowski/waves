/**
 * The shape check for `GET /api/v1/projects`, and nothing else. The list it
 * guards is drawn by the shell's rail and by the fleet page; what this file
 * decides is only whether a response is a list the page can draw at all.
 */

import { drawableStatusFacts } from "./status.js";

/**
 * The optional `status` of a summary, when it has one: absent for a project that
 * has pushed no status, and a `status` the card cannot read makes the whole list
 * undrawable — a card showing a backlog state it had to guess would be a card
 * claiming something about a project the server never said.
 */
function statusOf(project) {
  return project.status === undefined || drawableStatusFacts(project.status);
}

function present(project) {
  return (
    project !== null &&
    typeof project === "object" &&
    typeof project.id === "string" &&
    typeof project.name === "string" &&
    typeof project.waves === "number" &&
    typeof project.lanes === "number" &&
    typeof project.stale === "boolean" &&
    statusOf(project)
  );
}

/**
 * Whether a response is a list this view can draw at all. A list holding an
 * entry it cannot draw is not a list of projects: it is a broken endpoint, and
 * the app treats it as a failed load rather than replacing a page that was
 * right with one that claims the registry is empty.
 */
export function drawableProjects(projects) {
  return Array.isArray(projects) && projects.every(present);
}
