import { describe, expect, it } from "vitest";

import type { LaneRow } from "../../src/application/read-model.js";
import { drawableProjectLanes } from "../../public/project-lanes.js";

import {
  NOW_ISO,
  NOW_MS,
  laneRow,
  projectLanes,
  waveSummary,
} from "./fixtures.js";

/** A row carrying everything a row is allowed to carry, and nothing missing. */
const FULL_ROW: LaneRow = laneRow({
  wave: "w-3",
  id: "wv-a",
  seat: "s1",
  reported: {
    stage: "review",
    event: "settled",
    ts: NOW_ISO,
    pr: 42,
    round: 2,
  },
  derived: {
    alive: false,
    exit: 1,
    gate: {
      exit: 1,
      coverage: { statements: 98, branches: 91.5, functions: 100, lines: 99 },
    },
    pr: { number: 42, state: "merged", checks: "fail", unresolvedThreads: 3 },
    diff: { files: 3, insertions: 120, deletions: 14 },
    planReview: "two approvals",
    risk: "low",
    log: { bytes: 4096, mtimeMs: NOW_MS, tail: true },
  },
  disagreements: 2,
  disagreement: "seat 1 says pass, the gate says fail",
  reasons: ["failed", "disagreement", "checks", "gate", "exit", "silent"],
});

/** The same view, with one row that is not `FULL_ROW` in exactly one way. */
function withRow(row: unknown): unknown {
  return { ...projectLanes(), lanes: [row] };
}

/**
 * One invalid view per rule, and the rule it breaks. The bad values are built by
 * spreading a good one into an `unknown`, so a typo in a field name is a test
 * that quietly never fails rather than a type error — which is why every one of
 * them below is read by the rule it names.
 */
const INVALID: readonly (readonly [string, unknown])[] = [
  ["null", null],
  ["a string", "lanes"],
  ["a boolean", true],
  ["nothing at all", undefined],
  ["no truncated", { ...projectLanes(), truncated: undefined }],
  ["a truncated that is not a boolean", { ...projectLanes(), truncated: "no" }],
  ["no project", { ...projectLanes(), project: undefined }],
  ["a project that is null", { ...projectLanes(), project: null }],
  [
    "a project id the page owns no path for",
    { ...projectLanes(), project: { id: "A b", name: "Alpha" } },
  ],
  ["a project with no name", { ...projectLanes(), project: { id: "alpha" } }],
  [
    "a project whose name is not a string",
    { ...projectLanes(), project: { id: "alpha", name: 7 } },
  ],
  [
    "a project whose repo is not a string",
    { ...projectLanes(), project: { id: "alpha", name: "Alpha", repo: 7 } },
  ],
  ["no waves", { ...projectLanes(), waves: undefined }],
  ["waves that are not a list", { ...projectLanes(), waves: {} }],
  [
    "a wave with no receivedAt",
    { ...projectLanes(), waves: [waveSummary({ receivedAt: undefined })] },
  ],
  [
    "a wave whose id the page owns no path for",
    { ...projectLanes(), waves: [waveSummary({ wave: "w 3" })] },
  ],
  ["no lanes", { ...projectLanes(), lanes: undefined }],
  ["lanes that are not a list", { ...projectLanes(), lanes: {} }],
  ["a lane that is null", { ...projectLanes(), lanes: [null] }],
  [
    "a lane with a wave id the page owns no path for",
    withRow({ ...FULL_ROW, wave: "w 3" }),
  ],
  [
    "a lane with an id the page owns no path for",
    withRow({ ...FULL_ROW, id: "../elsewhere" }),
  ],
  ["a lane whose seat is not a string", withRow({ ...FULL_ROW, seat: 3 })],
  ["a reported that is null", withRow({ ...FULL_ROW, reported: null })],
  [
    "a reported with no stage",
    withRow({ ...FULL_ROW, reported: { event: "settled", ts: NOW_ISO } }),
  ],
  [
    "a reported whose event is not a string",
    withRow({
      ...FULL_ROW,
      reported: { stage: "review", event: 7, ts: NOW_ISO },
    }),
  ],
  [
    "an event outside the three",
    withRow({
      ...FULL_ROW,
      reported: { stage: "review", event: "yelled", ts: NOW_ISO },
    }),
  ],
  [
    "a reported with no ts",
    withRow({ ...FULL_ROW, reported: { stage: "review", event: "failed" } }),
  ],
  [
    "a reported pull request numbered zero",
    withRow({
      ...FULL_ROW,
      reported: { stage: "review", event: "failed", ts: NOW_ISO, pr: 0 },
    }),
  ],
  [
    "a reported pull request numbered in part",
    withRow({
      ...FULL_ROW,
      reported: { stage: "review", event: "failed", ts: NOW_ISO, pr: 1.5 },
    }),
  ],
  [
    "a reported round before the first",
    withRow({
      ...FULL_ROW,
      reported: { stage: "review", event: "failed", ts: NOW_ISO, round: -1 },
    }),
  ],
  ["a lane with no derived", withRow({ ...FULL_ROW, derived: undefined })],
  ["a derived that is null", withRow({ ...FULL_ROW, derived: null })],
  [
    "an alive that is neither a boolean nor unknown",
    withRow({ ...FULL_ROW, derived: { alive: "maybe" } }),
  ],
  [
    "an exit that is not a number",
    withRow({ ...FULL_ROW, derived: { alive: true, exit: "1" } }),
  ],
  [
    "a gate that is null",
    withRow({ ...FULL_ROW, derived: { alive: true, gate: null } }),
  ],
  [
    "a gate whose exit is not a number",
    withRow({ ...FULL_ROW, derived: { alive: true, gate: { exit: "0" } } }),
  ],
  [
    "a gate whose coverage is null",
    withRow({
      ...FULL_ROW,
      derived: { alive: true, gate: { coverage: null } },
    }),
  ],
  [
    "coverage with no statements",
    withRow({
      ...FULL_ROW,
      derived: {
        alive: true,
        gate: { coverage: { branches: 1, functions: 1, lines: 1 } },
      },
    }),
  ],
  [
    "coverage whose lines are not a number",
    withRow({
      ...FULL_ROW,
      derived: {
        alive: true,
        gate: {
          coverage: {
            statements: 1,
            branches: 1,
            functions: 1,
            lines: "99",
          },
        },
      },
    }),
  ],
  [
    "a derived pull request that is null",
    withRow({ ...FULL_ROW, derived: { alive: true, pr: null } }),
  ],
  [
    "a pull request numbered zero",
    withRow({
      ...FULL_ROW,
      derived: {
        alive: true,
        pr: { number: 0, state: "open", checks: "pass" },
      },
    }),
  ],
  [
    "a pull request whose state is not a string",
    withRow({
      ...FULL_ROW,
      derived: { alive: true, pr: { number: 2, state: 3, checks: "pass" } },
    }),
  ],
  [
    "a pull request state outside the three",
    withRow({
      ...FULL_ROW,
      derived: {
        alive: true,
        pr: { number: 2, state: "yelled", checks: "pass" },
      },
    }),
  ],
  [
    "a pull request whose checks are outside the five",
    withRow({
      ...FULL_ROW,
      derived: {
        alive: true,
        pr: { number: 2, state: "open", checks: "yelled" },
      },
    }),
  ],
  [
    "an unresolved thread count that is neither a number nor unknown",
    withRow({
      ...FULL_ROW,
      derived: {
        alive: true,
        pr: {
          number: 2,
          state: "open",
          checks: "pass",
          unresolvedThreads: "many",
        },
      },
    }),
  ],
  [
    "a diff that is null",
    withRow({ ...FULL_ROW, derived: { alive: true, diff: null } }),
  ],
  [
    "a diff with no deletions",
    withRow({
      ...FULL_ROW,
      derived: { alive: true, diff: { files: 1, insertions: 1 } },
    }),
  ],
  [
    "a diff whose insertions are not a number",
    withRow({
      ...FULL_ROW,
      derived: {
        alive: true,
        diff: { files: 1, insertions: "1", deletions: 1 },
      },
    }),
  ],
  [
    "a plan review that is not a string",
    withRow({ ...FULL_ROW, derived: { alive: true, planReview: 7 } }),
  ],
  [
    "a risk that is not a string",
    withRow({ ...FULL_ROW, derived: { alive: true, risk: {} } }),
  ],
  [
    "a log that is null",
    withRow({ ...FULL_ROW, derived: { alive: true, log: null } }),
  ],
  [
    "a log with no tail flag",
    withRow({
      ...FULL_ROW,
      derived: { alive: true, log: { bytes: 1, mtimeMs: NOW_MS } },
    }),
  ],
  [
    "a log holding the text of the tail rather than a flag",
    withRow({
      ...FULL_ROW,
      derived: { alive: true, log: { bytes: 1, mtimeMs: NOW_MS, tail: "ok" } },
    }),
  ],
  [
    "a disagreements count that is not a number",
    withRow({ ...FULL_ROW, disagreements: "1" }),
  ],
  [
    "a disagreement that is not a string",
    withRow({ ...FULL_ROW, disagreement: 7 }),
  ],
  ["a lane with no reasons", withRow({ ...FULL_ROW, reasons: undefined })],
  ["reasons that are not a list", withRow({ ...FULL_ROW, reasons: "failed" })],
  [
    "a reason outside the six",
    withRow({ ...FULL_ROW, reasons: ["failed", "yelled"] }),
  ],
];

describe("drawableProjectLanes", () => {
  it("takes the view the lanes route answers", () => {
    expect(
      drawableProjectLanes(
        projectLanes({
          project: {
            id: "alpha",
            name: "Alpha",
            repo: "https://git.example.test/alpha",
          },
          waves: [
            waveSummary(),
            waveSummary({ wave: "w-2", receivedAt: NOW_ISO, retained: false }),
            waveSummary({ wave: "w-1", receivedAt: NOW_ISO, stale: true }),
          ],
          lanes: [FULL_ROW, laneRow({ id: "wv-b", seat: undefined })],
          truncated: true,
        }),
      ),
    ).toBe(true);
  });

  it("takes the smallest view the read model allows", () => {
    expect(
      drawableProjectLanes(
        projectLanes({
          project: { id: "alpha", name: "Alpha" },
          waves: [waveSummary({ intervalSeconds: null })],
          lanes: [laneRow()],
        }),
      ),
    ).toBe(true);
  });

  it("takes a project with no waves and no lanes at all", () => {
    expect(drawableProjectLanes(projectLanes({ waves: [], lanes: [] }))).toBe(
      true,
    );
  });

  it("takes a lane whose liveness the last push could not read", () => {
    expect(
      drawableProjectLanes(
        projectLanes({
          lanes: [
            laneRow({
              derived: {
                alive: "unknown",
                gate: {},
                pr: { number: 7, state: "closed", checks: "unknown" },
              },
            }),
          ],
        }),
      ),
    ).toBe(true);
  });

  it("takes an unresolved thread count of unknown", () => {
    expect(
      drawableProjectLanes(
        projectLanes({
          lanes: [
            laneRow({
              derived: {
                alive: true,
                pr: {
                  number: 7,
                  state: "open",
                  checks: "pending",
                  unresolvedThreads: "unknown",
                },
              },
            }),
          ],
        }),
      ),
    ).toBe(true);
  });

  it("takes a gate with an exit and no coverage, and a coverage of its own", () => {
    expect(
      drawableProjectLanes(
        projectLanes({
          lanes: [
            laneRow({ derived: { alive: true, gate: { exit: 0 } } }),
            laneRow({
              id: "wv-b",
              derived: {
                alive: true,
                gate: {
                  coverage: {
                    statements: 1,
                    branches: 1,
                    functions: 1,
                    lines: 1,
                  },
                },
              },
            }),
          ],
        }),
      ),
    ).toBe(true);
  });

  it("takes every event and every lane carrying the least of it", () => {
    for (const event of ["started", "settled", "failed"] as const) {
      expect(
        drawableProjectLanes(
          projectLanes({
            lanes: [
              laneRow({
                reported: { stage: "build", event, ts: NOW_ISO },
              }),
            ],
          }),
        ),
      ).toBe(true);
    }
  });

  it.each(INVALID)("refuses %s", (_rule, view) => {
    expect(drawableProjectLanes(view)).toBe(false);
  });

  it("refuses a number", () => {
    expect(drawableProjectLanes(7)).toBe(false);
  });
});
