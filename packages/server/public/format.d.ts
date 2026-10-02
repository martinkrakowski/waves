import type {
  Gate,
  LaneDerived,
  LaneReported,
  PullRequest,
} from "@hexagen-monaco/waves-contract";

import type { LaneDerivedView } from "../src/application/read-model.js";

export interface AliveView {
  readonly label: string;
  readonly className: string;
}

export declare function relativeTime(
  iso: string | undefined,
  nowMs: number,
): string;

/** The three liveness views the read model sends: running, stopped, unknown. */
export declare function aliveView(alive: LaneDerivedView["alive"]): AliveView;

export declare function gateText(gate: Gate | undefined): string;

export declare function diffText(diff: LaneDerived["diff"]): string;

export declare function threadsText(
  threads: PullRequest["unresolvedThreads"],
): string;

export declare function pullRequestText(pr: PullRequest | undefined): string;

export declare function reportedText(
  reported: LaneReported | undefined,
): string;

export declare function detailValue(value: unknown): string | undefined;

export declare function laneCountText(lanes: number): string;

export declare function waveCountText(waves: number): string;
