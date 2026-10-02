import { describe, expect, it } from "vitest";

import type { Lane } from "@hexagen-monaco/waves-contract";

import {
  ATTENTION_REASONS,
  ATTENTION_WINDOW_MS,
  attentionReasons,
  inAttentionWindow,
  MAX_ATTENTION_LANES,
} from "../src/domain/attention.js";

const PUSHED_AT = "2026-10-01T12:00:00Z";
const NOW_MS = Date.parse("2026-10-04T12:00:00Z");

function lane(overrides: Partial<Lane> = {}): Lane {
  return {
    id: "wv1-a",
    derived: { alive: true },
    disagreements: [],
    ...overrides,
  };
}

function reported(event: "started" | "settled" | "failed"): Lane["reported"] {
  return { stage: "implement", event, ts: PUSHED_AT };
}

describe("the attention reasons", () => {
  it("names the six reasons in one order and the two numbers around them", () => {
    expect(ATTENTION_REASONS).toEqual([
      "failed",
      "disagreement",
      "checks",
      "gate",
      "exit",
      "silent",
    ]);
    expect(ATTENTION_WINDOW_MS).toBe(72 * 60 * 60 * 1000);
    expect(MAX_ATTENTION_LANES).toBe(200);
  });

  it("has no reason to give for a lane that is alive and has said nothing", () => {
    expect(attentionReasons(lane(), false)).toEqual([]);
  });

  it("cites a lane that reported a failure", () => {
    expect(
      attentionReasons(lane({ reported: reported("failed") }), false),
    ).toEqual(["failed"]);
  });

  it("leaves a lane that reported progress or a settlement out", () => {
    for (const event of ["started", "settled"] as const) {
      expect(
        attentionReasons(lane({ reported: reported(event) }), false),
      ).toEqual([]);
    }
  });

  it("cites a lane the seats disagree about", () => {
    expect(
      attentionReasons(lane({ disagreements: ["seat 1 says pass"] }), false),
    ).toEqual(["disagreement"]);
  });

  it("leaves a lane nobody disagrees about out", () => {
    expect(attentionReasons(lane({ disagreements: [] }), false)).toEqual([]);
  });

  it("cites a lane whose checks fail", () => {
    expect(
      attentionReasons(
        lane({
          derived: {
            alive: true,
            pr: { number: 7, state: "open", checks: "fail" },
          },
        }),
        false,
      ),
    ).toEqual(["checks"]);
  });

  it("leaves a lane whose checks have not failed out", () => {
    const quiet = (checks: Lane["derived"]["pr"]): Lane =>
      lane({ derived: { alive: true, pr: checks } });
    for (const checks of [
      undefined,
      { number: 7, state: "open", checks: "pass" } as const,
      { number: 7, state: "open", checks: "pending" } as const,
      { number: 7, state: "open", checks: "unknown" } as const,
      { number: 7, state: "open", checks: "none" } as const,
    ]) {
      expect(attentionReasons(quiet(checks), false)).toEqual([]);
    }
  });

  it("cites a lane whose gate exited with a failure", () => {
    expect(
      attentionReasons(
        lane({ derived: { alive: true, gate: { exit: 1 } } }),
        false,
      ),
    ).toEqual(["gate"]);
  });

  it("leaves a lane whose gate was clean, unrun or absent out", () => {
    expect(
      attentionReasons(
        lane({ derived: { alive: true, gate: { exit: 0 } } }),
        false,
      ),
    ).toEqual([]);
    expect(
      attentionReasons(lane({ derived: { alive: true, gate: {} } }), false),
    ).toEqual([]);
    expect(attentionReasons(lane(), false)).toEqual([]);
  });

  it("cites a lane that is gone and left a failing exit", () => {
    expect(
      attentionReasons(lane({ derived: { alive: false, exit: 2 } }), false),
    ).toEqual(["exit"]);
  });

  it("leaves a lane out whose exit is another lane's, or a clean one, or absent", () => {
    expect(
      attentionReasons(lane({ derived: { alive: true, exit: 1 } }), false),
    ).toEqual([]);
    expect(
      attentionReasons(lane({ derived: { alive: false, exit: 0 } }), false),
    ).toEqual([]);
    expect(
      attentionReasons(lane({ derived: { alive: false } }), false),
    ).toEqual([]);
  });

  it("cites an alive lane of a stale wave that has never reported an exit", () => {
    expect(attentionReasons(lane(), true)).toEqual(["silent"]);
  });

  it("drops the silence for a wave still inside its own interval", () => {
    expect(attentionReasons(lane(), false)).toEqual([]);
  });

  it("drops the silence for a lane that is not alive", () => {
    expect(attentionReasons(lane({ derived: { alive: false } }), true)).toEqual(
      [],
    );
  });

  it("drops the silence for a lane that has already reported an exit", () => {
    expect(
      attentionReasons(lane({ derived: { alive: true, exit: 0 } }), true),
    ).toEqual([]);
  });

  it("answers several reasons in the fixed order", () => {
    const reasons = attentionReasons(
      lane({
        reported: reported("failed"),
        disagreements: ["scope"],
        derived: {
          alive: false,
          exit: 1,
          gate: { exit: 1 },
          pr: { number: 7, state: "open", checks: "fail" },
        },
      }),
      true,
    );

    expect(reasons).toEqual([
      "failed",
      "disagreement",
      "checks",
      "gate",
      "exit",
    ]);
    expect(reasons).toEqual(ATTENTION_REASONS.filter((r) => r !== "silent"));
  });

  it("answers the silence last, after the lane's own faults", () => {
    const reasons = attentionReasons(
      lane({
        disagreements: ["scope"],
        derived: { alive: true, gate: { exit: 1 } },
      }),
      true,
    );

    expect(reasons).toEqual(["disagreement", "gate", "silent"]);
    expect(reasons[reasons.length - 1]).toBe("silent");
  });

  it("cites nothing for a lane whose pull request is merged", () => {
    expect(
      attentionReasons(
        lane({
          derived: { alive: false, exit: 1, pr: mergedOrClosed("merged") },
        }),
        true,
      ),
    ).toEqual([]);
  });

  it("cites nothing for a lane whose pull request is closed", () => {
    expect(
      attentionReasons(
        lane({
          derived: { alive: false, exit: 1, pr: mergedOrClosed("closed") },
        }),
        true,
      ),
    ).toEqual([]);
  });

  it("cites every reason for a lane whose pull request is still open", () => {
    expect(
      attentionReasons(
        lane({
          reported: reported("failed"),
          disagreements: ["scope"],
          derived: {
            alive: false,
            exit: 1,
            gate: { exit: 1 },
            pr: { number: 7, state: "open", checks: "fail" },
          },
        }),
        true,
      ),
    ).toEqual(["failed", "disagreement", "checks", "gate", "exit"]);
  });
});

function mergedOrClosed(state: "merged" | "closed"): {
  number: number;
  state: "merged" | "closed";
  checks: "none";
} {
  return { number: 7, state, checks: "none" };
}

describe("the attention window", () => {
  it("keeps a wave received exactly 72 hours ago", () => {
    expect(inAttentionWindow(NOW_MS - ATTENTION_WINDOW_MS, NOW_MS)).toBe(true);
  });

  it("drops a wave one millisecond older than that", () => {
    expect(inAttentionWindow(NOW_MS - ATTENTION_WINDOW_MS - 1, NOW_MS)).toBe(
      false,
    );
  });

  it("keeps a wave received a moment ago", () => {
    expect(inAttentionWindow(NOW_MS - 1_000, NOW_MS)).toBe(true);
  });
});
