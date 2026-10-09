/**
 * The shape check for `GET /api/v1/projects`, and nothing else. The list it
 * guards is drawn by the shell's rail and by the fleet page; what this file
 * decides is only whether a response is a list the page can draw at all.
 *
 * Every rule below is a rule the read model already keeps, written out again
 * rather than imported: the read model's own types are not values, and a check
 * that has to re-read a type at every call site is a check nobody keeps right.
 * What is imported is the wave-id pattern, which is the one rule the page has to
 * agree with by value — a wave id it cannot pattern-match is a wave it has no
 * path for.
 */

import { isWaveId } from "./patterns.js";
import { drawableStatusFacts } from "./status.js";

/** The four states a wave's lanes can derive, as the read model derives them. */
const WAVE_STATES = ["failed", "done", "running", "settled"];

/**
 * The most recent waves one summary carries, as the server bounds it. A list
 * longer than this is not a list the page would draw: it is a server that
 * answered a different question.
 */
const MAX_RECENT_WAVES = 12;

/**
 * The optional `status` of a summary, when it has one: absent for a project that
 * has pushed no status, and a `status` the card cannot read makes the whole list
 * undrawable — a card showing a backlog state it had to guess would be a card
 * claiming something about a project the server never said.
 */
function statusOf(project) {
  return project.status === undefined || drawableStatusFacts(project.status);
}

/** A whole number of at least zero: a count of waves, lanes or pull requests. */
function count(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

/**
 * The optional `decisions` of a summary, when it carries one: the four counts
 * and the rule that oneWay is at most waiting. Absent is valid — a project that
 * never raised a decision says nothing here, and a `0` a reader would take for
 * a count is not the same as never having said a count.
 */
function decisionsOf(project) {
  return (
    project.decisions === undefined ||
    (project.decisions !== null &&
      typeof project.decisions === "object" &&
      count(project.decisions.waiting) &&
      count(project.decisions.oneWay) &&
      count(project.decisions.reported) &&
      count(project.decisions.closed) &&
      project.decisions.oneWay <= project.decisions.waiting)
  );
}

/**
 * One entry of `recentWaves`. A wave id that fails its pattern is a wave the
 * page has no path for, and `merged` above `lanes` is a count the page would
 * draw as more than a hundred per cent: both are a broken endpoint rather than a
 * card to guess at. `state` is checked against the four literals because that is
 * the list the fleet page picks a colour and a word from.
 */
function recentWave(wave) {
  return (
    wave !== null &&
    typeof wave === "object" &&
    isWaveId(wave.wave) &&
    typeof wave.receivedAt === "string" &&
    count(wave.lanes) &&
    count(wave.merged) &&
    wave.merged <= wave.lanes &&
    WAVE_STATES.includes(wave.state) &&
    typeof wave.stale === "boolean"
  );
}

/**
 * The waves a card reads beside the project's own counts. The key is never
 * absent — a project with no retained wave answers `[]` — so its absence is a
 * response this page cannot draw from.
 */
function recentWavesOf(project) {
  return (
    Array.isArray(project.recentWaves) &&
    project.recentWaves.length <= MAX_RECENT_WAVES &&
    project.recentWaves.every(recentWave)
  );
}

/**
 * `repo` is absent or a string, and the rule is the contract's own: a project
 * registration reads it through `readOptional`, so `undefined` is absence and
 * anything else has to be an https URL, and a stored project never carries a
 * `null` in place of either (`readOptional`, `readProject`,
 * `packages/contract/src/domain/validation.ts:151-161`,
 * `packages/contract/src/domain/project.ts:82`).
 *
 * The fleet's search lowercases this field, so a summary carrying a number or an
 * object here is not a project the page can draw: without this rule the page
 * would throw inside a draw the first time a reader searched, which is a whole
 * page lost to one field of one entry.
 */
function repoOf(project) {
  return project.repo === undefined || typeof project.repo === "string";
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
    repoOf(project) &&
    recentWavesOf(project) &&
    statusOf(project) &&
    decisionsOf(project)
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
