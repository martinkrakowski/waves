import { describe, expect, it } from "vitest";

import {
  hrefFor,
  pathFor,
  scopeOf,
  sortRows,
} from "../../public/views/project.js";

import type { LaneRow, WaveSummary } from "../../src/application/read-model.js";
import {
  laneRow,
  NOW_ISO,
  NOW_MS,
  projectLanes,
  waveSummary,
} from "./fixtures.js";
import { oneOf, renderProjectView, textsOf } from "./helpers.js";

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
      "/p/alpha?reason=gate&lane=wv-b&all=1",
      "/p/alpha/w/w-3?reason=gate&lane=wv-b&all=1",
      "/p/alpha/w/w-2?reason=gate&lane=wv-b&all=1",
      "/p/alpha/w/w-1?reason=gate&lane=wv-b&all=1",
      "/p/alpha/w/w-2?reason=gate&lane=wv-b",
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
