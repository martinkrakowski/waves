import { projectList } from "../projects.js";

/**
 * The fleet page: every registered project as a card. It is given projects that
 * have already passed the shape check, and it returns a node for the shell to
 * put in its page area.
 *
 * K4 replaces this body with the counters and the attention panel; the signature
 * is what stays.
 */

export function renderFleet(model, nowMs) {
  return projectList(model.projects, nowMs);
}
