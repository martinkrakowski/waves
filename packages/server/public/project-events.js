/**
 * The shape check for `GET /api/v1/projects/<project>/events`: the one response
 * this page draws for a project's inbox. It is checked here rather than in the
 * view because the event ids it carries are what the page draws as timestamps:
 * an id that is not a string, a receivedAt that is not a date, or an event
 * naming a project the page was not opened for is a response the page has no
 * path for, and a page that guessed one is a dead end a reader can see and not
 * follow.
 *
 * The `project` it is shown for is the id the page was opened for, and the
 * events carry it as that same string: an event whose project id is not the one
 * asked for is a broken endpoint the way a head the page cannot read is.
 *
 * Each event's `schema` is exactly the string `waves-notice/v1`: another value,
 * or no value at all, is a response this page has no contract for.
 */

import { time } from "./inbox.js";
import { isWaveId } from "./patterns.js";

/** The topic of a notice event: lower-case letters and hyphens, 1 to 32. */
const TOPIC_PATTERN = /^[a-z][a-z-]{0,31}$/;

/** The most events the listing answers with. */
const MAX_EVENTS = 200;

/** A whole number of at least one: a PR number in event refs. */
function positiveInt(value) {
  return Number.isSafeInteger(value) && value >= 1;
}

/**
 * The optional `refs` object: a wave id, a lane id and a PR number. Lane ids
 * share the wave id pattern in `patterns.js`, so `isWaveId` checks both. An
 * array is an object whose `wave`, `lane` and `pr` are all absent, so it is
 * refused before the field checks.
 */
function eventRefs(refs) {
  return (
    refs !== null &&
    typeof refs === "object" &&
    !Array.isArray(refs) &&
    (refs.wave === undefined || isWaveId(refs.wave)) &&
    (refs.lane === undefined || isWaveId(refs.lane)) &&
    (refs.pr === undefined || positiveInt(refs.pr))
  );
}

/**
 * One event as the store holds and the route answers it: the id the server gave
 * it, the moment the server received it, and the notice event it wraps.
 */
function storedEvent(entry, project) {
  return (
    entry !== null &&
    typeof entry === "object" &&
    typeof entry.id === "string" &&
    entry.id.length > 0 &&
    time(entry.receivedAt) &&
    entry.event !== null &&
    typeof entry.event === "object" &&
    entry.event.kind === "event" &&
    entry.event.schema === "waves-notice/v1" &&
    entry.event.project === project &&
    typeof entry.event.topic === "string" &&
    TOPIC_PATTERN.test(entry.event.topic) &&
    typeof entry.event.text === "string" &&
    entry.event.text.length > 0 &&
    (entry.event.detail === undefined ||
      typeof entry.event.detail === "string") &&
    time(entry.event.at) &&
    (entry.event.refs === undefined || eventRefs(entry.event.refs))
  );
}

/**
 * Whether `view` is a project's events this page can draw for `project`: an
 * `events` array of at most 200 members, each a stored event whose event names
 * the project asked for. An event naming another project is refused, not
 * half-shown.
 */
export function drawableProjectEvents(view, project) {
  return (
    view !== null &&
    typeof view === "object" &&
    Array.isArray(view.events) &&
    view.events.length <= MAX_EVENTS &&
    view.events.every((entry) => storedEvent(entry, project))
  );
}
