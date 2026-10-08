import type { Lane, PullRequestState } from "@hexagen-monaco/waves-contract";

export type AttentionReason =
  "failed" | "disagreement" | "checks" | "gate" | "exit" | "silent" | "no-pr";

/** The order a lane's reasons are always answered in, whatever holds. */
export const ATTENTION_REASONS: readonly AttentionReason[] = [
  "failed",
  "disagreement",
  "checks",
  "gate",
  "exit",
  "silent",
  "no-pr",
];

/**
 * How long a wave is still worth asking about across every project, counted
 * from the moment the server received it. It is the cross-project view's window
 * only: inside one project the reader has chosen the scope.
 */
export const ATTENTION_WINDOW_MS = 72 * 60 * 60 * 1000;

/** The most lanes the cross-project view answers with. */
export const MAX_ATTENTION_LANES = 200;

/** An exit status is only a failure when it is a number and it is not zero. */
export function isFailureExit(exit: number | undefined): boolean {
  return exit !== undefined && exit !== 0;
}

/**
 * Whether a lane's pull request has been merged or closed, which is the state in
 * which the open questions it raised have been answered. `attentionReasons` makes
 * it the first thing it checks and `waveState` makes it the exclusion a failing
 * lane is measured against, so it is one predicate rather than two rules that
 * could drift apart.
 */
export function prSettled(state: PullRequestState | undefined): boolean {
  return state === "merged" || state === "closed";
}

/**
 * The stage names the `no-pr` reason recognises. The contract leaves `stage` to
 * the project that pushed the wave, so these are the server's fixed list rather
 * than a vocabulary a pusher could vary: two projects write `merge`, one writes
 * `merged`, and `record` is the stage after a merge. The rest — `deploy`,
 * `deployed`, `tag`, `plan` — are not merge work, and a lane that never had a
 * pull request is not asked about for one of them.
 */
const NO_PR_STAGES: readonly string[] = ["merge", "merged", "record"];

/**
 * Whether a lane reported its merge as settled, or is already being recorded,
 * and carries no pull request number anywhere. `attentionReasons` has already
 * answered a merged or closed pull request with no reasons before it asks, so
 * the `derived.pr` check here is what keeps an open one out. A `reported.pr`
 * with no `derived.pr` is not held either: a number was given.
 */
function holdsNoPr(lane: Lane): boolean {
  const reported = lane.reported;
  if (reported === undefined) {
    return false;
  }
  if (!NO_PR_STAGES.includes(reported.stage)) {
    return false;
  }
  // `record` is the stage after a merge and accepts any event; `merge` and
  // `merged` only count when the event says the work settled, so a merge still
  // in flight is not asked about.
  if (reported.stage !== "record") {
    if (reported.event !== "settled") {
      return false;
    }
  }
  return reported.pr === undefined && lane.derived.pr === undefined;
}

/**
 * Why one stored lane wants a reader's attention, in `ATTENTION_REASONS` order.
 * `waveStale` is the staleness of the wave the lane is in, and it is what turns
 * a lane nobody has heard from since into `silent`.
 *
 * A lane whose pull request is merged or closed is done: it answers no reasons
 * however the rest of it looks, because the open questions it raised have been
 * answered and its stale data cannot contradict them.
 *
 * `no-pr` is last because it is the lane's own report, not the wave's: a lane
 * that reported a settled merge or a record and named no pull request wants a
 * reader to notice that the merge was never linked to a pull request, and it
 * ranks after every fault the lane or the wave could hold against it.
 */
export function attentionReasons(
  lane: Lane,
  waveStale: boolean,
): readonly AttentionReason[] {
  const state = lane.derived.pr?.state;
  if (prSettled(state)) {
    return [];
  }
  const reasons: AttentionReason[] = [];
  if (lane.reported?.event === "failed") {
    reasons.push("failed");
  }
  if (lane.disagreements.length > 0) {
    reasons.push("disagreement");
  }
  if (lane.derived.pr?.checks === "fail") {
    reasons.push("checks");
  }
  if (isFailureExit(lane.derived.gate?.exit)) {
    reasons.push("gate");
  }
  if (lane.derived.alive === false && isFailureExit(lane.derived.exit)) {
    reasons.push("exit");
  }
  if (
    waveStale &&
    lane.derived.alive === true &&
    lane.derived.exit === undefined
  ) {
    reasons.push("silent");
  }
  if (holdsNoPr(lane)) {
    reasons.push("no-pr");
  }
  return reasons;
}

/** Whether a wave received at `receivedAtMs` is still inside the window at `nowMs`. */
export function inAttentionWindow(
  receivedAtMs: number,
  nowMs: number,
): boolean {
  return nowMs - receivedAtMs <= ATTENTION_WINDOW_MS;
}
