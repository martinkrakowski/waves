import type { DecisionState } from "@hexagen-monaco/waves-contract";

import type {
  StoredDecision,
  StoredEntry,
} from "../application/ports/notice-store.js";

export type DecisionGroup = "waiting" | "reported" | "closed" | "history";

/** A state whose meaning is an answer to the question. */
export function isAnswer(state: DecisionState): boolean {
  return state === "approved" || state === "declined" || state === "answered";
}

/**
 * The current revision, the top of the append-only list: a decision store always
 * creates it with revision 1, so a stored decision has at least one.
 */
function currentRevision(
  decision: StoredDecision,
): StoredDecision["revisions"][number] | undefined {
  return decision.revisions[decision.revisions.length - 1];
}

/**
 * The current state entry: the last entry whose `textSha256` is the current
 * revision's, or undefined when no entry matches the current text. Two entries on
 * the same text are kept (and both count); this returns the one that stands.
 */
export function currentEntry(
  decision: StoredDecision,
): StoredEntry | undefined {
  const revision = currentRevision(decision);
  if (revision === undefined) {
    return undefined;
  }
  const hash = revision.textSha256;
  let found: StoredEntry | undefined;
  for (const entry of decision.entries) {
    if (entry.textSha256 === hash) {
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
 * reported an answer that a later revision's new text supersedes. `open` and
 * `delegated` are not answers, so they never appear here.
 */
export function earlierAnswer(
  decision: StoredDecision,
): StoredEntry | undefined {
  const revision = currentRevision(decision);
  if (revision === undefined) {
    return undefined;
  }
  const hash = revision.textSha256;
  let found: StoredEntry | undefined;
  for (const entry of decision.entries) {
    if (entry.textSha256 !== hash && isAnswer(entry.state)) {
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
 * The answer a withdrawal or supersession covers: the last answer on the same
 * text as the current entry, before it. Shown beside the session's statement so
 * a session cannot remove an answer by covering it; `undefined` when there is none.
 */
export function coveredAnswer(
  decision: StoredDecision,
): StoredEntry | undefined {
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
      entry.index < current.index &&
      entry.textSha256 === current.textSha256 &&
      isAnswer(entry.state)
    ) {
      found = entry;
    }
  }
  return found;
}
