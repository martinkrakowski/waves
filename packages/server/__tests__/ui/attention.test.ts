import { describe, expect, it } from "vitest";

import { REASONS, drawableAttention } from "../../public/attention.js";

import { attentionLane, attentionView } from "./fixtures.js";

/**
 * One invalid view per rule, and the rule it breaks. The bad entries are built
 * by spreading a good lane into an `unknown`, so a typo in a field name is a
 * type error here rather than a test that quietly never fails.
 */
const INVALID: readonly (readonly [string, unknown])[] = [
  ["null", null],
  ["a string", "lanes"],
  ["no truncated", { lanes: [], projects: [] }],
  [
    "a truncated that is not a boolean",
    { ...attentionView(), truncated: "no" },
  ],
  ["no lanes", { projects: [], truncated: false }],
  ["lanes that are not a list", { ...attentionView(), lanes: {} }],
  ["no projects", { lanes: [], truncated: false }],
  ["projects that are not a list", { ...attentionView(), projects: "one" }],
  ["a project count that is null", { ...attentionView(), projects: [null] }],
  [
    "a project with no id",
    { ...attentionView(), projects: [{ attention: 1 }] },
  ],
  [
    "a project with no count",
    { ...attentionView(), projects: [{ id: "alpha" }] },
  ],
  [
    "a project whose count is not a number",
    { ...attentionView(), projects: [{ id: "alpha", attention: "1" }] },
  ],
  ["a lane that is null", { ...attentionView(), lanes: [null] }],
  [
    "a lane with a project id the app does not own",
    { ...attentionView(), lanes: [{ ...attentionLane(), project: "A b" }] },
  ],
  [
    "a lane with a wave id the app does not own",
    { ...attentionView(), lanes: [{ ...attentionLane(), wave: "w 3" }] },
  ],
  [
    "a lane with a lane id the app does not own",
    {
      ...attentionView(),
      lanes: [{ ...attentionLane(), lane: "../elsewhere" }],
    },
  ],
  [
    "a lane with no reasons",
    { ...attentionView(), lanes: [{ ...attentionLane(), reasons: [] }] },
  ],
  [
    "a lane whose reasons are not a list",
    { ...attentionView(), lanes: [{ ...attentionLane(), reasons: "failed" }] },
  ],
  [
    "a lane with a reason outside the six",
    {
      ...attentionView(),
      lanes: [{ ...attentionLane(), reasons: ["failed", "yelled"] }],
    },
  ],
  [
    "a lane with no receivedAt",
    {
      ...attentionView(),
      lanes: [{ ...attentionLane(), receivedAt: undefined }],
    },
  ],
  [
    "a lane whose staleness is not a boolean",
    { ...attentionView(), lanes: [{ ...attentionLane(), stale: "yes" }] },
  ],
  [
    "a lane whose seat is not a string",
    { ...attentionView(), lanes: [{ ...attentionLane(), seat: 3 }] },
  ],
  [
    "a pull request numbered zero",
    { ...attentionView(), lanes: [{ ...attentionLane(), pr: 0 }] },
  ],
  [
    "a pull request numbered in part",
    { ...attentionView(), lanes: [{ ...attentionLane(), pr: 1.5 }] },
  ],
  [
    "a pull request numbered as a string",
    { ...attentionView(), lanes: [{ ...attentionLane(), pr: "42" }] },
  ],
];

describe("drawableAttention", () => {
  it("takes the view the attention route answers", () => {
    expect(
      drawableAttention(
        attentionView({
          lanes: [attentionLane()],
          projects: [{ id: "alpha", attention: 1 }],
          truncated: true,
        }),
      ),
    ).toBe(true);
  });

  it("takes an empty view, and a lane carrying everything it may carry", () => {
    expect(drawableAttention(attentionView())).toBe(true);
    expect(
      drawableAttention(
        attentionView({
          lanes: [
            attentionLane({
              reasons: [
                "failed",
                "disagreement",
                "checks",
                "gate",
                "exit",
                "silent",
              ],
              seat: "s1",
              stale: true,
              pr: 42,
            }),
          ],
        }),
      ),
    ).toBe(true);
  });

  it.each(REASONS)("takes %s as a reason", (reason) => {
    expect(
      drawableAttention(
        attentionView({ lanes: [attentionLane({ reasons: [reason] })] }),
      ),
    ).toBe(true);
  });

  it.each(INVALID)("refuses %s", (_rule, view) => {
    expect(drawableAttention(view)).toBe(false);
  });

  it("refuses a number, a boolean and nothing at all", () => {
    expect(drawableAttention(undefined)).toBe(false);
    expect(drawableAttention(7)).toBe(false);
    expect(drawableAttention(true)).toBe(false);
  });
});
