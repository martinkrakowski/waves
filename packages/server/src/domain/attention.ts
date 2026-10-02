import type { Lane } from "@hexagen-monaco/waves-contract";

export type AttentionReason =
  "failed" | "disagreement" | "checks" | "gate" | "exit" | "silent";

/** The order a lane's reasons are always answered in, whatever holds. */
export const ATTENTION_REASONS: readonly AttentionReason[] = [
  "failed",
  "disagreement",
  "checks",
  "gate",
  "exit",
  "silent",
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
function isFailureExit(exit: number | undefined): boolean {
  return exit !== undefined && exit !== 0;
}

/**
 * Why one stored lane wants a reader's attention, in `ATTENTION_REASONS` order.
 * `waveStale` is the staleness of the wave the lane is in, and it is what turns
 * a lane nobody has heard from since into `silent`.
 *
 * A lane whose pull request is merged or closed is done: it answers no reasons
 * however the rest of it looks, because the open questions it raised have been
 * answered and its stale data cannot contradict them.
 */
export function attentionReasons(
  lane: Lane,
  waveStale: boolean,
): readonly AttentionReason[] {
  const state = lane.derived.pr?.state;
  if (state === "merged" || state === "closed") {
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
  return reasons;
}

/** Whether a wave received at `receivedAtMs` is still inside the window at `nowMs`. */
export function inAttentionWindow(
  receivedAtMs: number,
  nowMs: number,
): boolean {
  return nowMs - receivedAtMs <= ATTENTION_WINDOW_MS;
}
