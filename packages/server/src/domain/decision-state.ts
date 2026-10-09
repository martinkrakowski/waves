import type { DecisionState } from "@hexagen-monaco/waves-contract";

import type {
  StoredDecision,
  StoredEntry,
  StoredRevision,
} from "../application/ports/notice-store.js";

export type DecisionGroup = "waiting" | "reported" | "closed" | "history";

/** A state whose meaning is an answer to the question. */
export function isAnswer(state: DecisionState): boolean {
  return state === "approved" || state === "declined" || state === "answered";
}

/**
 * The current text's run: the unbroken tail of revisions whose `textSha256`
 * equals the current revision's. A revision that changed only a non-binding
 * field (same hash) is the same text and stays in the run; a new hash starts a
 * new run and ends the old one, so an entry written under an earlier text is
 * never "on the current text" again even if that exact text returns later
 * (rule 1 and rule 4).
 */
function currentTextRun(
  decision: StoredDecision,
): { firstRevision: number; hash: string } | undefined {
  const revisions = decision.revisions;
  if (revisions.length === 0) {
    return undefined;
  }
  const hash = (revisions[revisions.length - 1] as StoredRevision).textSha256;
  let first = revisions.length - 1;
  while (
    first > 0 &&
    (revisions[first - 1] as StoredRevision).textSha256 === hash
  ) {
    first--;
  }
  return { firstRevision: (revisions[first] as StoredRevision).revision, hash };
}

/**
 * Whether an entry is on the current text: its `textSha256` matches the current
 * revision's and its `revision` is at or after the first revision of the current
 * text's run. `currentEntry`, `earlierAnswer` and `coveredAnswer` all use it so
 * they agree on what "current text" means.
 */
function isOnCurrentText(
  entry: StoredEntry,
  run: { firstRevision: number; hash: string },
): boolean {
  return entry.textSha256 === run.hash && entry.revision >= run.firstRevision;
}

/**
 * The current state entry: the last entry on the current text, or undefined when
 * no entry is on it. An entry is on the current text only when its hash matches
 * the current revision's and its revision is within the current text's run, so a
 * returned text does not wake an entry from before its own run.
 */
export function currentEntry(
  decision: StoredDecision,
): StoredEntry | undefined {
  const run = currentTextRun(decision);
  if (run === undefined) {
    return undefined;
  }
  let found: StoredEntry | undefined;
  for (const entry of decision.entries) {
    if (isOnCurrentText(entry, run)) {
      found = entry;
    }
  }
  return found;
}

/**
 * The current state: the current entry's state, or `open` when there is none —
 * a revision with new binding text therefore returns the decision to open, which
 * is what rule 4 depends on.
 */
export function decisionState(decision: StoredDecision): DecisionState {
  const entry = currentEntry(decision);
  return entry === undefined ? "open" : entry.state;
}

/**
 * The last answer on a text that is not the current one: the case where a writer
 * reported an answer that a later revision's new text supersedes. The current
 * text's run is what "not the current text" means here, so an entry from before
 * the run is an earlier answer even when the text later returns. `open` and
 * `delegated` are not answers, so they never appear here.
 */
export function earlierAnswer(
  decision: StoredDecision,
): StoredEntry | undefined {
  const run = currentTextRun(decision);
  if (run === undefined) {
    return undefined;
  }
  let found: StoredEntry | undefined;
  for (const entry of decision.entries) {
    if (!isOnCurrentText(entry, run) && isAnswer(entry.state)) {
      found = entry;
    }
  }
  return found;
}

/**
 * A reported answer is fresh for 14 days from the entry's receive time; after
 * that it lives on in the project's history. The same window closes a
 * session-closed decision.
 */
export const REPORTED_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

function withinWindow(entry: StoredEntry, nowMs: number): boolean {
  return nowMs - Date.parse(entry.receivedAt) <= REPORTED_WINDOW_MS;
}

/**
 * Which inbox group a decision is in at `nowMs`:
 * - `waiting`: `open` (no current entry) or `delegated`.
 * - `reported`: a current answer entry received within the window.
 * - `closed`: a current `withdrawn` or `superseded` entry received within the window.
 * - `history`: anything older, and nothing older re-enters the inbox (rule 1).
 */
export function groupOf(
  decision: StoredDecision,
  nowMs: number,
): DecisionGroup {
  const entry = currentEntry(decision);
  if (entry === undefined || entry.state === "delegated") {
    return "waiting";
  }
  if (isAnswer(entry.state)) {
    return withinWindow(entry, nowMs) ? "reported" : "history";
  }
  return withinWindow(entry, nowMs) ? "closed" : "history";
}

/**
 * The answer a withdrawal or supersession covers: the last answer on the current
 * text, before it. Shown beside the session's statement so a session cannot
 * remove an answer by covering it; `undefined` when there is none.
 */
export function coveredAnswer(
  decision: StoredDecision,
): StoredEntry | undefined {
  const run = currentTextRun(decision);
  if (run === undefined) {
    return undefined;
  }
  const current = currentEntry(decision);
  if (current === undefined) {
    return undefined;
  }
  if (current.state !== "withdrawn" && current.state !== "superseded") {
    return undefined;
  }
  let found: StoredEntry | undefined;
  for (const entry of decision.entries) {
    if (
      isOnCurrentText(entry, run) &&
      entry.index < current.index &&
      isAnswer(entry.state)
    ) {
      found = entry;
    }
  }
  return found;
}
