import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import type { DrawerHandlers, DrawerModel } from "../../public/views/drawer.js";
import { prUrl, renderDrawer } from "../../public/views/drawer.js";

import type { LaneView } from "../../src/application/read-model.js";
import { envelope, lane, NOW_MS, waveView } from "./fixtures.js";
import {
  assertNoInjectedMarkup,
  freshRoot,
  oneOf,
  textOf,
  textsOf,
} from "./helpers.js";

/** This file's own directory, for the two stylesheets read at the end. */
const HERE = dirname(fileURLToPath(import.meta.url));

const REPO = "https://github.com/acme/waves";
const PULL = "https://github.com/acme/waves/pull/42";

function model(overrides: Partial<DrawerModel> = {}): DrawerModel {
  return {
    state: "ready",
    project: "alpha",
    repo: REPO,
    wave: "w-3",
    lane: "wv-a",
    reasons: [],
    view: waveView(),
    ...overrides,
  };
}

/** Draws the drawer, asserts the markup invariants, and hands back the drawer. */
function draw(
  overrides: Partial<DrawerModel> = {},
  handlers: DrawerHandlers = { onClose() {} },
): HTMLElement {
  const host = freshRoot();
  host.append(renderDrawer(model(overrides), NOW_MS, handlers));
  assertNoInjectedMarkup();
  const drawer = oneOf(host, ".drawer");
  expect(drawer).not.toBeNull();
  // `append` turns a list into a string, so a view that handed one to `children`
  // would draw its markup rather than its nodes.
  expect(textOf(drawer)).not.toContain("HTMLD");
  return drawer as HTMLElement;
}

/** One wave holding exactly the lanes a test wants to draw. */
function viewWith(lanes: readonly LaneView[]) {
  return waveView({ envelope: envelope({ lanes }) });
}

/** One section by its heading, so a test names what it is looking at. */
function sectionOf(drawer: HTMLElement, heading: string): HTMLElement {
  const found = Array.from(drawer.querySelectorAll("section")).find(
    (entry) => textOf(entry.querySelector("h3")) === heading,
  );
  expect(found).toBeDefined();
  return found as HTMLElement;
}

/** A `dl`'s terms, each with what the drawer says for it. */
function terms(drawer: HTMLElement): [string, string][] {
  return Array.from(drawer.querySelectorAll("dl"), (list) =>
    Array.from(list.children)
      .filter((child) => child.tagName === "DT")
      .map(
        (term) =>
          [textOf(term), textOf(term.nextElementSibling)] as [string, string],
      ),
  ).flat();
}

/** What the drawer drew, one entry per child: its heading, or its own class. */
function outline(drawer: HTMLElement): string[] {
  return Array.from(drawer.children, (child) => {
    const heading = textOf(child.querySelector("h3"));
    const own = child.getAttribute("class") ?? "";
    return heading === "" ? `${child.tagName}.${own}` : heading;
  });
}

/** Every row of the comparison table, as `[label, reported, derived]`. */
function rows(drawer: HTMLElement): [string, string, string][] {
  return Array.from(drawer.querySelectorAll("tbody tr"), (entry) => {
    const cells = entry.querySelectorAll("td");
    return [
      textOf(entry.querySelector("th")),
      textOf(cells.item(0)),
      textOf(cells.item(1)),
    ];
  });
}

/** One row of the comparison table. */
function row(drawer: HTMLElement, label: string): [string, string, string] {
  const found = rows(drawer).find((entry) => entry[0] === label);
  expect(found).toBeDefined();
  return found as [string, string, string];
}

describe("prUrl", () => {
  it("builds the address of a pull request from the two segments", () => {
    expect(prUrl(REPO, 42)).toBe(PULL);
    expect(prUrl("https://github.com/acme/waves/", 42)).toBe(PULL);
    expect(prUrl("https://github.com/a.b/c_d.e", 7)).toBe(
      "https://github.com/a.b/c_d.e/pull/7",
    );
  });

  it("refuses any repository that is not two segments on github.com", () => {
    for (const repo of [
      "http://github.com/acme/waves",
      "https://git.example.test/acme/waves",
      "https://agithub.com/acme/waves",
      "https://github.com.evil.example/acme/waves",
      "https://user:pass@github.com/acme/waves",
      "https://github.com/acme",
      "https://github.com/acme/waves/extra",
      "https://github.com/acme/waves.git",
      "https://github.com/acme/waves?tab=readme",
      "https://github.com/acme/waves#readme",
      "javascript:alert(1)",
      undefined,
    ]) {
      expect(prUrl(repo, 42)).toBeUndefined();
    }
  });

  it("refuses a repository segment outside github's own alphabet", () => {
    // `URL` writes the quote as `%22`, so that path is one segment holding a
    // percent-escape: no repository name, and no way to carry a quote into the
    // address of a link.
    expect(prUrl('https://github.com/a/b"onclick="x', 42)).toBeUndefined();
    expect(prUrl("https://github.com/a%22b/c", 42)).toBeUndefined();
  });

  it("refuses a number that is not a positive integer", () => {
    for (const number of [0, -1, 1.5, Number.NaN, "12", undefined]) {
      expect(prUrl(REPO, number)).toBeUndefined();
    }
  });
});

describe("the drawer's frame", () => {
  it("names the lane, the wave, and the one control that closes it", () => {
    const drawer = draw();
    const title = oneOf(drawer, "#drawer-title");
    expect(title?.tagName).toBe("H2");
    expect(textOf(title)).toBe("wv-a");
    expect(textsOf(drawer, "header code")).toStrictEqual(["w-3"]);
    const close = oneOf(drawer, '[data-key="close"]');
    expect(close?.tagName).toBe("BUTTON");
    expect(close?.getAttribute("type")).toBe("button");
    expect(close?.getAttribute("class")).toBe("close");
    expect(textOf(close)).toBe("Close");
  });

  it("calls the handler once per click on Close", () => {
    const onClose = vi.fn();
    const drawer = draw({ state: "loading" }, { onClose });
    const close = oneOf(drawer, '[data-key="close"]');
    expect(close).not.toBeNull();
    (close as HTMLElement).click();
    (close as HTMLElement).click();
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe("the drawer before it has anything to draw", () => {
  it("says which of the four it is", () => {
    expect(textsOf(draw({ state: "loading" }), "p.panel-empty")).toStrictEqual([
      "Loading…",
    ]);
    expect(textsOf(draw({ state: "failed" }), "p.panel-empty")).toStrictEqual([
      "This lane could not be read. Close and open it again to retry.",
    ]);
    expect(textsOf(draw({ state: "gone" }), "p.panel-empty")).toStrictEqual([
      "This wave is no longer held by the service.",
    ]);
    expect(textsOf(draw({ state: "missing" }), "p.panel-empty")).toStrictEqual([
      "This wave holds no lane with this id.",
    ]);
  });

  it("draws a heading for no section at all", () => {
    expect(outline(draw({ state: "loading" }))).toStrictEqual([
      "HEADER.",
      "P.panel-empty",
    ]);
  });
});

describe("the seat line", () => {
  it("names the seat the lane pushed, or says none was", () => {
    expect(textsOf(draw(), "p.meta span")).toStrictEqual(["s1"]);
    const bare = draw({ view: viewWith([lane({ seat: undefined })]) });
    expect(textsOf(bare, "p.meta span")).toStrictEqual(["no seat recorded"]);
  });

  it("marks the wave stale when the wave is, and the same words as the strip", () => {
    const drawer = draw({ view: waveView({ stale: true }) });
    expect(textsOf(drawer, "p.meta span.badge")).toStrictEqual(["stale"]);
    expect(oneOf(drawer, "p.meta span.badge")?.getAttribute("class")).toBe(
      "badge stale",
    );
    expect(draw().querySelectorAll("p.meta span.badge")).toHaveLength(0);
  });
});

describe("the reasons", () => {
  it("are badges in the table's own classes, when the listing named any", () => {
    const drawer = draw({ reasons: ["gate", "stale"] });
    const section = sectionOf(drawer, "Needs attention");
    expect(textsOf(section, ".badge")).toStrictEqual(["gate", "stale"]);
    expect(
      Array.from(section.querySelectorAll(".badge"), (badge) =>
        badge.getAttribute("class"),
      ),
    ).toStrictEqual(["badge reason", "badge reason"]);
  });

  it("are left out entirely when the row is not in the listing", () => {
    expect(outline(draw({ reasons: [] }))).not.toContain("Needs attention");
  });
});

describe("the disagreements", () => {
  it("are every one of them, one to a line", () => {
    const drawer = draw({
      view: viewWith([
        lane({ disagreements: ["seat 1 says pass", "gate says fail"] }),
      ]),
    });
    const section = sectionOf(drawer, "Disagreements");
    expect(textsOf(section, "li")).toStrictEqual([
      "seat 1 says pass",
      "gate says fail",
    ]);
  });

  it("say so in a line of their own when there are none", () => {
    const drawer = draw({ view: viewWith([lane({ disagreements: [] })]) });
    expect(
      textsOf(sectionOf(drawer, "Disagreements"), "p.panel-empty"),
    ).toStrictEqual(["Reported and derived agree."]);
  });
});

describe("reported beside derived", () => {
  it("puts every fact in a row, with the reported half beside the derived", () => {
    expect(rows(draw())).toStrictEqual([
      ["Stage", "review · settled · round 2 · PR #42", "—"],
      ["Reported at", "just now", "received just now"],
      ["Alive", "—", "running"],
      ["Exit", "—", "0"],
      ["PR", "#42", "#42 open · checks pass · 1 open thread"],
      ["Gate", "—", "exit 0 · 98% stmts · 91.5% br · 100% funcs · 99% lines"],
    ]);
    expect(textsOf(draw(), "thead th")).toStrictEqual([
      "",
      "Reported",
      "Derived",
    ]);
    expect(
      Array.from(draw().querySelectorAll("tbody th"), (cell) =>
        cell.getAttribute("scope"),
      ),
    ).toStrictEqual(["row", "row", "row", "row", "row", "row"]);
  });

  it("says nothing was reported for a lane that reported nothing", () => {
    const drawer = draw({ view: viewWith([lane({ reported: undefined })]) });
    expect(rows(drawer)).toStrictEqual([
      ["Stage", "nothing reported", "—"],
      ["Reported at", "—", "received just now"],
      ["Alive", "—", "running"],
      ["Exit", "—", "0"],
      ["PR", "—", "#42 open · checks pass · 1 open thread"],
      ["Gate", "—", "exit 0 · 98% stmts · 91.5% br · 100% funcs · 99% lines"],
    ]);
  });

  it("takes the three liveness words from the same helper the table uses", () => {
    for (const [alive, label] of [
      [true, "running"],
      [false, "stopped"],
      ["unknown", "unknown"],
    ] as const) {
      const drawer = draw({ view: viewWith([lane({ derived: { alive } })]) });
      expect(row(drawer, "Alive")[2]).toBe(label);
    }
  });

  it("leaves an exit, a pull request and a gate out when there is none", () => {
    const drawer = draw({
      view: viewWith([
        lane({
          reported: { stage: "build", event: "started", ts: NOW_MS.toString() },
          derived: { alive: true },
        }),
      ]),
    });
    expect(row(drawer, "Exit")[2]).toBe("—");
    expect(row(drawer, "PR")).toStrictEqual(["PR", "—", "—"]);
    expect(row(drawer, "Gate")[2]).toBe("—");
  });

  it("says what a gate that reported only an exit said", () => {
    const drawer = draw({
      view: viewWith([lane({ derived: { alive: true, gate: { exit: 3 } } })]),
    });
    expect(row(drawer, "Gate")[2]).toBe("exit 3");
  });

  it("counts the threads the way the table does", () => {
    const drawer = draw({
      view: viewWith([
        lane({
          derived: {
            alive: true,
            pr: {
              number: 8,
              state: "merged",
              checks: "none",
              unresolvedThreads: "unknown",
            },
          },
        }),
      ]),
    });
    expect(row(drawer, "PR")[2]).toBe(
      "#8 merged · checks none · threads unknown",
    );
  });
});

describe("the pull request link", () => {
  it("points at the pull request on the repository the project registered", () => {
    const link = oneOf(draw(), "p a");
    expect(link?.tagName).toBe("A");
    expect(link?.getAttribute("href")).toBe(PULL);
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(textOf(link)).toBe("Pull request #42 on GitHub");
  });

  it("falls back to the reported number when nothing was derived", () => {
    const drawer = draw({
      view: viewWith([
        lane({
          reported: {
            stage: "review",
            event: "settled",
            ts: NOW_MS.toString(),
            pr: 12,
          },
          derived: { alive: true },
        }),
      ]),
    });
    const link = oneOf(drawer, "p a");
    expect(link?.getAttribute("href")).toBe(
      "https://github.com/acme/waves/pull/12",
    );
    expect(textOf(link)).toBe("Pull request #12 on GitHub");
  });

  it("is no link for a repository that is not github, or with no number", () => {
    expect(oneOf(draw({ repo: "https://evil.example/a/b" }), "p a")).toBeNull();
    expect(oneOf(draw({ repo: undefined }), "p a")).toBeNull();
    const bare = draw({
      view: viewWith([lane({ reported: undefined, derived: { alive: true } })]),
    });
    expect(oneOf(bare, "p a")).toBeNull();
  });
});

describe("the summary", () => {
  it("names what the last push derived and the log it read", () => {
    expect(terms(sectionOf(draw(), "Summary"))).toStrictEqual([
      ["Diff", "3 files · +120 −14"],
      ["Log", "4096 bytes just now"],
      ["Plan review", "two approvals"],
      ["Risk", "low"],
    ]);
  });

  it("writes only the bytes when the log's own time cannot be read", () => {
    const drawer = draw({
      view: viewWith([
        lane({
          derived: {
            alive: true,
            log: { bytes: 4096, mtimeMs: Number.NaN, tail: "gate ok" },
          },
        }),
      ]),
    });
    expect(terms(sectionOf(drawer, "Summary"))).toStrictEqual([
      ["Log", "4096 bytes "],
    ]);
  });

  it("is left out entirely when nothing at all was derived", () => {
    const drawer = draw({
      view: viewWith([lane({ derived: { alive: true } })]),
    });
    expect(outline(drawer)).not.toContain("Summary");
  });
});

describe("the reported detail", () => {
  it("is a term per key, in the order the pusher wrote them", () => {
    const drawer = draw({
      view: viewWith([
        lane({
          reported: {
            stage: "review",
            event: "settled",
            ts: NOW_MS.toString(),
            detail: { verdict: "ship it", count: 3, ok: true, missing: null },
          },
        }),
      ]),
    });
    expect(terms(sectionOf(drawer, "Reported detail"))).toStrictEqual([
      ["verdict", "ship it"],
      ["count", "3"],
      ["ok", "true"],
      ["missing", "null"],
    ]);
  });

  it("is left out when there is no detail, and when it has no own key", () => {
    expect(
      outline(draw({ view: viewWith([lane({ reported: undefined })]) })),
    ).not.toContain("Reported detail");
    const empty = draw({
      view: viewWith([
        lane({
          reported: {
            stage: "review",
            event: "settled",
            ts: NOW_MS.toString(),
            detail: {},
          },
        }),
      ]),
    });
    expect(outline(empty)).not.toContain("Reported detail");
  });

  it("throws on a detail the service could not have stored", () => {
    expect(() =>
      draw({
        view: viewWith([
          lane({
            reported: {
              stage: "review",
              event: "settled",
              ts: NOW_MS.toString(),
              detail: null as unknown as Record<string, unknown>,
            },
          }),
        ]),
      }),
    ).toThrow(TypeError);
  });
});

describe("the log tail", () => {
  it("is the tail itself, in a pre of its own", () => {
    const tail = oneOf(draw(), "pre");
    expect(textOf(tail)).toBe("gate ok\ntests ok");
  });

  it("says so in a line of its own when no tail was pushed", () => {
    const drawer = draw({
      view: viewWith([
        lane({ derived: { alive: true, log: { bytes: 12, mtimeMs: NOW_MS } } }),
      ]),
    });
    expect(
      textsOf(sectionOf(drawer, "Log tail"), "p.panel-empty"),
    ).toStrictEqual(["No log tail was pushed."]);
    expect(drawer.querySelectorAll("pre")).toHaveLength(0);
  });
});

describe("what the drawer draws, in order", () => {
  it("leads with the lane, then its reasons, and ends with the tail", () => {
    // The seat line carries the page's own name for a seat, so `drawer.css` can
    // draw it in mono under `.lane-drawer` without reaching the project page's.
    expect(outline(draw({ reasons: ["gate"] }))).toStrictEqual([
      "HEADER.",
      "P.meta seat",
      "Needs attention",
      "Disagreements",
      "Reported and derived",
      "P.",
      "Summary",
      "Reported detail",
      "Log tail",
    ]);
  });
});

/**
 * The two rules of the sheet that no test of the drawn nodes can see: the glass
 * the dialog itself is made of, and where the entrance is hung. Both are read out
 * of the stylesheet, as `shell.test.ts` reads the shell's own.
 */
describe("the drawer as it is styled", () => {
  const SHEET = readFileSync(
    join(HERE, "..", "..", "public", "drawer.css"),
    "utf8",
  );
  const TOKENS = readFileSync(
    join(HERE, "..", "..", "public", "tokens.css"),
    "utf8",
  );

  it("slides the dialog in when it opens, and nothing inside it", () => {
    // `app.js` keeps one dialog and replaces only its children, so an animation
    // keyed to `[open]` runs once per `showModal()` and an animation on anything
    // below the dialog would replay on every ten-second refresh.
    expect(SHEET).toMatch(
      /dialog\.lane-drawer\[open\]\s*\{[^}]*animation:\s*waves-slide-in/,
    );
    expect(SHEET).toMatch(/@keyframes\s+waves-slide-in\s*\{/);
    expect(SHEET.match(/animation:/g)).toHaveLength(1);
  });

  it("holds still under prefers-reduced-motion, in the one rule the page shares", () => {
    // One global rule stops every animation, which is how the shell's own keyframes
    // are held still, and the sheet's single animation sits under it with the rest
    // of the page rather than beside it in a rule of its own to drift from it.
    expect(TOKENS).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^}]*animation:\s*none/,
    );
    expect(SHEET.match(/animation:/g)).toHaveLength(1);
  });

  it("draws the disagreements in rose and leaves the fact pairs alone", () => {
    expect(SHEET).toMatch(
      /\.lane-drawer\s+\.disagreements\s+li\s*\{[^}]*color:\s*var\(--rose\)/,
    );
    expect(SHEET).not.toMatch(/\.drawer\s+tbody\s+td\s*\{[^}]*color:/);
  });

  it("scopes the seat to the dialog, which the project page also draws", () => {
    expect(SHEET).toMatch(
      /\.lane-drawer\s+\.seat\s*\{[^}]*font-family:\s*var\(--mono\)/,
    );
    expect(SHEET).not.toMatch(/^\.seat\s*\{/m);
  });
});
