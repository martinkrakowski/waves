import type {
  LaneEvent,
  PullRequestState,
} from "@hexagen-monaco/waves-contract";

import { isFailureExit, prSettled } from "./attention.js";

/**
 * What one wave's lanes say about the wave, in the order they are decided in.
 * `failed` is a lane that asked for a reader and is not being asked any more;
 * `done` is a wave whose pull requests have all been answered; `running` is a
 * lane still being worked on in a wave that has not gone past its own interval;
 * `settled` is everything else, which is most of it.
 */
export type WaveState = "failed" | "done" | "running" | "settled";

/**
 * The four things about a lane the state reads, and nothing else: the raw
 * `alive` the last push derived, before any staleness resolves it to
 * `"unknown"`; the exit it left behind; the event it reported; and the state of
 * its pull request. `alive` is a boolean here on purpose — "unknown" is a
 * rendering for a reader, and a wave's state is about what the lanes said.
 */
export interface WaveStateLane {
  readonly alive: boolean;
  readonly exit?: number;
  readonly event?: LaneEvent;
  readonly prState?: PullRequestState;
}

/**
 * The state of one wave from its lanes, in this order and no other:
 *
 * 1. `failed` — a lane whose pull request is neither merged nor closed is not
 *    alive and either reported `failed` or exited non-zero. `alive` is required
 *    for the reported failure as well as for the exit, which is a deliberate
 *    difference from `attentionReasons`: a lane that is still alive has not
 *    finished failing, and a card that called it failed would say the work is
 *    over while the process is still running.
 * 2. `done` — at least one lane, and every lane's pull request merged or
 *    closed. Zero lanes is not `done`: nothing was asked for, so nothing was
 *    answered.
 * 3. `running` — the wave is not stale and a lane is alive. A wave past its own
 *    interval says nothing about what is happening now, so an alive lane in one
 *    is `settled`: the pusher has stopped telling the server.
 * 4. `settled` — everything else, including a wave with no lanes at all.
 *
 * It summarises what the lanes said, not what the work is: a wave with one lane
 * left open and nothing alive is `settled`, and so is a wave whose lane is alive
 * but whose pushes have stopped.
 */
export function waveState(
  lanes: readonly WaveStateLane[],
  stale: boolean,
): WaveState {
  for (const lane of lanes) {
    if (
      !prSettled(lane.prState) &&
      !lane.alive &&
      (lane.event === "failed" || isFailureExit(lane.exit))
    ) {
      return "failed";
    }
  }
  if (lanes.length > 0 && lanes.every((lane) => prSettled(lane.prState))) {
    return "done";
  }
  if (!stale && lanes.some((lane) => lane.alive)) {
    return "running";
  }
  return "settled";
}
