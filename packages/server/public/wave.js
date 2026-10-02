/**
 * The two shape checks the wave strip leans on, and the two functions that read
 * a list of wave heads. Nothing here draws: the project page draws the strip
 * from these, and the shape check for a project's lanes leans on `drawableWaves`
 * so the two answers agree about what a wave head is.
 */

/** The required fields of one wave head, as the wave list endpoint sends it. */
function waveHead(head) {
  return (
    head !== null &&
    typeof head === "object" &&
    typeof head.wave === "string" &&
    typeof head.receivedAt === "string" &&
    (head.intervalSeconds === null ||
      typeof head.intervalSeconds === "number") &&
    typeof head.lanes === "number" &&
    typeof head.stale === "boolean" &&
    typeof head.retained === "boolean"
  );
}

/** The required fields of one lane, as the wave endpoint sends it. */
function drawableLane(lane) {
  return (
    lane !== null &&
    typeof lane === "object" &&
    typeof lane.id === "string" &&
    lane.derived !== null &&
    typeof lane.derived === "object" &&
    (typeof lane.derived.alive === "boolean" ||
      lane.derived.alive === "unknown") &&
    Array.isArray(lane.disagreements)
  );
}

/**
 * Whether a response is a wave this view can draw at all. A wave that is
 * missing a field it renders, or that describes a lane the lane table cannot
 * read, is a broken endpoint: the app treats it as a failed load rather than
 * replacing lanes that were right with a table it could only half fill.
 *
 * Kept with its test for lane K6's drawer, which asks for one wave at a time.
 */
export function drawableWave(view) {
  return (
    view !== null &&
    typeof view === "object" &&
    typeof view.receivedAt === "string" &&
    typeof view.stale === "boolean" &&
    typeof view.staleAfterMs === "number" &&
    view.envelope !== null &&
    typeof view.envelope === "object" &&
    typeof view.envelope.wave === "string" &&
    typeof view.envelope.generatedAt === "string" &&
    Array.isArray(view.envelope.lanes) &&
    view.envelope.lanes.every(drawableLane)
  );
}

/**
 * Whether a response is a list this view can show at all. A list holding an
 * entry it cannot show is a broken endpoint, and the app treats it as a failed
 * load rather than replacing a wave list that was right with a shorter one.
 */
export function drawableWaves(waves) {
  return Array.isArray(waves) && waves.every(waveHead);
}

/** The waves the list can show: the ones the API could actually describe. */
function presentWaves(waves) {
  return waves.filter((head) => head !== null && head !== undefined);
}

export function visibleWaves(waves, showAll) {
  const kept = presentWaves(waves);
  return showAll ? kept : kept.filter((head) => head.retained);
}
