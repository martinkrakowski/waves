/**
 * The shape check for `GET /api/v1/inbox`, the one response that says what is
 * waiting on the owner across every project. It is checked here rather than in
 * the view because the project ids and decision ids it carries are what the page
 * builds links out of: an id that fails its pattern is a response the page has no
 * path for, and a page that guessed one is a dead end a reader can see and not
 * follow.
 *
 * The door value and the state are the same closed lists the server derives
 * them from, written out again rather than imported — the contract's own types
 * are not values, and a check that re-reads a type at every call site is a check
 * nobody keeps right.
 */

import { isProjectId, isWaveId } from "./patterns.js";

/** The three shapes a decision can have, as the server derives them. */
export const SHAPES = ["choice", "action", "instruction"];

/** The seven states a decision can be in, as the server derives them. */
export const STATES = [
  "open",
  "delegated",
  "approved",
  "declined",
  "answered",
  "withdrawn",
  "superseded",
];

/**
 * The three groups the inbox draws. History is not among them: the server
 * leaves a decision older than fourteen days out of the inbox entirely, so a
 * head that calls itself one is a response the page has no heading for.
 */
export const GROUPS = ["waiting", "reported", "closed"];

/** The two sources an answer can carry, as the contract allows. */
export const SOURCES = ["session", "reported"];

/** A whole number of at least zero: a count, a revision or an entry count. */
export function count(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

/** One of a closed list of strings, and nothing else. */
export function oneOf(value, options) {
  return typeof value === "string" && options.includes(value);
}

/** A time the page can print: a string that parses as a date. */
export function time(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

/** Three states that are an answer; every other state is not one. */
export const ANSWER_STATES = ["approved", "declined", "answered"];

/**
 * An answer on a head: the answer a withdrawal covers, or the answer given to an
 * earlier text. It is one of the three answer states and nothing else, because
 * the page has a verdict word for those three only; and its source is
 * `reported`, because that is the only source an answer can have before signing
 * exists, and the card's sentence says "it had been reported that you …".
 */
export function answer(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    oneOf(value.state, ANSWER_STATES) &&
    value.source === "reported" &&
    time(value.at) &&
    typeof value.by === "string" &&
    (value.words === undefined || typeof value.words === "string") &&
    (value.option === undefined || typeof value.option === "string")
  );
}

/**
 * A door: a value of `true`, `false` or `"partly"`, and when it is not `false`
 * an optional reason that is the session's own sentence, shown verbatim.
 */
export function door(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    (value.value === true ||
      value.value === false ||
      value.value === "partly") &&
    (value.reason === undefined || typeof value.reason === "string")
  );
}

/** The optional place a card tells the reader to act: a where and a what. */
export function actElsewhere(value) {
  if (value === undefined) {
    return true;
  }
  return (
    value !== null &&
    typeof value === "object" &&
    typeof value.where === "string" &&
    typeof value.what === "string"
  );
}

/**
 * One decision head, as the inbox answers it. The `project` it names is the one
 * it was raised by, and `from` — when present — is the project it was raised by
 * as well, so the page links it to a project it has a path for and never
 * invents one. A head is the heaviest thing the inbox carries, so it is the one
 * the check is most detailed about: a head missing a state, or one carrying a
 * group the page has no section for, would leave a card the reader could not
 * finish reading.
 */
/**
 * The states each group may hold. The server derives a head's group from its
 * state, so the two can only disagree in a response the page should not draw: a
 * `closed` card whose state is `open` has no sentence to say what closed it.
 */
export const GROUP_STATES = {
  waiting: ["open", "delegated"],
  reported: ["approved", "declined", "answered"],
  closed: ["withdrawn", "superseded"],
};

export function head(entry, groups = GROUPS, groupStates = GROUP_STATES) {
  return (
    entry !== null &&
    typeof entry === "object" &&
    isProjectId(entry.project) &&
    isWaveId(entry.id) &&
    typeof entry.question === "string" &&
    oneOf(entry.shape, SHAPES) &&
    door(entry.door) &&
    oneOf(entry.decider, ["owner", "delegated"]) &&
    count(entry.revision) &&
    count(entry.revisions) &&
    entry.revision >= 1 &&
    entry.revision <= entry.revisions &&
    typeof entry.textSha256 === "string" &&
    count(entry.entries) &&
    oneOf(entry.state, STATES) &&
    (entry.source === undefined || oneOf(entry.source, SOURCES)) &&
    time(entry.at) &&
    oneOf(entry.group, groups) &&
    (entry.group !== "reported" || entry.source === "reported") &&
    groupStates[entry.group].includes(entry.state) &&
    actElsewhere(entry.actElsewhere) &&
    (entry.earlierAnswer === undefined || answer(entry.earlierAnswer)) &&
    (entry.coveredAnswer === undefined || answer(entry.coveredAnswer)) &&
    (entry.from === undefined || isProjectId(entry.from))
  );
}

/**
 * One project's entry in the inbox: an id and name the page links from, the four
 * counts that name their own sources and never sum to one, and the decisions the
 * page draws. A `oneWay` above `waiting` is a count the page cannot read — the
 * one-way doors are a part of the waiting ones, not something beside them — so
 * the whole project entry is refused.
 */
function inboxProjectEntry(entry) {
  return (
    entry !== null &&
    typeof entry === "object" &&
    isProjectId(entry.id) &&
    typeof entry.name === "string" &&
    entry.counts !== null &&
    typeof entry.counts === "object" &&
    count(entry.counts.waiting) &&
    count(entry.counts.oneWay) &&
    count(entry.counts.reported) &&
    count(entry.counts.closed) &&
    entry.counts.oneWay <= entry.counts.waiting &&
    Array.isArray(entry.decisions) &&
    entry.decisions.every((entry) => head(entry))
  );
}

/**
 * Whether a response is an inbox this page can draw at all. A response holding a
 * project or a decision it cannot read is a broken endpoint: the app treats it as
 * a failed load rather than replacing a page that was right with one it could
 * only half fill.
 */
export function drawableInbox(view) {
  return (
    view !== null &&
    typeof view === "object" &&
    Array.isArray(view.projects) &&
    view.projects.every(inboxProjectEntry)
  );
}
