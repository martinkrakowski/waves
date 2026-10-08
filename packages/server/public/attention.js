/**
 * The shape check for `GET /api/v1/attention`, the one response that says what
 * every project's lanes are asking for. It is checked here rather than in the
 * view because the three ids it carries are what the fleet panel builds a link
 * out of: an id that fails its pattern is a response the page has no path for,
 * and a page that guesses one is a dead end a reader can see and not follow.
 *
 * The reason list is the same seven the server derives them from, written out
 * again rather than imported, because `query.js` keeps its own copy for the
 * query string and the page reads no module for a constant it is going to
 * compare seven strings against anyway.
 */

import { isProjectId, isWaveId } from "./patterns.js";

/** The seven reasons a lane is asked about, in the order the server writes them. */
export const REASONS = [
  "failed",
  "disagreement",
  "checks",
  "gate",
  "exit",
  "silent",
  "no-pr",
];

/**
 * The label a reason is drawn under. It is the reason's own value, except for
 * `no-pr`, so a badge or a chip reads "no PR" where the value stays `no-pr` in
 * the address and the response (`?reason=no-pr`).
 */
export function reasonLabel(reason) {
  return reason === "no-pr" ? "no PR" : reason;
}

/** One project's own count, as the `projects` list answers it. */
function projectCount(entry) {
  return (
    entry !== null &&
    typeof entry === "object" &&
    typeof entry.id === "string" &&
    typeof entry.attention === "number"
  );
}

/**
 * How many in-window waves the route did not read. It is a whole number of waves,
 * so `0` is the answer and `-1` and `1.5` are not: the fleet note is only as
 * true as this number.
 */
function omitted(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

/** A lane asked about: at least one reason, and only the seven. */
function reasons(reasons_) {
  return (
    Array.isArray(reasons_) &&
    reasons_.length > 0 &&
    reasons_.every((reason) => REASONS.includes(reason))
  );
}

/**
 * One lane, with the two optional fields it may or may not carry. A `pr` is a
 * pull-request number, so it is a whole number of at least one: `0` is not a
 * pull request and `1.5` is not a number of them.
 */
function lane(entry) {
  return (
    entry !== null &&
    typeof entry === "object" &&
    isProjectId(entry.project) &&
    isWaveId(entry.wave) &&
    isWaveId(entry.lane) &&
    reasons(entry.reasons) &&
    typeof entry.receivedAt === "string" &&
    typeof entry.stale === "boolean" &&
    (entry.seat === undefined || typeof entry.seat === "string") &&
    (entry.pr === undefined || (Number.isInteger(entry.pr) && entry.pr >= 1))
  );
}

/**
 * Whether a response is an attention view this page can draw at all. A view
 * holding a lane it cannot read is a broken endpoint: the app treats it as a
 * failed load rather than replacing counters that were right with a panel it
 * could only half fill.
 */
export function drawableAttention(view) {
  return (
    view !== null &&
    typeof view === "object" &&
    typeof view.truncated === "boolean" &&
    omitted(view.wavesOmitted) &&
    Array.isArray(view.lanes) &&
    Array.isArray(view.projects) &&
    view.lanes.every(lane) &&
    view.projects.every(projectCount)
  );
}
