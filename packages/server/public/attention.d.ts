import type { AttentionView } from "../src/application/read-model.js";

/** The seven reasons a lane is asked about, as the server derives them. */
export declare const REASONS: readonly [
  "failed",
  "disagreement",
  "checks",
  "gate",
  "exit",
  "silent",
  "no-pr",
];

/** A reason's label, which is its own value save for `no-pr` ("no PR"). */
export declare function reasonLabel(reason: string): string;

export declare function drawableAttention(view: unknown): view is AttentionView;
