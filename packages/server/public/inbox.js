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
const SHAPES = ["choice", "action", "instruction"];

/** The seven states a decision can be in, as the server derives them. */
const STATES = [
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
const GROUPS = ["waiting", "reported", "closed"];

/** The two sources an answer can carry, as the contract allows. */
const SOURCES = ["session", "reported"];

/** A whole number of at least zero: a count, a revision or an entry count. */
function count(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

/** One of a closed list of strings, and nothing else. */
function oneOf(value, options) {
  return typeof value === "string" && options.includes(value);
}

/**
 * An answer on a head: the current answer to a reported decision, the answer a
 * withdrawal covers, or the answer given to an earlier text. Its state is one of
 * the seven, but only an answer state reaches here — the model that built it
 * filters on `isAnswer`, so a state that is not approved, declined or answered
 * would be a response this page has no verdict word for. The check stays open to
 * the full list, the same way `door` stays open to the three values and lets the
 * view pick the label: a closed list is what stops a stored payload that picked a
 * fourth from landing a class of its own.
 */
function answer(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    oneOf(value.state, STATES) &&
    oneOf(value.source, SOURCES) &&
    typeof value.at === "string" &&
    typeof value.by === "string" &&
    (value.words === undefined || typeof value.words === "string") &&
    (value.option === undefined || typeof value.option === "string")
  );
}

/**
 * A door: a value of `true`, `false` or `"partly"`, and when it is not `false`
 * an optional reason that is the session's own sentence, shown verbatim.
 */
function door(value) {
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
function actElsewhere(value) {
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
const GROUP_STATES = {
  waiting: ["open", "delegated"],
  reported: ["approved", "declined", "answered"],
  closed: ["withdrawn", "superseded"],
};

function head(entry) {
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
    typeof entry.textSha256 === "string" &&
    count(entry.entries) &&
    oneOf(entry.state, STATES) &&
    (entry.source === undefined || oneOf(entry.source, SOURCES)) &&
    typeof entry.at === "string" &&
    oneOf(entry.group, GROUPS) &&
    GROUP_STATES[entry.group].includes(entry.state) &&
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
    entry.decisions.every(head)
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
