/**
 * The shape check for `GET /api/v1/projects/<id>/status`, the one response the
 * status panel draws from. It is strict in the way `wave.js` is: a document the
 * panel would have to guess at is a broken endpoint, and the app treats that as a
 * failed load rather than replacing a page that was right with a panel it could
 * only half fill.
 *
 * Every rule below is a rule the contract already keeps, written out again rather
 * than imported: the contract's own types are not values, and a check that has to
 * re-read a type at every call site is a check nobody keeps right. `project` is
 * the one exception — the page draws no link out of a status, so nothing it reads
 * is a path, and the id is checked only as the string the contract says it is.
 *
 * The enum lists are the ones the panel picks a badge class from, and they are
 * the same four and three the contract writes: a status value outside them is a
 * value the panel would have to give a class of its own, which is the hole the
 * fixed lookup in `views/status-panel.js` closes.
 */

/** The three states a backlog artifact can be in, as the contract fixes them. */
const BACKLOG_STATES = ["recorded", "absent", "unknown"];

/** The four things a premise can be asked about, as the contract fixes them. */
const PREMISE_STATUSES = ["holds", "stale", "timed-out", "error"];

/** The two scopes a set of plans can have. */
const SCOPE_KINDS = ["full", "partial"];

/** One of a closed list of strings, and never anything else. */
function oneOf(value, options) {
  return typeof value === "string" && options.includes(value);
}

/**
 * A whole number of at least zero. Both counts this document carries are counts:
 * `skipped` is how many rows no parser could read and `plans` is how many plans a
 * scope names, so `-1` and `1.5` are not answers to either question.
 */
function count(value) {
  return Number.isInteger(value) && value >= 0;
}

/** One optional string, with nothing else in its place. */
function optionalString(value) {
  return value === undefined || typeof value === "string";
}

/**
 * The staleness window the document sets, in seconds: `null` for the 300 s
 * default, and otherwise the contract's own 1 to 300. An interval of zero is not
 * a window a staleness rule could read, so it is refused here rather than being
 * asked about further down the page.
 */
function intervalSeconds(value) {
  return (
    value === null || (Number.isInteger(value) && value >= 1 && value <= 300)
  );
}

/** The `prs` half: a closed object whose only key is the count it reports. */
function prs(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    Object.keys(value).every((key) => key === "skipped") &&
    count(value.skipped)
  );
}

/** `scope`: a kind and the plans it names, both of them required. */
function scope(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    oneOf(value.kind, SCOPE_KINDS) &&
    Array.isArray(value.plans) &&
    value.plans.every((plan) => typeof plan === "string")
  );
}

/** `git`: a branch and an object id, both of them required. */
function git(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof value.branch === "string" &&
    typeof value.head === "string"
  );
}

/** One premise: a lane, a plan, one of the four statuses, and a reason. */
function premise(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof value.lane === "string" &&
    typeof value.plan === "string" &&
    oneOf(value.status, PREMISE_STATUSES) &&
    optionalString(value.reason)
  );
}

/** The `backlog` half: a state and the four optional things under it. */
function backlog(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    oneOf(value.state, BACKLOG_STATES) &&
    optionalString(value.at) &&
    (value.scope === undefined || scope(value.scope)) &&
    (value.git === undefined || git(value.git)) &&
    (value.premises === undefined ||
      (Array.isArray(value.premises) && value.premises.every(premise)))
  );
}

/**
 * Whether a response is a project status this panel can draw at all. Every field
 * the panel reads has its type, every array is an array, and every enum is among
 * the values the badge lookup below knows — so the class a premise's status
 * chooses is one of four literals and never one this response built.
 */
export function drawableStatus(view) {
  return (
    view !== null &&
    typeof view === "object" &&
    typeof view.receivedAt === "string" &&
    typeof view.stale === "boolean" &&
    typeof view.staleAfterMs === "number" &&
    view.status !== null &&
    typeof view.status === "object" &&
    typeof view.status.project === "string" &&
    typeof view.status.generatedAt === "string" &&
    intervalSeconds(view.status.intervalSeconds) &&
    (view.status.prs === undefined || prs(view.status.prs)) &&
    (view.status.backlog === undefined || backlog(view.status.backlog))
  );
}

/**
 * The `status` of a project summary, which is two facts and not the document:
 * the two optional counts are present exactly when the summary sent them, so a
 * project that never mentioned `prs` cannot arrive as a `0` a reader would take
 * for a count.
 */
export function drawableStatusFacts(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof value.receivedAt === "string" &&
    typeof value.stale === "boolean" &&
    (value.prsSkipped === undefined || count(value.prsSkipped)) &&
    (value.backlogState === undefined ||
      oneOf(value.backlogState, BACKLOG_STATES))
  );
}
