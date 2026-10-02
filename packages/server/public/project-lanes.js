/**
 * The shape check for `GET /api/v1/projects/<id>/lanes`, the one response the
 * project page draws from. It is checked here rather than in the view because
 * the ids it carries are what the view builds its links out of: a wave or lane id
 * that fails its pattern is a response the page has no path for, and a page that
 * guesses one is a dead end a reader can see and not follow.
 *
 * Every rule below is a rule the read model already keeps, written out again
 * rather than imported: the contract's own types are not values, and a check
 * that has to re-read a type at every call site is a check nobody keeps right.
 * What is imported is the one list the page has to compare against by value —
 * the six reasons of `attention.js`, which are the six the server derives them
 * from — and the wave list check, which is a rule about the same wave heads the
 * wave strip draws.
 */

import { REASONS } from "./attention.js";
import { isProjectId, isWaveId } from "./patterns.js";
import { drawableWaves } from "./wave.js";

/** The three events a lane reports, as the contract fixes them. */
const LANE_EVENTS = ["started", "settled", "failed"];

/** The three states a pull request is in, as the contract fixes them. */
const PR_STATES = ["open", "merged", "closed"];

/** The five answers a check run can give, as the contract fixes them. */
const CHECK_STATUSES = ["none", "pending", "pass", "fail", "unknown"];

/** One of a closed list of strings, and never anything else. */
function oneOf(value, options) {
  return typeof value === "string" && options.includes(value);
}

/**
 * A whole number of at least `least`. A pull request numbered zero is not a
 * pull request and `1.5` is not a number of them; a round before the first is
 * not a round.
 */
function count(value, least) {
  return Number.isInteger(value) && value >= least;
}

/** The four percentages a gate measured, all of them present or none. */
function coverage(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof value.statements === "number" &&
    typeof value.branches === "number" &&
    typeof value.functions === "number" &&
    typeof value.lines === "number"
  );
}

/** What the last push derived about the gate the lane claims to have passed. */
function gate(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    (value.exit === undefined || typeof value.exit === "number") &&
    (value.coverage === undefined || coverage(value.coverage))
  );
}

/** The pull request the last push derived, with its own thread count. */
function pullRequest(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    count(value.number, 1) &&
    oneOf(value.state, PR_STATES) &&
    oneOf(value.checks, CHECK_STATUSES) &&
    (value.unresolvedThreads === undefined ||
      typeof value.unresolvedThreads === "number" ||
      value.unresolvedThreads === "unknown")
  );
}

/** The three counts a diff stat is made of. */
function diff(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof value.files === "number" &&
    typeof value.insertions === "number" &&
    typeof value.deletions === "number"
  );
}

/**
 * The tail the lane pushed, as this route answers it: whether there is one and
 * when it was last written. The text of the tail is not in this response, so
 * `tail` is a boolean here and a string in the wave route's own.
 */
function log(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof value.bytes === "number" &&
    typeof value.mtimeMs === "number" &&
    typeof value.tail === "boolean"
  );
}

/** What the last push derived about one lane. */
function derived(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    (typeof value.alive === "boolean" || value.alive === "unknown") &&
    (value.exit === undefined || typeof value.exit === "number") &&
    (value.gate === undefined || gate(value.gate)) &&
    (value.pr === undefined || pullRequest(value.pr)) &&
    (value.diff === undefined || diff(value.diff)) &&
    (value.planReview === undefined || typeof value.planReview === "string") &&
    (value.risk === undefined || typeof value.risk === "string") &&
    (value.log === undefined || log(value.log))
  );
}

/** What the lane itself reported: a stage, an event and when it said so. */
function reported(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof value.stage === "string" &&
    oneOf(value.event, LANE_EVENTS) &&
    typeof value.ts === "string" &&
    (value.pr === undefined || count(value.pr, 1)) &&
    (value.round === undefined || count(value.round, 0))
  );
}

/** The reasons, and only the six. An empty list is an answer, not a hole. */
function reasons(value) {
  return (
    Array.isArray(value) && value.every((reason) => REASONS.includes(reason))
  );
}

/**
 * One row. A lane id is a wave id's pattern because the pusher chose both, so
 * the same check answers for `wave` and for `id`.
 */
function laneRow(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    isWaveId(value.wave) &&
    isWaveId(value.id) &&
    (value.seat === undefined || typeof value.seat === "string") &&
    (value.reported === undefined || reported(value.reported)) &&
    derived(value.derived) &&
    typeof value.disagreements === "number" &&
    (value.disagreement === undefined ||
      typeof value.disagreement === "string") &&
    reasons(value.reasons)
  );
}

/** The project the rows belong to, which the page puts in its own heading. */
function project(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    isProjectId(value.id) &&
    typeof value.name === "string" &&
    (value.repo === undefined || typeof value.repo === "string")
  );
}

/**
 * Whether a response is a project listing this view can draw at all. A view
 * holding a row it cannot read is a broken endpoint: the app treats it as a
 * failed load rather than replacing a table that was right with one it could
 * only half fill, which would be a page quietly lying about what the last push
 * derived.
 */
export function drawableProjectLanes(view) {
  return (
    view !== null &&
    typeof view === "object" &&
    typeof view.truncated === "boolean" &&
    project(view.project) &&
    drawableWaves(view.waves) &&
    view.waves.every((head) => isWaveId(head.wave)) &&
    Array.isArray(view.lanes) &&
    view.lanes.every(laneRow)
  );
}
