import type { AttentionView } from "../src/application/read-model.js";

/** The six reasons a lane is asked about, as the server derives them. */
export declare const REASONS: readonly [
  "failed",
  "disagreement",
  "checks",
  "gate",
  "exit",
  "silent",
];

export declare function drawableAttention(view: unknown): view is AttentionView;
