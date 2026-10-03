import { describe, expect, it } from "vitest";

import { drawableStatus, drawableStatusFacts } from "../../public/status.js";

import { NOW_ISO, statusFacts, statusView } from "./fixtures.js";

/**
 * Every rule the panel draws from. Each case takes the whole document and takes
 * one thing away from it, so a rule that stopped holding would show up as one
 * answer the other rules do not explain.
 */
function withoutStatus(change: (status: Record<string, unknown>) => void) {
  const view = statusView();
  change(view.status as unknown as Record<string, unknown>);
  return view;
}

describe("drawableStatus", () => {
  it("takes the answer the status route gives, and a bare one", () => {
    expect(drawableStatus(statusView())).toBe(true);
    expect(
      drawableStatus({
        status: {
          schema: "waves-status/v1",
          project: "alpha",
          generatedAt: NOW_ISO,
          intervalSeconds: null,
        },
        receivedAt: NOW_ISO,
        stale: false,
        staleAfterMs: 300_000,
      }),
    ).toBe(true);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a number", 7],
    ["a string", "status"],
    ["an array", []],
  ])("refuses %s", (_label, view) => {
    expect(drawableStatus(view)).toBe(false);
  });

  it("refuses a view missing one of its own four fields", () => {
    for (const field of ["receivedAt", "stale", "staleAfterMs", "status"]) {
      const view = { ...statusView(), [field]: undefined };
      expect(drawableStatus(view)).toBe(false);
    }
    expect(drawableStatus({ ...statusView(), staleAfterMs: "90000" })).toBe(
      false,
    );
    expect(drawableStatus({ ...statusView(), stale: 1 })).toBe(false);
  });

  it("refuses a document that is not an object, or is missing a field of its own", () => {
    expect(drawableStatus({ ...statusView(), status: null })).toBe(false);
    for (const field of ["project", "generatedAt", "intervalSeconds"]) {
      expect(
        drawableStatus(withoutStatus((status) => (status[field] = undefined))),
      ).toBe(false);
    }
  });

  it("refuses an interval that is neither null nor a count of seconds", () => {
    expect(
      drawableStatus(withoutStatus((status) => (status.intervalSeconds = 0))),
    ).toBe(false);
    expect(
      drawableStatus(withoutStatus((status) => (status.intervalSeconds = 1.5))),
    ).toBe(false);
    expect(
      drawableStatus(
        withoutStatus((status) => (status.intervalSeconds = "30")),
      ),
    ).toBe(false);
    expect(
      drawableStatus(
        withoutStatus((status) => (status.intervalSeconds = null)),
      ),
    ).toBe(true);
  });

  it("refuses a prs half the panel could not count", () => {
    for (const prs of [
      null,
      {},
      { skipped: -1 },
      { skipped: 1.5 },
      { skipped: "2" },
      { skipped: 1, extra: 1 },
    ]) {
      expect(
        drawableStatus(withoutStatus((status) => (status.prs = prs))),
      ).toBe(false);
    }
    expect(
      drawableStatus(withoutStatus((status) => (status.prs = { skipped: 0 }))),
    ).toBe(true);
  });

  it("refuses a backlog whose state is not one of the three", () => {
    for (const state of ["", "Recorded", "invented"]) {
      expect(
        drawableStatus(withoutStatus((status) => (status.backlog = { state }))),
      ).toBe(false);
    }
    for (const state of ["recorded", "absent", "unknown"]) {
      expect(
        drawableStatus(withoutStatus((status) => (status.backlog = { state }))),
      ).toBe(true);
    }
  });

  it("refuses a backlog whose optional halves the panel reads are malformed", () => {
    const cases: readonly (readonly [string, unknown])[] = [
      ["at is not a string", { state: "recorded", at: 7 }],
      ["scope is not an object", { state: "recorded", scope: "full" }],
      [
        "scope carries no plans",
        { state: "recorded", scope: { kind: "full" } },
      ],
      [
        "scope carries plans that are not strings",
        { state: "recorded", scope: { kind: "full", plans: [7] } },
      ],
      [
        "scope kind is not one of the two",
        { state: "recorded", scope: { kind: "half", plans: [] } },
      ],
      ["git carries no head", { state: "recorded", git: { branch: "main" } }],
      [
        "git head is not a string",
        { state: "recorded", git: { branch: "main", head: 7 } },
      ],
      ["premises is not an array", { state: "recorded", premises: {} }],
      [
        "premises holds a premise with no lane",
        { state: "recorded", premises: [{ plan: "p", status: "holds" }] },
      ],
      [
        "premises holds a premise with no plan",
        { state: "recorded", premises: [{ lane: "C1", status: "holds" }] },
      ],
      [
        "premises holds a premise whose status is not one of the four",
        {
          state: "recorded",
          premises: [{ lane: "C1", plan: "p", status: "invented" }],
        },
      ],
      [
        "premises holds a premise whose reason is not a string",
        {
          state: "recorded",
          premises: [{ lane: "C1", plan: "p", status: "holds", reason: 7 }],
        },
      ],
      [
        "premises holds something that is not a premise",
        { state: "recorded", premises: [null] },
      ],
    ];
    for (const [label, backlog] of cases) {
      expect(
        drawableStatus(withoutStatus((status) => (status.backlog = backlog))),
        label,
      ).toBe(false);
    }
    expect(
      drawableStatus(
        withoutStatus((status) => {
          status.backlog = {
            state: "recorded",
            at: NOW_ISO,
            scope: { kind: "partial", plans: ["plan:verify"] },
            git: { branch: "main", head: "0a1b2c3" },
            premises: [
              { lane: "C1", plan: "p", status: "error", reason: "no" },
            ],
          };
        }),
      ),
    ).toBe(true);
  });
});

describe("drawableStatusFacts", () => {
  it("takes the two facts a card shows, and neither optional one", () => {
    expect(drawableStatusFacts(statusFacts())).toBe(true);
    expect(drawableStatusFacts({ receivedAt: NOW_ISO, stale: false })).toBe(
      true,
    );
  });

  it("refuses a fact of the wrong type", () => {
    expect(drawableStatusFacts(null)).toBe(false);
    expect(drawableStatusFacts(undefined)).toBe(false);
    expect(drawableStatusFacts("recorded")).toBe(false);
    expect(drawableStatusFacts({ ...statusFacts(), receivedAt: 7 })).toBe(
      false,
    );
    expect(drawableStatusFacts({ ...statusFacts(), stale: "no" })).toBe(false);
    expect(drawableStatusFacts({ ...statusFacts(), prsSkipped: -1 })).toBe(
      false,
    );
    expect(drawableStatusFacts({ ...statusFacts(), prsSkipped: 1.5 })).toBe(
      false,
    );
    expect(
      drawableStatusFacts({ ...statusFacts(), backlogState: "invented" }),
    ).toBe(false);
    expect(
      drawableStatusFacts({ ...statusFacts(), backlogState: "absent" }),
    ).toBe(true);
  });
});
