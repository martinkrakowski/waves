/**
 * The one home for the two id shapes the page understands: a project id and a
 * wave or lane id. The server holds its own routes to the same patterns, so a
 * segment that fails one here is a segment the page has no page for.
 *
 * A project id is what goes into a path segment and into the API, so it is
 * lower-case and short. A wave id is what a pusher chose, so it may hold upper
 * case, an underscore and a dash.
 */

/** A project id: 1 to 63 characters, lower-case, no slash. */
const PROJECT_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** A wave or lane id: 1 to 80 characters of the pusher's own alphabet. */
const WAVE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;

export function isProjectId(value) {
  return typeof value === "string" && PROJECT_ID.test(value);
}

export function isWaveId(value) {
  return typeof value === "string" && WAVE_ID.test(value);
}
