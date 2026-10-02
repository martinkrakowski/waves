import type { LaneRow } from "../src/application/read-model.js";

export interface DigestInput {
  /** The route's project id. */
  readonly project: string;
  /** The route's wave id, when the route names one. */
  readonly wave?: string;
  /** The rows the table shows, in the table's order. */
  readonly shown: readonly LaneRow[];
  /** How many rows the scope holds before the filter. */
  readonly inScope: number;
  /** The ids of the stale waves in scope. */
  readonly staleWaves: readonly string[];
  /** The view's own address, as the browser holds it. */
  readonly url: string;
}

/**
 * A pusher's string made safe to sit on one line: every character that could
 * break a line is one space, runs of spaces become one, the ends are trimmed,
 * and anything past 200 characters is cut with an ellipsis saying so.
 */
export declare function quoted(value: string): string;

/** The digest as one string of lines, each ending in a newline. */
export declare function digestOf(input: DigestInput): string;
