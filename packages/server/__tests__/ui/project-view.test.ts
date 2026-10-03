import { describe, expect, it, vi } from "vitest";

import {
  countersOf,
  filterRows,
  hrefFor,
  matches,
  pathFor,
  reasonCounts,
  scopeOf,
  searchText,
  seatsOf,
  sortRows,
  staleWavesOf,
  stagesOf,
} from "../../public/views/project.js";

import type { LaneRow, WaveSummary } from "../../src/application/read-model.js";
import type { ViewQuery } from "../../public/query.js";
import {
  laneRow,
  NOW_ISO,
  NOW_MS,
  projectLanes,
  waveSummary,
} from "./fixtures.js";
import { oneOf, renderProjectView, textOf, textsOf } from "./helpers.js";

/** The text of every cell of one lane row, in column order. */
function cells(host: HTMLElement, row: number): string[] {
  const body = host.querySelectorAll("tbody tr");
  return textsOf(body[row] as HTMLElement, "td");
}

/** Every label on the cells of one row, in column order. */
function labels(host: HTMLElement, row: number): (string | null)[] {
  const body = host.querySelectorAll("tbody tr");
  return Array.from((body[row] as HTMLElement).querySelectorAll("td"), (cell) =>
    cell.getAttribute("data-label"),
  );
}

const NO_REPO = projectLanes({ project: { id: "alpha", name: "Alpha" } });

describe("the project heading", () => {
  it("names the project on its own page", () => {
    const host = renderProjectView({ lanes: NO_REPO });
    expect(textsOf(host, "h1")).toStrictEqual(["Alpha"]);
    expect(host.querySelector("h1 code")).toBeNull();
    expect(textsOf(host, ".lede")).toStrictEqual([
      "Every lane of this project's waves. Choose a wave to narrow.",
    ]);
  });

  it("names the wave on a wave's page, and the project in the lede", () => {
    const host = renderProjectView({ lanes: NO_REPO, wave: "w-3" });
    expect(textsOf(host, "h1 code")).toStrictEqual(["w-3"]);
    expect(textsOf(host, ".lede")).toStrictEqual([
      "One wave of Alpha: what each lane reported, beside what the last push could derive.",
    ]);
  });

  it("links the repository when the project registered one", () => {
    const host = renderProjectView({
      lanes: projectLanes({
        project: {
          id: "alpha",
          name: "Alpha",
          repo: "https://git.example.test/alpha",
        },
      }),
    });
    const repo = oneOf(host, ".repo a");
    expect(repo?.getAttribute("href")).toBe("https://git.example.test/alpha");
    expect(textsOf(host, ".repo")).toStrictEqual([
      "https://git.example.test/alpha",
    ]);
  });

  it("leaves the repository line out when there is no repository", () => {
    expect(
      renderProjectView({ lanes: NO_REPO }).querySelector(".repo"),
    ).toBeNull();
  });

  it("says a repository that is not https as text, never as a link", () => {
    const host = renderProjectView({
      lanes: projectLanes({
        project: { id: "alpha", name: "Alpha", repo: "javascript:alert(1)" },
      }),
    });
    expect(host.querySelector(".repo a")).toBeNull();
    expect(textsOf(host, ".repo")).toStrictEqual(["javascript:alert(1)"]);
  });

  it("says a wave that is not in the project, and draws only the strip", () => {
    const host = renderProjectView({
      lanes: projectLanes({
        waves: [waveSummary({ wave: "w-3" }), waveSummary({ wave: "w-2" })],
      }),
      wave: "w-9",
    });
    expect(textsOf(host, ".empty")).toStrictEqual([
      "No such wave in this project.",
    ]);
    expect(textsOf(host, ".wave-strip li a")).toStrictEqual([
      "all lanes",
      "w-3",
      "w-2",
    ]);
    expect(host.querySelectorAll("table")).toHaveLength(0);
    expect(host.querySelector(".note-inline")).toBeNull();
  });
});

describe("the wave strip", () => {
  const WAVES: WaveSummary[] = [
    waveSummary({ wave: "w-3", lanes: 2 }),
    waveSummary({
      wave: "w-2",
      lanes: 1,
      receivedAt: "2026-04-01T11:50:00.000Z",
      stale: true,
    }),
    waveSummary({
      wave: "w-1",
      lanes: 4,
      receivedAt: "2026-04-01T11:00:00.000Z",
      retained: false,
    }),
  ];

  const LISTING = projectLanes({
    project: { id: "alpha", name: "Alpha" },
    waves: WAVES,
    lanes: [laneRow(), laneRow({ id: "wv-b" }), laneRow({ id: "wv-c" })],
  });

  it("counts the lanes of the waves it shows, by their heads, not the rows it was sent", () => {
    // A listing cut short still carries every head: the count beside "all
    // lanes" must agree with the counts beside the waves, not with the cut.
    const host = renderProjectView({
      lanes: projectLanes({
        waves: WAVES,
        lanes: [laneRow()],
        truncated: true,
      }),
    });
    expect(textsOf(host, ".wave-strip li")[0]).toBe("all lanes3 lanes");
  });

  it("never carries the chosen lane to another scope's link", () => {
    const host = renderProjectView({
      lanes: LISTING,
      wave: "w-3",
      query: { all: false, lane: "wv-a" },
    });
    for (const anchor of host.querySelectorAll(".wave-strip a")) {
      expect(anchor.getAttribute("href")).not.toContain("lane=");
    }
  });

  it("counts every lane of the response beside all lanes", () => {
    const host = renderProjectView({ lanes: LISTING });
    expect(textsOf(host, ".wave-strip li")).toStrictEqual([
      "all lanes3 lanes",
      "w-32 lanesjust now",
      "w-21 lane10m agostale",
    ]);
  });

  it("marks all lanes current on the project's own page", () => {
    const host = renderProjectView({ lanes: LISTING });
    expect(textsOf(host, '.wave-strip a[aria-current="page"]')).toStrictEqual([
      "all lanes",
    ]);
  });

  it("marks the route's wave current on a wave's page", () => {
    const host = renderProjectView({ lanes: LISTING, wave: "w-2" });
    expect(textsOf(host, '.wave-strip a[aria-current="page"]')).toStrictEqual([
      "w-2",
    ]);
  });

  it("leaves the waves past retention out until they are asked for", () => {
    const host = renderProjectView({ lanes: LISTING });
    expect(textsOf(host, ".wave-strip li a")).toStrictEqual([
      "all lanes",
      "w-3",
      "w-2",
    ]);

    const all = renderProjectView({
      lanes: LISTING,
      query: { all: true },
    });
    expect(textsOf(all, ".wave-strip li a")).toStrictEqual([
      "all lanes",
      "w-3",
      "w-2",
      "w-1",
    ]);
  });

  it("badges a stale wave and a wave past retention in words", () => {
    const host = renderProjectView({
      lanes: LISTING,
      query: { all: true },
    });
    expect(textsOf(host, ".wave-strip .badge")).toStrictEqual([
      "stale",
      "past retention",
    ]);
    expect(textsOf(host, ".wave-strip .badge.stale")).toStrictEqual(["stale"]);
    expect(textsOf(host, ".wave-strip .badge.aging")).toStrictEqual([
      "past retention",
    ]);
  });

  it("offers no toggle while every wave is still retained", () => {
    const host = renderProjectView({
      lanes: projectLanes({
        waves: [waveSummary({ wave: "w-3" })],
      }),
    });
    expect(host.querySelectorAll(".wave-strip > a")).toHaveLength(0);
  });

  it("asks for the waves past retention, and offers to hide them again", () => {
    const hidden = renderProjectView({ lanes: LISTING });
    const toggle = oneOf(hidden, ".wave-strip > a");
    expect(toggle?.textContent).toBe("show waves past retention");
    expect(toggle?.getAttribute("href")).toBe("/p/alpha?all=1");

    const shown = renderProjectView({
      lanes: LISTING,
      query: { all: true },
    });
    const back = oneOf(shown, ".wave-strip > a");
    expect(back?.textContent).toBe("hide waves past retention");
    expect(back?.getAttribute("href")).toBe("/p/alpha");
  });

  it("keeps the wave the reader is on when the toggle is followed", () => {
    const host = renderProjectView({
      lanes: LISTING,
      wave: "w-1",
      query: { all: true },
    });
    expect(oneOf(host, ".wave-strip > a")?.getAttribute("href")).toBe(
      "/p/alpha/w/w-1",
    );
  });

  it("carries the reader's own query on every href it draws", () => {
    const host = renderProjectView({
      lanes: LISTING,
      wave: "w-2",
      query: { all: true, reason: "gate", lane: "wv-b" },
    });
    expect(
      Array.from(host.querySelectorAll(".wave-strip a"), (anchor) =>
        anchor.getAttribute("href"),
      ),
    ).toStrictEqual([
      "/p/alpha?reason=gate&all=1",
      "/p/alpha/w/w-3?reason=gate&all=1",
      "/p/alpha/w/w-2?reason=gate&all=1",
      "/p/alpha/w/w-1?reason=gate&all=1",
      "/p/alpha/w/w-2?reason=gate",
    ]);
  });

  it("says how many waves the route's own bound left out", () => {
    const one = renderProjectView({
      lanes: projectLanes({ wavesOmitted: 1 }),
    });
    const many = renderProjectView({
      lanes: projectLanes({ wavesOmitted: 1200 }),
    });

    expect(textsOf(one, ".note-inline")).toStrictEqual([
      "1 older wave is not listed.",
    ]);
    expect(textsOf(many, ".note-inline")).toStrictEqual([
      "1200 older waves are not listed.",
    ]);
    // Under the strip, which is the only place a reader can see they are missing.
    expect(
      one.querySelector(".wave-strip")?.nextElementSibling?.className,
    ).toBe("note-inline");
  });

  it("says nothing about omitted waves while the route listed every one", () => {
    expect(
      renderProjectView({ lanes: LISTING }).querySelector(".note-inline"),
    ).toBeNull();
  });

  it("says it under the strip of a wave this project does not have", () => {
    const host = renderProjectView({
      lanes: projectLanes({ waves: [waveSummary()], wavesOmitted: 2 }),
      wave: "w-9",
    });

    expect(textsOf(host, ".note-inline")).toStrictEqual([
      "2 older waves are not listed.",
    ]);
  });
});

describe("the lane table", () => {
  it("says so when the project has pushed nothing at all", () => {
    const host = renderProjectView({
      lanes: projectLanes({ waves: [], lanes: [] }),
    });
    expect(textsOf(host, ".empty")).toStrictEqual([
      "This project has no waves yet.",
    ]);
    expect(host.querySelectorAll("table")).toHaveLength(0);
  });

  it("says so when there is nothing in this scope", () => {
    const host = renderProjectView({
      lanes: projectLanes({ lanes: [laneRow({ wave: "w-2" })] }),
      wave: "w-3",
    });
    expect(textsOf(host, ".empty")).toStrictEqual(["No lanes in this scope."]);
    expect(host.querySelectorAll("table")).toHaveLength(0);
  });

  it("has one column per fact, each labelled for the narrow layout", () => {
    const host = renderProjectView();
    expect(textsOf(host, "thead th")).toStrictEqual([
      "Lane",
      "Reported",
      "Alive",
      "PR",
      "Gate",
      "Reasons",
      "Notes",
    ]);
    expect(labels(host, 0)).toStrictEqual([
      "Lane",
      "Reported",
      "Alive",
      "PR",
      "Gate",
      "Reasons",
      "Notes",
    ]);
  });

  it("reports every field a lane carrying everything carries", () => {
    const row: LaneRow = laneRow({
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
          exit: 0,
          coverage: {
            statements: 98,
            branches: 91.5,
            functions: 100,
            lines: 99,
          },
        },
        pr: { number: 42, state: "open", checks: "pass", unresolvedThreads: 1 },
        diff: { files: 3, insertions: 120, deletions: 14 },
        planReview: "two approvals",
        risk: "low",
        log: { bytes: 4096, mtimeMs: NOW_MS, tail: true },
      },
      disagreements: 2,
      disagreement: "seat 1 says pass, the gate says fail",
      reasons: ["failed", "checks"],
    });
    const host = renderProjectView({
      lanes: projectLanes({ lanes: [row] }),
    });
    expect(cells(host, 0)).toStrictEqual([
      "wv-aw-3s1",
      `review · settled · round 2 · PR #42just now`,
      "stoppedexit 1tail pushed",
      "#42 open · checks pass · 1 open thread",
      "exit 0 · 98% stmts · 91.5% br · 100% funcs · 99% lines",
      "failedchecks",
      "seat 1 says pass, the gate says fail+1 moretwo approvalslow",
    ]);
    expect(
      textsOf(host, "tbody td[data-label='Reported'] span[title]"),
    ).toStrictEqual(["just now"]);
  });

  it("reads a lane carrying nothing optional at all", () => {
    const host = renderProjectView({
      lanes: projectLanes({ lanes: [laneRow()] }),
    });
    expect(cells(host, 0)).toStrictEqual([
      "wv-aw-3",
      "nothing reported",
      "running",
      "no pull request reported",
      "no gate reported",
      "—",
      "",
    ]);
    expect(host.querySelector(".seat")).toBeNull();
    expect(host.querySelector(".disagreement")).toBeNull();
  });

  it("leaves the wave out of a row that is already on a wave's page", () => {
    const host = renderProjectView({
      lanes: projectLanes({ lanes: [laneRow()] }),
      wave: "w-3",
    });
    expect(host.querySelector(".in-wave")).toBeNull();
    expect(textsOf(host, "tbody td[data-label='Lane']")).toStrictEqual([
      "wv-a",
    ]);
  });

  it("links each lane to its own wave with the lane chosen", () => {
    const host = renderProjectView({
      lanes: projectLanes({ lanes: [laneRow()] }),
      wave: "w-3",
    });
    expect(oneOf(host, "td[data-label='Lane'] a")?.getAttribute("href")).toBe(
      "/p/alpha/w/w-3?lane=wv-a",
    );
  });

  it("marks the chosen lane current, and only in this scope", () => {
    const lanes = [
      laneRow({ id: "wv-a" }),
      laneRow({ id: "wv-b", wave: "w-2" }),
    ];
    const waves = [waveSummary({ wave: "w-3" }), waveSummary({ wave: "w-2" })];
    const listing = projectLanes({ waves, lanes });

    const chosen = renderProjectView({
      lanes: listing,
      query: { all: false, lane: "wv-a" },
    });
    expect(textsOf(chosen, "tbody tr.current td:first-child")).toStrictEqual([
      "wv-aw-3",
    ]);

    // The same lane id in another wave is not the row the query chose, so on a
    // wave's page it is not marked even though the ids match.
    const elsewhere = renderProjectView({
      lanes: listing,
      wave: "w-3",
      query: { all: false, lane: "wv-b" },
    });
    expect(elsewhere.querySelectorAll("tbody tr.current")).toHaveLength(0);
    expect(textsOf(elsewhere, "tbody tr")).toHaveLength(1);
  });

  it("marks no row current when the query chooses no lane", () => {
    const host = renderProjectView();
    expect(host.querySelectorAll("tbody tr.current")).toHaveLength(0);
  });

  it.each([
    ["a lane that reported a pull request there is none of", 9, undefined],
    ["a lane that reported another pull request", 9, 42],
    ["a lane that reported the pull request that was derived", 42, 42],
  ] as const)("reads %s", (_label, reported, derived) => {
    const host = renderProjectView({
      lanes: projectLanes({
        lanes: [
          laneRow({
            reported: {
              stage: "review",
              event: "settled",
              ts: NOW_ISO,
              pr: reported,
            },
            derived:
              derived === undefined
                ? { alive: true }
                : {
                    alive: true,
                    pr: { number: derived, state: "open", checks: "pass" },
                  },
          }),
        ],
      }),
    });
    const mismatch = textsOf(host, "td[data-label='PR'] .mismatch");
    expect(mismatch).toStrictEqual(
      reported === derived ? [] : [`reported #${reported}`],
    );
  });

  it("says the tail was pushed, and says so when it was not", () => {
    const pushed = renderProjectView({
      lanes: projectLanes({
        lanes: [
          laneRow({
            derived: { alive: true, log: { bytes: 1, mtimeMs: 0, tail: true } },
          }),
        ],
      }),
    });
    expect(textsOf(pushed, "td[data-label='Alive'] .meta")).toStrictEqual([
      "tail pushed",
    ]);

    const none = renderProjectView({
      lanes: projectLanes({
        lanes: [
          laneRow({
            derived: {
              alive: true,
              log: { bytes: 1, mtimeMs: 0, tail: false },
            },
          }),
        ],
      }),
    });
    expect(textsOf(none, "td[data-label='Alive'] .meta")).toStrictEqual([
      "no tail",
    ]);
  });

  it("says how many more disagreements there are", () => {
    const host = renderProjectView({
      lanes: projectLanes({
        lanes: [
          laneRow({ disagreements: 1, disagreement: "only one" }),
          laneRow({ id: "wv-b", disagreements: 4, disagreement: "the first" }),
        ],
      }),
    });
    expect(textsOf(host, "td[data-label='Notes']")).toStrictEqual([
      "only one",
      "the first+3 more",
    ]);
  });

  it("says so when the listing was cut", () => {
    const host = renderProjectView({
      lanes: projectLanes({ truncated: true }),
    });
    expect(textsOf(host, ".note-inline")).toStrictEqual([
      "This list was cut: the project has more lanes than one page carries.",
    ]);
  });

  it("says nothing about a cut when the listing was not cut", () => {
    expect(renderProjectView().querySelector(".note-inline")).toBeNull();
  });
});

/** A lane that reported a stage, and the minimum the row type asks for besides. */
function reported(stage: string): NonNullable<LaneRow["reported"]> {
  return { stage, event: "settled", ts: NOW_ISO };
}

/** `count` lanes on the seat `seat${at}`, one lane each, all in `w-3`. */
function seats(count: number): LaneRow[] {
  return Array.from({ length: count }, (_ignored, at) =>
    laneRow({ id: `wv-${at}`, seat: `s${at}` }),
  );
}

/**
 * One lane carrying everything the haystack is built from: its id, its wave, its
 * seat, what it reported — with a reported pull request of its own, beside the
 * derived one — and its first disagreement.
 */
const FULL_ROW: LaneRow = laneRow({
  id: "wv-a",
  wave: "w-3",
  seat: "s1",
  reported: { stage: "review", event: "settled", ts: NOW_ISO, pr: 9 },
  derived: {
    alive: true,
    pr: { number: 42, state: "open", checks: "pass" },
  },
  disagreements: 1,
  disagreement: "the seat says pass, the gate says fail",
  reasons: ["failed", "gate"],
});

describe("the counters", () => {
  it("leads with the six numbers the rows in scope answer to", () => {
    const host = renderProjectView({
      lanes: projectLanes({
        lanes: [
          laneRow({ id: "wv-a", derived: { alive: true } }),
          laneRow({
            id: "wv-b",
            derived: { alive: "unknown" },
            reasons: ["silent"],
          }),
          laneRow({
            id: "wv-c",
            derived: {
              alive: false,
              pr: { number: 7, state: "open", checks: "pass" },
            },
            disagreements: 1,
            disagreement: "the seat says pass, the gate says fail",
          }),
        ],
      }),
    });
    expect(textsOf(host, ".kpis dt")).toStrictEqual([
      "Lanes",
      "Alive",
      "Unknown",
      "Need attention",
      "Disagreements",
      "Open PRs",
    ]);
    expect(textsOf(host, ".kpis dd")).toStrictEqual([
      "3",
      "1",
      "1",
      "1",
      "1",
      "1",
    ]);
  });

  it("warns about the three that are asking for something", () => {
    const host = renderProjectView({
      lanes: projectLanes({
        lanes: [
          laneRow({ id: "wv-a", derived: { alive: "unknown" } }),
          laneRow({ id: "wv-b", reasons: ["gate"] }),
          laneRow({
            id: "wv-c",
            disagreements: 1,
            disagreement: "the seat says pass, the gate says fail",
          }),
        ],
      }),
    });
    expect(textsOf(host, ".kpis .warn dt")).toStrictEqual([
      "Unknown",
      "Need attention",
      "Disagreements",
    ]);
  });

  it("warns about nothing in a scope where nothing is wrong", () => {
    const host = renderProjectView({
      lanes: projectLanes({ lanes: [laneRow()] }),
    });
    expect(textsOf(host, ".kpis dd")).toStrictEqual([
      "1",
      "1",
      "0",
      "0",
      "0",
      "0",
    ]);
    expect(host.querySelectorAll(".kpis .warn")).toHaveLength(0);
  });

  it("counts nothing at all for a scope with no lanes", () => {
    const host = renderProjectView({
      lanes: projectLanes({ lanes: [laneRow({ wave: "w-2" })] }),
      wave: "w-3",
    });
    expect(textsOf(host, ".kpis dd")).toStrictEqual([
      "0",
      "0",
      "0",
      "0",
      "0",
      "0",
    ]);
  });
});

describe("the stale banner", () => {
  const WAVES: WaveSummary[] = [
    waveSummary({ wave: "w-3" }),
    waveSummary({
      wave: "w-2",
      receivedAt: "2026-04-01T11:50:00.000Z",
      stale: true,
    }),
    waveSummary({
      wave: "w-1",
      receivedAt: "2026-04-01T11:00:00.000Z",
      stale: true,
      retained: false,
    }),
  ];

  const LISTING = projectLanes({ waves: WAVES, lanes: [laneRow()] });

  it("says nothing when nothing in scope is stale", () => {
    const host = renderProjectView({
      lanes: projectLanes({ waves: [waveSummary()] }),
    });
    expect(host.querySelectorAll(".banner")).toHaveLength(0);
  });

  it("says nothing for a fresh wave on a wave's own page", () => {
    const host = renderProjectView({ lanes: LISTING, wave: "w-3" });
    expect(host.querySelectorAll(".banner")).toHaveLength(0);
  });

  it("names the wave the route is on, and the exact stamp of its last push", () => {
    const host = renderProjectView({ lanes: LISTING, wave: "w-2" });
    expect(textsOf(host, ".banner")).toStrictEqual([
      "This wave is stale: no snapshot arrived inside its interval, so lanes last seen alive read unknown. Last received 10m ago.",
    ]);
    expect(oneOf(host, ".banner span[title]")?.getAttribute("title")).toBe(
      "2026-04-01T11:50:00.000Z",
    );
  });

  it("says a wave pushed without an interval was never given one to miss", () => {
    const host = renderProjectView({
      lanes: projectLanes({
        waves: [
          waveSummary({ wave: "w-3", stale: true, intervalSeconds: null }),
        ],
        lanes: [laneRow()],
      }),
      wave: "w-3",
    });
    expect(textsOf(host, ".banner")).toStrictEqual([
      "This wave is stale: no snapshot arrived since it was pushed without an interval, so lanes last seen alive read unknown. Last received just now.",
    ]);
  });

  it("counts one stale wave among the ones the strip shows", () => {
    const host = renderProjectView({ lanes: LISTING });
    expect(textsOf(host, ".banner")).toStrictEqual([
      "1 of 2 waves shown is stale: lanes last seen alive in them read unknown.",
    ]);
  });

  it("counts them in the plural once the strip shows more of them", () => {
    const host = renderProjectView({
      lanes: LISTING,
      query: { all: true },
    });
    expect(textsOf(host, ".banner")).toStrictEqual([
      "2 of 3 waves shown are stale: lanes last seen alive in them read unknown.",
    ]);
  });

  it("is a status region, so a reader is told without going looking", () => {
    const host = renderProjectView({ lanes: LISTING });
    expect(oneOf(host, ".banner")?.getAttribute("role")).toBe("status");
    expect(oneOf(host, ".banner")?.getAttribute("class")).toBe("banner stale");
  });

  it("answers a wave the strip is not showing: the reader asked for that wave", () => {
    // w-1 is past the retention, so the strip cannot show it, and the page
    // cannot say the wave is stale either — which would be quiet about the one
    // thing a reader who opened that wave's page is looking at.
    const host = renderProjectView({ lanes: LISTING, wave: "w-1" });
    expect(textsOf(host, ".banner")).toStrictEqual([
      "This wave is stale: no snapshot arrived inside its interval, so lanes last seen alive read unknown. Last received 1h ago.",
    ]);
  });
});

describe("the disagreements panel", () => {
  const LISTING = projectLanes({
    waves: [waveSummary({ wave: "w-3" }), waveSummary({ wave: "w-2" })],
    lanes: [
      laneRow({ id: "wv-a", wave: "w-2", disagreements: 1, disagreement: "a" }),
      laneRow({
        id: "wv-b",
        reasons: ["gate"],
        disagreements: 3,
        disagreement: "b",
      }),
      laneRow({
        id: "wv-c",
        reasons: ["gate"],
        disagreements: 1,
        disagreement: "c",
      }),
    ],
  });

  it("says a scope in which nothing disagrees, and what silence is not", () => {
    const host = renderProjectView({ lanes: projectLanes() });
    expect(textsOf(host, ".panel.disagreements h2")).toStrictEqual([
      "Disagreements",
    ]);
    expect(textsOf(host, ".panel.disagreements .panel-empty")).toStrictEqual([
      "Nothing in this scope disagrees. A missing snapshot is still not agreement.",
    ]);
    expect(host.querySelectorAll(".panel.disagreements li")).toHaveLength(0);
  });

  it("lists only the rows that disagree, in the order the table shows them", () => {
    const host = renderProjectView({ lanes: LISTING });
    expect(textsOf(host, ".panel.disagreements li a")).toStrictEqual([
      "wv-b",
      "wv-c",
      "wv-a",
    ]);
    expect(textsOf(host, ".panel.disagreements li code")).toStrictEqual([
      "w-3",
      "w-3",
      "w-2",
    ]);
    expect(textsOf(host, ".panel.disagreements .disagreement")).toStrictEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("says how many more disagreements the lane has behind the first", () => {
    const host = renderProjectView({ lanes: LISTING });
    expect(textsOf(host, ".panel.disagreements .meta")).toStrictEqual([
      "+2 more",
    ]);
    expect(textsOf(host, ".panel.disagreements li")[0]).toBe("wv-bw-3b+2 more");
    expect(textsOf(host, ".panel.disagreements li")[1]).toBe("wv-cw-3c");
  });

  it("links each lane to its own wave with the lane chosen, and without the filter", () => {
    // The panel lists lanes the filter may hide: a link that kept the filter
    // would open a wave page whose table leaves out the lane it names.
    const host = renderProjectView({
      lanes: LISTING,
      query: { all: true, reason: "gate" },
    });
    expect(
      Array.from(host.querySelectorAll(".panel.disagreements a"), (anchor) =>
        anchor.getAttribute("href"),
      ),
    ).toStrictEqual([
      "/p/alpha/w/w-3?lane=wv-b&all=1",
      "/p/alpha/w/w-3?lane=wv-c&all=1",
      "/p/alpha/w/w-2?lane=wv-a&all=1",
    ]);
  });

  it("leaves a wave's own page showing only that wave's rows", () => {
    const host = renderProjectView({ lanes: LISTING, wave: "w-2" });
    expect(textsOf(host, ".panel.disagreements li a")).toStrictEqual(["wv-a"]);
  });
});

describe("the seats panel", () => {
  it("says so when the scope has no lanes at all", () => {
    const host = renderProjectView({
      lanes: projectLanes({ lanes: [laneRow({ wave: "w-2" })] }),
      wave: "w-3",
    });
    expect(textsOf(host, ".panel.seats h2")).toStrictEqual(["Seats"]);
    expect(textsOf(host, ".panel.seats .panel-empty")).toStrictEqual([
      "No lanes in this scope.",
    ]);
    expect(host.querySelectorAll(".panel.seats li")).toHaveLength(0);
  });

  it("measures every seat against every row in scope", () => {
    const host = renderProjectView({
      lanes: projectLanes({
        lanes: [
          laneRow({ id: "wv-a", seat: "s1" }),
          laneRow({ id: "wv-b", seat: "s1" }),
          laneRow({ id: "wv-c", seat: "s2" }),
          laneRow({ id: "wv-d", seat: "s2" }),
          laneRow({ id: "wv-e", seat: "s2" }),
        ],
      }),
    });
    expect(textsOf(host, ".panel.seats li")).toStrictEqual(["s23", "s12"]);
    const meters = host.querySelectorAll(".panel.seats meter");
    expect(
      Array.from(meters, (meter) => [
        meter.getAttribute("value"),
        meter.getAttribute("max"),
      ]),
    ).toStrictEqual([
      ["3", "5"],
      ["2", "5"],
    ]);
  });

  it("names eight seats and no ninth when there are eight", () => {
    const host = renderProjectView({
      lanes: projectLanes({ lanes: seats(8) }),
    });
    expect(host.querySelectorAll(".panel.seats li")).toHaveLength(8);
    expect(textsOf(host, ".panel.seats .name")).toStrictEqual([
      "s0",
      "s1",
      "s2",
      "s3",
      "s4",
      "s5",
      "s6",
      "s7",
    ]);
  });

  it("puts the ninth seat and every seat after it into one line", () => {
    const host = renderProjectView({
      lanes: projectLanes({ lanes: seats(9) }),
    });
    expect(host.querySelectorAll(".panel.seats li")).toHaveLength(9);
    expect(textsOf(host, ".panel.seats li")[8]).toBe("others1");
  });

  it("sums the rest into one number when there are eleven seats", () => {
    const host = renderProjectView({
      lanes: projectLanes({ lanes: seats(11) }),
    });
    expect(host.querySelectorAll(".panel.seats li")).toHaveLength(9);
    expect(textsOf(host, ".panel.seats li")[8]).toBe("others3");
  });

  it("names the lanes that recorded no seat, and puts them last", () => {
    const host = renderProjectView({
      lanes: projectLanes({
        lanes: [laneRow({ id: "wv-a" }), laneRow({ id: "wv-b", seat: "s1" })],
      }),
    });
    expect(textsOf(host, ".panel.seats .name")).toStrictEqual([
      "s1",
      "no seat recorded",
    ]);
  });
});

describe("the stage rail", () => {
  it("lists the stages in the order the pushers first reported them", () => {
    const host = renderProjectView({
      lanes: projectLanes({
        lanes: [
          laneRow({ id: "wv-a", reported: reported("review") }),
          laneRow({ id: "wv-b", reported: reported("build") }),
          laneRow({ id: "wv-c", reported: reported("review") }),
        ],
      }),
    });
    expect(textsOf(host, ".stages li")).toStrictEqual(["review2", "build1"]);
  });

  it("puts the lanes that reported nothing last", () => {
    const host = renderProjectView({
      lanes: projectLanes({
        lanes: [
          laneRow({ id: "wv-a" }),
          laneRow({ id: "wv-b", reported: reported("ship") }),
          laneRow({ id: "wv-c" }),
        ],
      }),
    });
    expect(textsOf(host, ".stages li")).toStrictEqual([
      "ship1",
      "not reported2",
    ]);
  });

  it("is not drawn at all when the scope has no lanes", () => {
    const host = renderProjectView({
      lanes: projectLanes({ lanes: [laneRow({ wave: "w-2" })] }),
      wave: "w-3",
    });
    expect(host.querySelectorAll(".stages")).toHaveLength(0);
  });
});

describe("the toolbar", () => {
  const LISTING = projectLanes({
    waves: [waveSummary({ wave: "w-3" })],
    lanes: [
      laneRow({
        id: "wv-a",
        seat: "s2",
        reported: reported("review"),
        reasons: ["failed", "gate"],
        derived: {
          alive: true,
          pr: { number: 7, state: "open", checks: "pass" },
        },
      }),
      laneRow({
        id: "wv-b",
        seat: "s1",
        reported: reported("build"),
        reasons: ["failed"],
      }),
      laneRow({ id: "wv-c" }),
    ],
  });

  /** The page drawn over `LISTING`, with the calls the controls made. */
  function drawn(query: Partial<ViewQuery> = {}): {
    readonly host: HTMLElement;
    readonly onFilter: ReturnType<typeof vi.fn>;
    readonly onSearch: ReturnType<typeof vi.fn>;
    readonly onCopy: ReturnType<typeof vi.fn>;
  } {
    const onFilter = vi.fn();
    const onSearch = vi.fn();
    const onCopy = vi.fn();
    const host = renderProjectView(
      { lanes: LISTING, query: { all: false, ...query } },
      NOW_MS,
      { onFilter, onSearch, onCopy },
    );
    return { host, onFilter, onSearch, onCopy };
  }

  it("counts a chip for every reason that asks for something, and none else", () => {
    expect(textsOf(drawn().host, ".chips a")).toStrictEqual([
      "all",
      "failed · 2",
      "gate · 1",
    ]);
  });

  it("marks the all chip current while no reason is chosen", () => {
    expect(
      textsOf(drawn().host, '.chips a[aria-current="true"]'),
    ).toStrictEqual(["all"]);
    expect(
      drawn({ reason: "failed" }).host.querySelectorAll(
        '.chips a[aria-current="true"]',
      ),
    ).toHaveLength(1);
  });

  it("marks the chosen reason current, and nothing else", () => {
    const { host } = drawn({ reason: "gate" });
    expect(textsOf(host, '.chips a[aria-current="true"]')).toStrictEqual([
      "gate · 1",
    ]);
  });

  it("keeps a chip nothing carries, because it is the chosen one", () => {
    // A chip that vanished under the reader's cursor is a chip that cannot be
    // turned off.
    const { host } = drawn({ reason: "silent" });
    expect(textsOf(host, ".chips a")).toStrictEqual([
      "all",
      "failed · 2",
      "gate · 1",
      "silent · 0",
    ]);
  });

  it("links each chip to this page with that reason, and carries the reader's query", () => {
    const { host } = drawn({ all: true, lane: "wv-b" });
    expect(
      Array.from(host.querySelectorAll(".chips a"), (anchor) =>
        anchor.getAttribute("href"),
      ),
    ).toStrictEqual([
      "/p/alpha?all=1",
      "/p/alpha?reason=failed&all=1",
      "/p/alpha?reason=gate&all=1",
    ]);
  });

  it("links the chosen chip back to the page with no reason at all", () => {
    const { host } = drawn({ reason: "gate" });
    expect(
      Array.from(host.querySelectorAll(".chips a"), (anchor) =>
        anchor.getAttribute("href"),
      ),
    ).toStrictEqual(["/p/alpha", "/p/alpha?reason=failed", "/p/alpha"]);
  });

  it("lists the seats and the stages in scope, ascending, under their labels", () => {
    const { host } = drawn();
    expect(textsOf(host, ".toolbar label")).toStrictEqual([
      "Seat",
      "Stage",
      "Search",
    ]);
    expect(textsOf(host, "#filter-seat option")).toStrictEqual([
      "all seats",
      "s1",
      "s2",
    ]);
    expect(textsOf(host, "#filter-stage option")).toStrictEqual([
      "all stages",
      "build",
      "review",
    ]);
  });

  it("shows the seat and the stage the address chose, when they are in scope", () => {
    const { host } = drawn({ seat: "s1", stage: "build" });
    expect(
      (host.querySelector("#filter-seat") as HTMLSelectElement).value,
    ).toBe("s1");
    expect(
      (host.querySelector("#filter-stage") as HTMLSelectElement).value,
    ).toBe("build");
  });

  it("shows neither chosen when the address names one this scope does not have", () => {
    const { host } = drawn({ seat: "s9", stage: "ship" });
    expect(
      (host.querySelector("#filter-seat") as HTMLSelectElement).value,
    ).toBe("");
    expect(
      (host.querySelector("#filter-stage") as HTMLSelectElement).value,
    ).toBe("");
    expect(textsOf(host, "#filter-seat option")).toStrictEqual([
      "all seats",
      "s1",
      "s2",
    ]);
  });

  it("asks for the seat a reader picks, and for none when they pick them all", () => {
    const { host, onFilter } = drawn();
    const select = host.querySelector("#filter-seat") as HTMLSelectElement;
    select.value = "s1";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onFilter).toHaveBeenLastCalledWith({ seat: "s1" });

    select.value = "";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onFilter).toHaveBeenLastCalledWith({ seat: undefined });
  });

  it("asks for the stage a reader picks, and for none when they pick them all", () => {
    const { host, onFilter } = drawn();
    const select = host.querySelector("#filter-stage") as HTMLSelectElement;
    select.value = "review";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onFilter).toHaveBeenLastCalledWith({ stage: "review" });

    select.value = "";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onFilter).toHaveBeenLastCalledWith({ stage: undefined });
  });

  it("shows the reader's own search, and asks for it as it is typed", () => {
    const { host, onSearch } = drawn({ q: "wv-a" });
    const input = host.querySelector("#filter-q") as HTMLInputElement;
    expect(input.value).toBe("wv-a");
    expect(input.getAttribute("type")).toBe("search");
    expect(input.getAttribute("placeholder")).toBe("lane, seat, PR…");
    expect(input.getAttribute("data-key")).toBe("q");

    input.value = "wv-b";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onSearch).toHaveBeenLastCalledWith("wv-b");
  });

  it("waits for a composed character to be finished before it asks", () => {
    const { host, onSearch } = drawn();
    const input = host.querySelector("#filter-q") as HTMLInputElement;
    input.value = "k";
    input.dispatchEvent(
      new InputEvent("input", { bubbles: true, isComposing: true }),
    );
    expect(onSearch).not.toHaveBeenCalled();

    input.value = "か";
    input.dispatchEvent(new Event("compositionend", { bubbles: true }));
    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(onSearch).toHaveBeenLastCalledWith("か");
  });

  it("asks for no search at all when the box is emptied", () => {
    const { host, onSearch } = drawn({ q: "wv-a" });
    const input = host.querySelector("#filter-q") as HTMLInputElement;
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onSearch).toHaveBeenLastCalledWith("");
  });

  it("asks for a search no longer than the address will carry", () => {
    const { host, onSearch } = drawn();
    const input = host.querySelector("#filter-q") as HTMLInputElement;
    input.value = "a".repeat(100);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onSearch).toHaveBeenLastCalledWith("a".repeat(80));
  });

  it("says how much of the scope is left, and is a status region", () => {
    const { host } = drawn({ seat: "s1" });
    const shown = oneOf(host, ".toolbar .shown");
    expect(shown?.textContent).toBe("1 of 3 shown");
    expect(shown?.getAttribute("role")).toBe("status");

    expect(textsOf(drawn().host, ".toolbar .shown")).toStrictEqual([
      "3 of 3 shown",
    ]);
  });

  it("offers the digest after the count, keyed so a redraw can find it", () => {
    const { host } = drawn();
    const button = oneOf(host, ".toolbar button.copy");
    expect(button?.tagName).toBe("BUTTON");
    expect(button?.getAttribute("type")).toBe("button");
    expect(button?.getAttribute("data-key")).toBe("digest");
    expect(textOf(button)).toBe("Copy digest");
    // The last two children of the toolbar: the count, then the button and what
    // it last said.
    expect(textsOf(host, ".toolbar > span:last-child")).toStrictEqual([""]);
  });

  it("asks for the digest when the button is clicked", () => {
    const { host, onCopy } = drawn();
    const button = oneOf(host, ".toolbar button.copy") as HTMLElement;
    button.click();
    button.click();
    expect(onCopy).toHaveBeenCalledTimes(2);
  });

  it("says what the last copy said, in a status region of its own", () => {
    const said = (copied: string): Element | null =>
      oneOf(
        renderProjectView({ lanes: LISTING, query: { all: false }, copied }),
        ".toolbar .copied",
      );
    expect(textOf(said("Digest copied"))).toBe("Digest copied");
    expect(said("Digest copied")?.getAttribute("role")).toBe("status");
    expect(said("Digest copied")?.getAttribute("aria-live")).toBe("polite");
    // And nothing at all when no copy has been made.
    expect(textOf(said(""))).toBe("");
    expect(textOf(said("Copy failed"))).toBe("Copy failed");
  });

  it("draws the table the filter leaves, and the chips the filter does not move", () => {
    const { host } = drawn({ reason: "failed" });
    expect(textsOf(host, "tbody tr")).toHaveLength(2);
    expect(textsOf(host, ".chips a")).toStrictEqual([
      "all",
      "failed · 2",
      "gate · 1",
    ]);
  });

  it("says nothing matches when the filter leaves no row", () => {
    const { host } = drawn({ seat: "s9" });
    expect(host.querySelectorAll("table")).toHaveLength(0);
    expect(textsOf(host, ".empty")).toStrictEqual(["No lanes match."]);
  });

  it("does not move the counters, the panels or the rail when a filter changes", () => {
    const whole = drawn().host;
    const filtered = drawn({ reason: "failed" }).host;
    expect(textsOf(filtered, ".kpis dd")).toStrictEqual(
      textsOf(whole, ".kpis dd"),
    );
    expect(textsOf(filtered, ".panel.seats li")).toStrictEqual(
      textsOf(whole, ".panel.seats li"),
    );
    expect(textsOf(filtered, ".stages li")).toStrictEqual(
      textsOf(whole, ".stages li"),
    );
    expect(
      textsOf(filtered, ".panel.disagreements .panel-empty"),
    ).toStrictEqual(textsOf(whole, ".panel.disagreements .panel-empty"));
  });

  it("is not drawn at all when the scope has no lanes", () => {
    const host = renderProjectView({
      lanes: projectLanes({ lanes: [laneRow({ wave: "w-2" })] }),
      wave: "w-3",
    });
    expect(host.querySelectorAll(".toolbar")).toHaveLength(0);
    expect(textsOf(host, ".empty")).toStrictEqual(["No lanes in this scope."]);
  });

  it("marks the lane the address names current, and no other row", () => {
    const { host } = drawn({ lane: "wv-b" });
    expect(
      textsOf(host, 'tbody tr[aria-current="true"] td[data-label="Lane"] a'),
    ).toStrictEqual(["wv-b"]);
    expect(host.querySelectorAll("tbody tr[aria-current]")).toHaveLength(1);
    expect(
      drawn().host.querySelectorAll("tbody tr[aria-current]"),
    ).toHaveLength(0);
  });

  it("names its controls with literals of its own, never with an API string", () => {
    const hostile = projectLanes({
      waves: [waveSummary({ wave: "w-3" })],
      lanes: [laneRow({ seat: "seat", reported: reported("build") })],
    });
    const host = renderProjectView({ lanes: hostile });
    expect(host.querySelector("select")?.getAttribute("id")).toBe(
      "filter-seat",
    );
    expect(host.querySelector("select")?.getAttribute("name")).toBe("seat");
    expect(host.querySelector("select")?.getAttribute("data-key")).toBe("seat");
    expect(
      Array.from(host.querySelectorAll("select"), (select) => [
        select.getAttribute("id"),
        select.getAttribute("data-key"),
      ]),
    ).toStrictEqual([
      ["filter-seat", "seat"],
      ["filter-stage", "stage"],
    ]);
  });
});

describe("a wave the project does not have", () => {
  it("draws none of the counters, the banner, the panels or the rail", () => {
    const host = renderProjectView({
      lanes: projectLanes({ waves: [waveSummary({ wave: "w-3" })] }),
      wave: "w-9",
    });
    expect(host.querySelectorAll(".kpis")).toHaveLength(0);
    expect(host.querySelectorAll(".banner")).toHaveLength(0);
    expect(host.querySelectorAll(".split")).toHaveLength(0);
    expect(host.querySelectorAll(".panel")).toHaveLength(0);
    expect(host.querySelectorAll(".stages")).toHaveLength(0);
  });
});

describe("scopeOf", () => {
  const listing = projectLanes({
    lanes: [laneRow(), laneRow({ id: "wv-b", wave: "w-2" })],
  });

  it("takes every row on the project's own page", () => {
    expect(scopeOf(listing, undefined)).toHaveLength(2);
  });

  it("takes only the rows of the wave the path names", () => {
    expect(scopeOf(listing, "w-2").map((row) => row.id)).toStrictEqual([
      "wv-b",
    ]);
    expect(scopeOf(listing, "w-9")).toStrictEqual([]);
  });
});

describe("countersOf", () => {
  it("counts each of the six facts, and each row once", () => {
    const rows = [
      laneRow({ id: "wv-a", derived: { alive: true } }),
      laneRow({
        id: "wv-b",
        derived: { alive: "unknown" },
        reasons: ["failed", "checks"],
        disagreements: 2,
        disagreement: "the seat says pass, the gate says fail",
      }),
      laneRow({
        id: "wv-c",
        derived: {
          alive: false,
          pr: { number: 7, state: "open", checks: "pass" },
        },
      }),
    ];
    expect(countersOf(rows)).toStrictEqual({
      lanes: 3,
      alive: 1,
      unknown: 1,
      attention: 1,
      disagreements: 1,
      openPrs: 1,
    });
  });

  it("counts a merged or closed pull request as no open pull request", () => {
    const rows = [
      laneRow({
        id: "wv-a",
        derived: {
          alive: true,
          pr: { number: 7, state: "merged", checks: "pass" },
        },
      }),
      laneRow({
        id: "wv-b",
        derived: {
          alive: true,
          pr: { number: 8, state: "closed", checks: "fail" },
        },
      }),
    ];
    expect(countersOf(rows)).toStrictEqual({
      lanes: 2,
      alive: 2,
      unknown: 0,
      attention: 0,
      disagreements: 0,
      openPrs: 0,
    });
  });

  it("counts nothing for an empty scope", () => {
    expect(countersOf([])).toStrictEqual({
      lanes: 0,
      alive: 0,
      unknown: 0,
      attention: 0,
      disagreements: 0,
      openPrs: 0,
    });
  });
});

describe("seatsOf", () => {
  it("counts the lanes under each seat, busiest first", () => {
    expect(
      seatsOf([
        laneRow({ id: "wv-a", seat: "alpha" }),
        laneRow({ id: "wv-b", seat: "beta" }),
        laneRow({ id: "wv-c", seat: "alpha" }),
        laneRow({ id: "wv-d", seat: "beta" }),
        laneRow({ id: "wv-e", seat: "beta" }),
      ]),
    ).toStrictEqual([
      { seat: "beta", lanes: 3 },
      { seat: "alpha", lanes: 2 },
    ]);
  });

  it("breaks a tie on the seat name, and puts the lanes with no seat last", () => {
    expect(
      seatsOf([
        laneRow({ id: "wv-a", seat: "gamma" }),
        laneRow({ id: "wv-b", seat: "delta" }),
        laneRow({ id: "wv-c", seat: "alpha" }),
        laneRow({ id: "wv-d", seat: "alpha" }),
        laneRow({ id: "wv-e", seat: "beta" }),
        laneRow({ id: "wv-f", seat: "beta" }),
        laneRow({ id: "wv-g", seat: "beta" }),
        laneRow({ id: "wv-h" }),
      ]),
    ).toStrictEqual([
      { seat: "beta", lanes: 3 },
      { seat: "alpha", lanes: 2 },
      { seat: "delta", lanes: 1 },
      { seat: "gamma", lanes: 1 },
      { seat: undefined, lanes: 1 },
    ]);
  });

  it("puts the lanes with no seat last however many they are", () => {
    expect(
      seatsOf([
        laneRow({ id: "wv-a" }),
        laneRow({ id: "wv-b" }),
        laneRow({ id: "wv-c", seat: "alpha" }),
      ]),
    ).toStrictEqual([
      { seat: "alpha", lanes: 1 },
      { seat: undefined, lanes: 2 },
    ]);
  });

  it("is empty for a scope with no lanes", () => {
    expect(seatsOf([])).toStrictEqual([]);
  });
});

describe("stagesOf", () => {
  it("counts the lanes in each stage, in the order the stages first appear", () => {
    expect(
      stagesOf([
        laneRow({ id: "wv-a", reported: reported("review") }),
        laneRow({ id: "wv-b", reported: reported("build") }),
        laneRow({ id: "wv-c", reported: reported("review") }),
      ]),
    ).toStrictEqual([
      { stage: "review", lanes: 2 },
      { stage: "build", lanes: 1 },
    ]);
  });

  it("puts the lanes that reported nothing last, wherever they first appear", () => {
    expect(
      stagesOf([
        laneRow({ id: "wv-a", reported: reported("ship") }),
        laneRow({ id: "wv-b" }),
        laneRow({ id: "wv-c" }),
      ]),
    ).toStrictEqual([
      { stage: "ship", lanes: 1 },
      { stage: undefined, lanes: 2 },
    ]);
  });

  it("is empty for a scope with no lanes", () => {
    expect(stagesOf([])).toStrictEqual([]);
  });
});

describe("staleWavesOf", () => {
  const LISTING = projectLanes({
    waves: [
      waveSummary({ wave: "w-3" }),
      waveSummary({ wave: "w-2", stale: true }),
      waveSummary({ wave: "w-1", stale: true, retained: false }),
    ],
  });

  const waves = (stale: readonly WaveSummary[]): string[] =>
    stale.map((head) => head.wave);

  it("answers the wave the route names, when it is stale", () => {
    expect(waves(staleWavesOf(LISTING, "w-2", false))).toStrictEqual(["w-2"]);
  });

  it("answers the wave the route names, even when the strip is not showing it", () => {
    // Past the retention is a reason the strip hides a wave, not a reason to stop
    // answering for the wave the reader's own address names.
    expect(waves(staleWavesOf(LISTING, "w-1", false))).toStrictEqual(["w-1"]);
  });

  it("answers nothing for a fresh wave, and nothing for one that is not there", () => {
    expect(staleWavesOf(LISTING, "w-3", false)).toStrictEqual([]);
    expect(staleWavesOf(LISTING, "w-9", false)).toStrictEqual([]);
  });

  it("counts the stale waves the strip shows on the project's own page", () => {
    expect(waves(staleWavesOf(LISTING, undefined, false))).toStrictEqual([
      "w-2",
    ]);
  });

  it("counts the waves past the retention only once they are asked for", () => {
    expect(waves(staleWavesOf(LISTING, undefined, true))).toStrictEqual([
      "w-2",
      "w-1",
    ]);
  });

  it("answers nothing for a project with no waves", () => {
    expect(
      staleWavesOf(projectLanes({ waves: [] }), undefined, false),
    ).toStrictEqual([]);
  });
});

describe("matches", () => {
  const asked = (query: Partial<ViewQuery>): boolean =>
    matches(FULL_ROW, { all: false, ...query });

  it("keeps a row when the address asks for nothing", () => {
    expect(asked({})).toBe(true);
  });

  it("keeps a row only when it carries the reason the address names", () => {
    expect(asked({ reason: "failed" })).toBe(true);
    expect(asked({ reason: "exit" })).toBe(false);
  });

  it("keeps a row only when it reported the stage the address names", () => {
    expect(asked({ stage: "review" })).toBe(true);
    expect(asked({ stage: "build" })).toBe(false);
  });

  it("matches no row that reported nothing at all against a stage", () => {
    expect(matches(laneRow(), { all: false, stage: "review" })).toBe(false);
  });

  it("keeps a row only when it is on the seat the address names", () => {
    expect(asked({ seat: "s1" })).toBe(true);
    expect(asked({ seat: "s2" })).toBe(false);
  });

  it("matches no row with no seat against a seat", () => {
    expect(matches(laneRow(), { all: false, seat: "s1" })).toBe(false);
  });

  it.each([
    ["the lane id", "wv-a"],
    ["the wave id", "w-3"],
    ["the seat", "s1"],
    ["the reported stage", "review"],
    ["the reported event", "settled"],
    ["the derived pull request", "#42"],
    ["the reported pull request", "#9"],
    ["the disagreement", "the seat says pass"],
  ])("finds a row by %s", (_label, needle) => {
    expect(asked({ q: needle })).toBe(true);
  });

  it("finds a row whatever case it is asked in", () => {
    expect(asked({ q: "WV-A" })).toBe(true);
    expect(asked({ q: "Review" })).toBe(true);
    expect(asked({ q: "SEAT SAYS PASS" })).toBe(true);
    expect(asked({ q: "wv-z" })).toBe(false);
  });

  it("finds nothing in a row that carries nothing to find", () => {
    const bare = laneRow({ id: "wv-b" });
    expect(matches(bare, { all: false, q: "wv-b" })).toBe(true);
    expect(matches(bare, { all: false, q: "review" })).toBe(false);
    expect(matches(bare, { all: false, q: "#42" })).toBe(false);
    expect(matches(bare, { all: false, q: "s1" })).toBe(false);
  });
});

describe("filterRows", () => {
  const rows = [
    laneRow({ id: "wv-a", seat: "s1", reasons: ["failed"] }),
    laneRow({ id: "wv-b", seat: "s2", reported: reported("build") }),
    laneRow({ id: "wv-c", seat: "s1", reported: reported("build") }),
  ];

  const left = (query: Partial<ViewQuery>): string[] =>
    filterRows(rows, { all: false, ...query }).map((row) => row.id);

  it("keeps every row when the address asks for nothing", () => {
    expect(left({})).toStrictEqual(["wv-a", "wv-b", "wv-c"]);
  });

  it("keeps the rows one filter leaves, in the order they were given", () => {
    expect(left({ seat: "s1" })).toStrictEqual(["wv-a", "wv-c"]);
    expect(left({ reason: "failed" })).toStrictEqual(["wv-a"]);
    expect(left({ stage: "build" })).toStrictEqual(["wv-b", "wv-c"]);
    expect(left({ q: "wv-c" })).toStrictEqual(["wv-c"]);
  });

  it("keeps nothing when two filters cannot both hold", () => {
    expect(left({ seat: "s1", stage: "build" })).toStrictEqual(["wv-c"]);
    expect(left({ seat: "s1", reason: "gate" })).toStrictEqual([]);
  });

  it("is empty for an empty scope", () => {
    expect(filterRows([], { all: false, seat: "s1" })).toStrictEqual([]);
  });
});

describe("reasonCounts", () => {
  it("answers every reason in the order the six are written in", () => {
    expect([
      ...reasonCounts([
        laneRow({ id: "wv-a", reasons: ["silent"] }),
        laneRow({ id: "wv-b", reasons: ["failed", "checks"] }),
        laneRow({ id: "wv-c", reasons: ["failed"] }),
      ]),
    ]).toStrictEqual([
      ["failed", 2],
      ["disagreement", 0],
      ["checks", 1],
      ["gate", 0],
      ["exit", 0],
      ["silent", 1],
    ]);
  });

  it("counts one reason once on a row, however it was carried", () => {
    expect(
      reasonCounts([laneRow({ reasons: ["failed", "failed"] })]).get("failed"),
    ).toBe(2);
  });

  it("counts every reason zero for an empty scope", () => {
    expect([...reasonCounts([])]).toStrictEqual([
      ["failed", 0],
      ["disagreement", 0],
      ["checks", 0],
      ["gate", 0],
      ["exit", 0],
      ["silent", 0],
    ]);
  });
});

describe("searchText", () => {
  it("leaves ordinary text exactly as it was typed", () => {
    expect(searchText("wv-a")).toBe("wv-a");
    expect(searchText("")).toBe("");
    expect(searchText("PR #42 · seat s1")).toBe("PR #42 · seat s1");
  });

  it("keeps the first 80 characters of a longer search", () => {
    expect(searchText("a".repeat(81))).toBe("a".repeat(80));
    expect(searchText("a".repeat(80))).toBe("a".repeat(80));
  });

  it("takes out the control characters a reader pasted in", () => {
    // `parseQuery` refuses a control character and a value over 80 characters, so
    // a box that wrote one of these into the address would empty itself.
    expect(searchText("a\tbc")).toBe("abc");
    expect(searchText("a\nb")).toBe("ab");
    expect(searchText("a\u007fb")).toBe("ab");
  });

  it("never cuts a character in half", () => {
    // U+1F30A is two code units: the 80th and the 81st here.
    expect(searchText(`${"a".repeat(79)}\u{1F30A}`)).toBe("a".repeat(79));
    expect(searchText(`${"a".repeat(78)}\u{1F30A}`)).toBe(
      `${"a".repeat(78)}\u{1F30A}`,
    );
    expect(searchText("")).toBe("");
  });
});

describe("pathFor and hrefFor", () => {
  it("writes the project's own path, and a wave's path under it", () => {
    expect(pathFor("alpha", undefined)).toBe("/p/alpha");
    expect(pathFor("alpha", "w-3")).toBe("/p/alpha/w/w-3");
  });

  it("encodes every segment", () => {
    expect(pathFor("a b", "w 3")).toBe("/p/a%20b/w/w%203");
  });

  it("appends the reader's own query", () => {
    expect(hrefFor("alpha", undefined, { all: false })).toBe("/p/alpha");
    expect(hrefFor("alpha", "w-3", { all: true })).toBe("/p/alpha/w/w-3?all=1");
    expect(
      hrefFor("alpha", undefined, { all: false, reason: "gate", q: "a b" }),
    ).toBe("/p/alpha?reason=gate&q=a+b");
  });
});

describe("sortRows", () => {
  const WAVES: WaveSummary[] = [
    waveSummary({ wave: "w-3" }),
    waveSummary({ wave: "w-2" }),
    waveSummary({ wave: "w-1" }),
  ];

  const order = (
    rows: readonly LaneRow[],
    waves: readonly WaveSummary[] = WAVES,
  ): string[] => sortRows(rows, waves).map((row) => `${row.wave}/${row.id}`);

  it("puts the lanes something is being asked about first", () => {
    // Two reasons in the oldest wave, none in the newest: what a reader is here
    // for wins over what is newest.
    expect(
      order([
        laneRow({ id: "a", reasons: [] }),
        laneRow({ id: "z", wave: "w-1", reasons: ["failed", "gate"] }),
      ]),
    ).toStrictEqual(["w-1/z", "w-3/a"]);
  });

  it("breaks a tie on reasons with the newest wave first", () => {
    expect(
      order([
        laneRow({ id: "b", wave: "w-1" }),
        laneRow({ id: "a", wave: "w-3" }),
        laneRow({ id: "c", wave: "w-2" }),
      ]),
    ).toStrictEqual(["w-3/a", "w-2/c", "w-1/b"]);
  });

  it("breaks a tie on the wave with the lane id, ascending", () => {
    expect(
      order([
        laneRow({ id: "wv-b", wave: "w-3" }),
        laneRow({ id: "wv-a", wave: "w-3" }),
      ]),
    ).toStrictEqual(["w-3/wv-a", "w-3/wv-b"]);
  });

  it("leaves two rows with the same id in the same wave where they were", () => {
    expect(
      order([
        laneRow({ id: "wv-a", wave: "w-3" }),
        laneRow({ id: "wv-a", wave: "w-3" }),
      ]),
    ).toStrictEqual(["w-3/wv-a", "w-3/wv-a"]);
  });

  it("puts a row whose wave the listing does not carry last", () => {
    expect(
      order([laneRow({ id: "a", wave: "w-0" }), laneRow({ id: "b" })]),
    ).toStrictEqual(["w-3/b", "w-0/a"]);
  });

  it("does not reorder the rows it was given", () => {
    const rows = [laneRow({ id: "b" }), laneRow({ id: "a" })];
    sortRows(rows, WAVES);
    expect(rows.map((row) => row.id)).toStrictEqual(["b", "a"]);
  });
});
