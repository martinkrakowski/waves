import { describe, expect, it, vi } from "vitest";

import type { AttentionView } from "../../src/application/read-model.js";
import type { ProjectCard } from "../../public/api.js";
import type { FleetHandlers, FleetModel } from "../../public/views/fleet.js";
import { phaseOf } from "../../public/views/fleet-model.js";
import { renderFleet } from "../../public/views/fleet.js";
import { rowIdOf } from "../../public/views/fleet-rows.js";

import {
  attentionLane,
  attentionView,
  NOW_ISO,
  NOW_MS,
  projectCard,
  recentWave,
  statusFacts,
} from "./fixtures.js";
import {
  assertNoInjectedMarkup,
  freshRoot,
  oneOf,
  textOf,
  textsOf,
} from "./helpers.js";

/** The handlers every draw gets: one search box, and nothing else. */
function noHandlers(): FleetHandlers {
  return { onSearch: vi.fn() };
}

/** Draws the page at `nowMs` and hands back the host it was drawn into. */
function draw(
  model: Partial<FleetModel> = {},
  nowMs: number = NOW_MS,
): HTMLElement {
  const host = freshRoot();
  const full: FleetModel = {
    projects: [projectCard()],
    attention: attentionView(),
    query: { all: false },
    open: new Set<string>(),
    ...model,
  };
  host.append(renderFleet(full, nowMs, noHandlers()));
  assertNoInjectedMarkup();
  return host;
}

/** The four stat cards, as `[term, number, caption]` triples. */
function stats(host: HTMLElement): [string, string, string][] {
  return Array.from(host.querySelectorAll(".stat")).map(
    (card) =>
      [
        textOf(card.querySelector("dt")),
        textOf(card.querySelector("dd")),
        textOf(card.querySelector(".stat-caption")),
      ] as [string, string, string],
  );
}

/** The `tab`/`q` a draw was given, as the page writes it back into a link. */
function query(
  overrides: Partial<FleetModel["query"]> = {},
): FleetModel["query"] {
  return { all: false, ...overrides };
}

const ALPHA = projectCard();
const BETA = projectCard({ id: "beta", name: "Beta" });
describe("the hero", () => {
  it("names the page, says its counts in one line, and drifts a field below", () => {
    const host = draw({
      projects: [ALPHA, BETA],
      attention: attentionView({ projects: [{ id: "alpha", attention: 3 }] }),
    });
    const hero = oneOf(host, ".fleet-hero");
    expect(hero?.tagName).toBe("HEADER");
    expect(textsOf(host, ".eyebrow")).toStrictEqual(["fleet"]);
    expect(textsOf(host, ".fleet-hero h1")).toStrictEqual([
      "Every wave, accounted for.",
    ]);
    // Two projects, nothing running, three lanes asking: the same three numbers
    // the cards below break down, counted once.
    expect(textsOf(host, ".hero-counts")).toStrictEqual([
      "2 projects · 0 waves running · 3 lanes asking for attention",
    ]);
    const field = oneOf(host, ".wave-field");
    expect(field?.getAttribute("aria-hidden")).toBe("true");
    expect(field?.getAttribute("focusable")).toBe("false");
    expect(field?.getAttribute("viewBox")).toBe("0 0 120 36");
    const paths = Array.from(field?.querySelectorAll("path") ?? []);
    expect(
      paths.map((path) => path.getAttribute("class")?.split(" ")[0]),
    ).toStrictEqual(["wave-a", "wave-b", "wave-c"]);
    for (const path of paths) {
      // Each starts before the viewBox's left edge, so the drift has something
      // to come from and never uncovers a blank strip at either end.
      expect(path.getAttribute("d")).toMatch(/^M-72 /);
      // Each carries the phase of the draw, and nothing else about the answer.
      expect(path.getAttribute("class")).toMatch(/^(wave-[abc]) phase-\d+$/);
    }
  });

  it("says each of its three counts as one and as many", () => {
    const line = (
      projects: number,
      running: number,
      asking: number,
    ): string[] => {
      const waves = Array.from({ length: running }, (_, at) =>
        recentWave({ wave: `w-${at + 1}`, state: "running" }),
      );
      return textsOf(
        draw({
          projects: Array.from({ length: projects }, (_, at) =>
            projectCard({
              id: `p${at}`,
              name: `P${at}`,
              recentWaves: at === 0 ? waves : [],
            }),
          ),
          attention: attentionView({
            projects: [{ id: "p0", attention: asking }],
          }),
        }),
        ".hero-counts",
      );
    };
    // One project, one running wave, one lane asking.
    const one = draw({
      projects: [
        projectCard({ recentWaves: [recentWave({ state: "running" })] }),
      ],
      attention: attentionView({ projects: [{ id: "alpha", attention: 1 }] }),
    });
    expect(textsOf(one, ".hero-counts")).toStrictEqual([
      "1 project · 1 wave running · 1 lane asking for attention",
    ]);
    // Many of each, and none is the singular by accident.
    expect(line(2, 1, 3)).toStrictEqual([
      "2 projects · 1 wave running · 3 lanes asking for attention",
    ]);
    // Zero reads as a count of none, which is plural: "0 lanes", never "0 lane".
    expect(line(0, 0, 0)).toStrictEqual([
      "0 projects · 0 waves running · 0 lanes asking for attention",
    ]);
  });
});

describe("the phase of an ambient animation", () => {
  /**
   * The four loops this page animates, and the period each is phased over. These
   * are the numbers in `fleet.css`'s four `animation` shorthands, and a test that
   * reads one of them and finds the duration is asserting that the two halves of
   * one constant agree.
   */
  const WAVE_A_MS = 19_000;
  const WAVE_B_MS = 27_000;
  const WAVE_C_MS = 37_000;
  const SHEEN_MS = 4_000;

  it("is one of twelve literals, over the period it is given", () => {
    expect(phaseOf(0, WAVE_C_MS)).toBe("phase-0");
    // Anywhere inside the first twelfth is the first twelfth.
    expect(phaseOf(1, WAVE_C_MS)).toBe("phase-0");
    expect(phaseOf(3_084, WAVE_C_MS)).toBe("phase-1");
    // Mid-cycle, on each of the four periods.
    expect(phaseOf(18_500, WAVE_A_MS)).toBe("phase-11");
    expect(phaseOf(18_500, WAVE_B_MS)).toBe("phase-8");
    expect(phaseOf(18_500, WAVE_C_MS)).toBe("phase-6");
    expect(phaseOf(18_500, SHEEN_MS)).toBe("phase-7");
    // Just before the wrap, and the wrap itself.
    expect(phaseOf(36_999, WAVE_C_MS)).toBe("phase-11");
    expect(phaseOf(37_000, WAVE_C_MS)).toBe("phase-0");
    // A clock below zero still names a phase: one millisecond before zero is
    // the last twelfth of the cycle before it.
    expect(phaseOf(-1, WAVE_C_MS)).toBe("phase-11");
    expect(phaseOf(-37_000, WAVE_C_MS)).toBe("phase-0");
    // And on through the clock's own larger cycles, which is what a wall clock
    // reads rather than a page's age.
    expect(phaseOf(1_000_000_000, WAVE_A_MS)).toBe("phase-6");
    for (let at = 0; at < 37_000; at += 977) {
      expect(phaseOf(at, WAVE_C_MS)).toMatch(/^phase-(?:[0-9]|1[01])$/);
      expect(phaseOf(at, SHEEN_MS)).toMatch(/^phase-(?:[0-9]|1[01])$/);
    }
  });

  it("gives each of the four loops its own phase for one moment", () => {
    const host = draw(
      {
        projects: [
          projectCard({
            recentWaves: [
              recentWave({ wave: "w-3", state: "running" }),
              recentWave({ wave: "w-2", state: "done" }),
            ],
          }),
        ],
      },
      18_500,
    );
    // One draw is one moment, but four different cycles have run for different
    // lengths by then: 18.5s is the eleventh twelfth of 19s, the ninth of 27s,
    // the seventh of 37s and the eighth of the sheen's 4s. Phasing all four over
    // one of them would leave the other three resuming somewhere else entirely.
    expect(
      Array.from(host.querySelectorAll(".wave-field path")).map((path) =>
        path.getAttribute("class"),
      ),
    ).toStrictEqual(["wave-a phase-11", "wave-b phase-8", "wave-c phase-6"]);
    expect(
      Array.from(host.querySelectorAll(".wave-bar .seg")).map((seg) =>
        seg.getAttribute("class"),
      ),
    ).toStrictEqual(["seg done", "seg running phase-7"]);
  });

  it("moves every loop on with the clock, and phases only what moves", () => {
    const projects = [
      projectCard({
        recentWaves: [
          recentWave({ wave: "w-3", state: "running" }),
          recentWave({ wave: "w-2", state: "done" }),
        ],
      }),
    ];
    // One second later the 19s wave has come back round to the start of its own
    // cycle — which is invisible, because a drift of one wavelength ends where
    // it began — and the sheen has moved two and a half twelfths on.
    const later = draw({ projects }, 19_500);
    expect(
      Array.from(later.querySelectorAll(".wave-field path")).map((path) =>
        path.getAttribute("class"),
      ),
    ).toStrictEqual(["wave-a phase-0", "wave-b phase-8", "wave-c phase-6"]);
    expect(
      Array.from(later.querySelectorAll(".wave-bar .seg")).map((seg) =>
        seg.getAttribute("class"),
      ),
    ).toStrictEqual(["seg done", "seg running phase-10"]);
  });
});

describe("the stat cards", () => {
  it("counts the fleet and says what each number is a part of", () => {
    const host = draw({
      projects: [
        projectCard({
          lanes: 6,
          stale: true,
          recentWaves: [
            recentWave({ wave: "w-3", lanes: 2, merged: 1, state: "running" }),
            recentWave({ wave: "w-2", lanes: 4, merged: 3, state: "done" }),
          ],
        }),
        projectCard({ id: "beta", name: "Beta", lanes: 4 }),
      ],
      attention: attentionView({ projects: [{ id: "alpha", attention: 2 }] }),
    });
    expect(stats(host)).toStrictEqual([
      ["Projects", "2", "1 stale"],
      ["Waves running", "1", "of 2 recent"],
      ["Lanes", "10", "4 merged in recent waves"],
      ["Need attention", "2", "asking now"],
    ]);
    expect(
      Array.from(host.querySelectorAll(".stat-icon")).map((icon) =>
        icon.getAttribute("class"),
      ),
    ).toStrictEqual(["stat-icon", "stat-icon", "stat-icon", "stat-icon"]);
    expect(host.querySelectorAll(".stat.warn")).toHaveLength(1);
    expect(
      Array.from(host.querySelectorAll(".stat")).map((card) =>
        card.getAttribute("class"),
      ),
    ).toStrictEqual(["stat", "stat", "stat", "stat warn"]);
  });

  it("counts an empty fleet as zeroes rather than hiding the cards", () => {
    expect(stats(draw({ projects: [] }))).toStrictEqual([
      ["Projects", "0", "none stale"],
      ["Waves running", "0", "of 0 recent"],
      ["Lanes", "0", "0 merged in recent waves"],
      ["Need attention", "0", "none"],
    ]);
    expect(draw({ projects: [] }).querySelectorAll(".stat.warn")).toHaveLength(
      0,
    );
  });

  it("says a warning in its caption and not only in its colour", () => {
    const asking = draw({
      attention: attentionView({ projects: [{ id: "alpha", attention: 4 }] }),
    });
    expect(
      Array.from(asking.querySelectorAll(".stat")).map((card) =>
        card.getAttribute("class"),
      ),
    ).toStrictEqual(["stat", "stat", "stat", "stat warn"]);
    expect(textsOf(asking, ".stat.warn .stat-caption")).toStrictEqual([
      "asking now",
    ]);
    // Nothing asks: the caption says so in the word as well as in the absence of
    // the warning colour.
    expect(
      Array.from(
        draw({
          attention: attentionView({
            projects: [{ id: "alpha", attention: 0 }],
          }),
        }).querySelectorAll(".stat.warn"),
      ),
    ).toStrictEqual([]);
  });
});

describe("the tabs", () => {
  const FLEET = {
    projects: [
      // Quiet: no attention, and its newest wave is settled.
      projectCard({
        id: "quiet",
        name: "Quiet",
        recentWaves: [recentWave({ wave: "w-2", state: "settled" })],
      }),
      // Active: a running wave and nothing asking.
      projectCard({
        id: "active",
        name: "Active",
        recentWaves: [recentWave({ wave: "w-3", state: "running" })],
      }),
      // Flagged: its newest wave failed.
      projectCard({
        id: "failed",
        name: "Failed",
        recentWaves: [recentWave({ wave: "w-9", state: "failed" })],
      }),
      // Flagged: asking for attention, with a running wave and no failure.
      projectCard({
        id: "asking",
        name: "Asking",
        recentWaves: [recentWave({ wave: "w-4", state: "running" })],
      }),
      // Quiet and stale: every project whose pushes have stopped is stale, and
      // staleness is not what a tab is.
      projectCard({
        id: "stale",
        name: "Stale",
        stale: true,
        recentWaves: [recentWave({ wave: "w-1", state: "settled" })],
      }),
    ],
    attention: attentionView({ projects: [{ id: "asking", attention: 1 }] }),
  };

  /** The four tabs' words and counts, in the order the nav draws them. */
  function tabbed(host: HTMLElement): [string, string][] {
    return Array.from(host.querySelectorAll(".fleet-tabs a")).map(
      (link) =>
        [textOf(link), textOf(link.nextElementSibling as Element | null)] as [
          string,
          string,
        ],
    );
  }

  it("counts each tab over the whole fleet, before the search", () => {
    expect(tabbed(draw(FLEET))).toStrictEqual([
      ["All", "5"],
      ["Active", "1"],
      ["Flagged", "2"],
      ["Quiet", "2"],
    ]);
    // The search narrows the rows and the tabs with them, and the counts stay
    // what they were: a tab's count is what it is about to show.
    const searched = draw({ ...FLEET, query: query({ q: "active" }) });
    expect(textsOf(searched, "article.project")).toHaveLength(1);
    expect(tabbed(searched)).toStrictEqual(tabbed(draw(FLEET)));
  });

  it("puts each tab in the address, carrying the search across", () => {
    const host = draw({ ...FLEET, query: query({ q: "gate" }) });
    expect(
      Array.from(host.querySelectorAll(".fleet-tabs a")).map((link) => [
        link.getAttribute("href"),
        link.getAttribute("aria-current"),
      ]),
    ).toStrictEqual([
      // No tab in the address means the whole fleet, and that is the tab the
      // reader is on.
      ["/?q=gate", "page"],
      ["/?tab=active&q=gate", null],
      ["/?tab=flagged&q=gate", null],
      ["/?tab=quiet&q=gate", null],
    ]);
    expect(
      Array.from(draw(FLEET).querySelectorAll(".fleet-tabs a")).map((link) =>
        link.getAttribute("href"),
      ),
    ).toStrictEqual(["/", "/?tab=active", "/?tab=flagged", "/?tab=quiet"]);
  });

  it("marks the tab the reader is on, and only that one", () => {
    const host = draw({ ...FLEET, query: query({ tab: "flagged" }) });
    const current = Array.from(host.querySelectorAll(".fleet-tabs a")).filter(
      (link) => link.getAttribute("aria-current") === "page",
    );
    expect(current).toHaveLength(1);
    expect(textOf(current[0] as Element)).toBe("Flagged");
    // With no tab in the address the reader is on the whole fleet.
    expect(
      draw(FLEET).querySelectorAll(".fleet-tabs a[aria-current]"),
    ).toHaveLength(1);
  });
});

describe("the tab partition", () => {
  /** One project, in one tab, with everything else as quiet as it can be. */
  function tabOf(project: Partial<ProjectCard>, asking = 0): string {
    const host = draw({
      projects: [projectCard({ id: "one", name: "One", ...project })],
      attention: attentionView({
        projects: [{ id: "one", attention: asking }],
      }),
    });
    return textOf(oneOf(host, ".dot .sr"));
  }

  it("flags a project whose newest wave failed", () => {
    expect(
      tabOf({ recentWaves: [recentWave({ wave: "w-3", state: "failed" })] }),
    ).toBe("flagged");
    // Only the newest: an older failure is a wave that has been answered since.
    expect(
      tabOf({
        recentWaves: [
          recentWave({ wave: "w-4", state: "done" }),
          recentWave({ wave: "w-3", state: "failed" }),
        ],
      }),
    ).not.toBe("flagged");
  });

  it("flags a project with a lane asking for attention", () => {
    expect(tabOf({ recentWaves: [recentWave({ state: "running" })] }, 2)).toBe(
      "flagged",
    );
    // A zero is not an attention: the view has an entry for it and says zero.
    expect(tabOf({ recentWaves: [recentWave({ state: "running" })] }, 0)).toBe(
      "active",
    );
  });

  it("calls a project with a wave running active, and the rest quiet", () => {
    expect(tabOf({ recentWaves: [recentWave({ state: "running" })] })).toBe(
      "active",
    );
    expect(
      tabOf({
        recentWaves: [
          recentWave({ wave: "w-2", state: "done" }),
          recentWave({ wave: "w-3", state: "running" }),
        ],
      }),
    ).toBe("active");
    expect(tabOf({ recentWaves: [recentWave({ state: "settled" })] })).toBe(
      "quiet",
    );
    expect(tabOf({ recentWaves: [recentWave({ state: "done" })] })).toBe(
      "quiet",
    );
    expect(tabOf({ recentWaves: [] })).toBe("quiet");
  });

  it("does not flag a project merely for being stale", () => {
    // Every project's pushes stop eventually, so a rule that read stale as
    // flagged would put the whole fleet under one tab and leave two empty.
    expect(tabOf({ stale: true, recentWaves: [recentWave()] })).not.toBe(
      "flagged",
    );
  });

  it("draws the tab's name as a word, not only as the dot's colour", () => {
    const host = draw({
      projects: [ALPHA],
      attention: attentionView({ projects: [{ id: "alpha", attention: 1 }] }),
    });
    const dot = oneOf(host, ".dot");
    expect(dot?.getAttribute("class")).toBe("dot flagged");
    expect(textsOf(host, ".dot .sr")).toStrictEqual(["flagged"]);
    // With nothing asking and nothing failed, the same row is quiet.
    expect(oneOf(draw(), ".dot")?.getAttribute("class")).toBe("dot quiet");
  });
});

describe("the rows a filter leaves", () => {
  const THREE = [
    projectCard({ id: "one", name: "One" }),
    projectCard({ id: "two", name: "Two" }),
    projectCard({ id: "three", name: "Three" }),
  ];

  it("gives one row per project, in the order the answer gave them", () => {
    const host = draw({ projects: THREE });
    expect(textsOf(host, ".row-head h3")).toStrictEqual([
      "One",
      "Two",
      "Three",
    ]);
    expect(host.querySelectorAll("article.project")).toHaveLength(3);
  });

  it("leaves only the chosen tab's rows", () => {
    const fleet = [
      projectCard({
        id: "quiet",
        name: "Quiet",
        recentWaves: [recentWave({ wave: "w-2", state: "settled" })],
      }),
      projectCard({
        id: "live",
        name: "Live",
        recentWaves: [recentWave({ wave: "w-3", state: "running" })],
      }),
    ];
    for (const tab of ["active", "flagged", "quiet"] as const) {
      const host = draw({ projects: fleet, query: query({ tab }) });
      expect(textsOf(host, ".row-head h3")).toStrictEqual(
        tab === "active" ? ["Live"] : tab === "quiet" ? ["Quiet"] : [],
      );
    }
  });

  it("searches the name, the id and the repository, in any case", () => {
    const projects = [
      // A repository that is a string is searched as one: the shape check holds
      // this field to absent-or-string, so a summary that got here has one the
      // fleet may lowercase.
      projectCard({
        id: "apollo",
        name: "Apollo",
        repo: "https://git.example.test/apollo",
      }),
      // Registered no repository at all: a search for a host name must not
      // match a project that never named one.
      projectCard({ id: "borealis", name: "Borealis", repo: undefined }),
      projectCard({ id: "cygnus", name: "Cygnus", repo: "http://g.test/c" }),
    ];
    const found = (q: string): string[] =>
      textsOf(draw({ projects, query: query({ q }) }), ".row-head h3");
    expect(found("APOLLO")).toStrictEqual(["Apollo"]);
    expect(found("bore")).toStrictEqual(["Borealis"]);
    expect(found("git.example.test")).toStrictEqual(["Apollo"]);
    expect(found("g.test")).toStrictEqual(["Cygnus"]);
    expect(found("")).toStrictEqual(["Apollo", "Borealis", "Cygnus"]);
    expect(found("nothing here")).toStrictEqual([]);
  });

  it("says an empty registry and an empty filter two different ways", () => {
    expect(
      textsOf(draw({ projects: [] }), ".fleet-projects .empty"),
    ).toStrictEqual(["No projects registered yet."]);
    expect(
      textsOf(
        draw({ projects: THREE, query: query({ q: "zzz" }) }),
        ".fleet-projects .empty",
      ),
    ).toStrictEqual(["No project matches."]);
    expect(
      textsOf(
        draw({ projects: THREE, query: query({ tab: "flagged" }) }),
        ".fleet-projects .empty",
      ),
    ).toStrictEqual(["No project matches."]);
  });
});

describe("the search box", () => {
  it("carries the key the app's own `/` and caret restore look for", () => {
    const input = oneOf(draw({ query: query({ q: "alp" }) }), "#fleet-q");
    expect(input?.getAttribute("type")).toBe("search");
    expect(input?.getAttribute("name")).toBe("q");
    expect(input?.getAttribute("data-key")).toBe("q");
    expect(input?.getAttribute("placeholder")).toBe("Filter projects");
    expect(input?.getAttribute("value")).toBe("alp");
    expect(oneOf(draw(), "#fleet-q")?.getAttribute("value")).toBe("");
    expect(oneOf(draw(), 'label[for="fleet-q"]')?.textContent).toBe("Search");
  });

  it("asks with what is in it, and not while a character is composed", () => {
    const host = freshRoot();
    const onSearch = vi.fn();
    host.append(
      renderFleet(
        {
          projects: [ALPHA],
          attention: attentionView(),
          query: query(),
          open: new Set<string>(),
        },
        NOW_MS,
        { onSearch },
      ),
    );
    const input = host.querySelector("#fleet-q") as HTMLInputElement;
    input.value = "k";
    input.dispatchEvent(
      new InputEvent("input", { bubbles: true, isComposing: true }),
    );
    expect(onSearch).not.toHaveBeenCalled();

    input.value = "か";
    input.dispatchEvent(new Event("compositionend", { bubbles: true }));
    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(onSearch).toHaveBeenLastCalledWith("か");

    input.value = "alpha";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onSearch).toHaveBeenLastCalledWith("alpha");
    // Emptied, the address carries no `q` at all.
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onSearch).toHaveBeenLastCalledWith("");
  });

  it("asks with the same text the project's own search box would", () => {
    const host = freshRoot();
    const onSearch = vi.fn();
    host.append(
      renderFleet(
        {
          projects: [ALPHA],
          attention: attentionView(),
          query: query(),
          open: new Set<string>(),
        },
        NOW_MS,
        { onSearch },
      ),
    );
    const input = host.querySelector("#fleet-q") as HTMLInputElement;
    // A control character cannot go into the address, which `parseQuery` would
    // then refuse — so the page cuts it here, as the project's box does.
    input.value = "a\tb";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onSearch).toHaveBeenLastCalledWith("ab");
  });
});

describe("a row", () => {
  /** The one project the row is drawn from, in the default fleet. */
  function row(overrides: Partial<ProjectCard> = {}): HTMLElement {
    return draw({ projects: [projectCard(overrides)] });
  }

  /** The class of the row's disclosure, or nothing when it has none. */
  function rowClass(host: HTMLElement): string | null {
    return (
      (host.querySelector("details") as HTMLElement | null)?.getAttribute(
        "class",
      ) ?? null
    );
  }

  it("keeps the name and the `repo · id` line out of the summary", () => {
    const host = row();
    const details = oneOf(host, "details") as HTMLElement;
    expect(rowClass(host)).toBe("project-row");
    expect(details.querySelector("summary a")).toBeNull();
    expect(details.querySelector("summary .row-head")).toBeNull();
    // The name is a link to the project's own page, and it is above the row.
    const name = oneOf(host, ".row-head h3 a") as HTMLElement;
    expect(textOf(name)).toBe("Alpha");
    expect(name.getAttribute("href")).toBe("/p/alpha");
    expect(name.getAttribute("data-key")).toBe("nav");
    expect(textsOf(host, ".row-id")).toStrictEqual([
      "https://git.example.test/alpha · alpha",
    ]);
    expect(oneOf(host, ".row-id code")?.textContent).toBe("alpha");
    expect(details.getAttribute("data-key")).toBeNull();
    expect(
      (oneOf(host, "summary") as HTMLElement).getAttribute("data-key"),
    ).toBe("row:alpha");
  });

  it("flags a project asking for attention, and says it as a word", () => {
    const asked = (attention: number): string[] =>
      textsOf(
        draw({
          projects: [ALPHA],
          attention: attentionView({
            projects: [{ id: "alpha", attention }],
          }),
        }),
        ".flag",
      );
    // "needs" for one and "need" for two: a flag that agrees with its number.
    expect(asked(1)).toStrictEqual(["1 needs attention"]);
    expect(asked(2)).toStrictEqual(["2 need attention"]);
    expect(asked(0)).toStrictEqual([]);
  });

  it("badges a stale project, and badges nothing on a fresh one", () => {
    expect(textsOf(row({ stale: true }), ".pill")).toStrictEqual(["stale"]);
    expect(textsOf(row(), ".pill")).toStrictEqual([]);
  });

  it("says what has been done, which wave arrived last, and when the project did", () => {
    const host = row({
      recentWaves: [
        recentWave({ wave: "w-3", state: "running" }),
        recentWave({ wave: "w-2", state: "done" }),
        recentWave({ wave: "w-1", state: "done" }),
      ],
    });
    expect(textsOf(host, ".row-caption")).toStrictEqual([
      "2/3 waves done · newest w-3 running · last push 2m ago",
    ]);
    expect(
      oneOf(host, ".row-caption")
        ?.querySelector("span[title]")
        ?.getAttribute("title"),
    ).toBe("2026-04-01T11:58:00.000Z");
  });

  it("says never when the project has pushed nothing at all", () => {
    expect(textsOf(row({ lastPush: undefined }), ".row-caption")).toStrictEqual(
      ["no recent waves · last push never"],
    );
  });

  it("is open when the app says it is, and shut when it does not", () => {
    const shut = row();
    expect((oneOf(shut, "details") as HTMLDetailsElement).open).toBe(false);
    const open = draw({
      projects: [ALPHA, BETA],
      open: new Set(["beta"]),
    });
    const rows = Array.from(
      open.querySelectorAll("details"),
    ) as HTMLDetailsElement[];
    expect(rows.map((details) => details.open)).toStrictEqual([false, true]);
  });
});

describe("a row's inbox line", () => {
  /** The one project the row is drawn from, in the default fleet. */
  function row(overrides: Partial<ProjectCard> = {}): HTMLElement {
    return draw({ projects: [projectCard(overrides)] });
  }

  it("draws the counts and an Inbox link when it has both", () => {
    const host = row({
      decisions: { waiting: 3, oneWay: 1, reported: 2, closed: 1 },
    });
    const line = oneOf(host, ".row-inbox") as HTMLElement;
    expect(textOf(line)).toBe(
      "3 waiting (1 one-way door) · 2 reported · 1 closed by a session · Inbox",
    );
    const link = oneOf(host, ".row-inbox a") as HTMLElement;
    expect(textOf(link)).toBe("Inbox");
    expect(link.getAttribute("href")).toBe("/p/alpha/inbox");
    expect(link.getAttribute("data-key")).toBe("nav");
    expect(host.querySelector("summary .row-inbox")).toBeNull();
  });

  it("draws no inbox line at all when the app has no page for the project and nothing to count", () => {
    const host = row({ id: "Not An Id" });
    expect(host.querySelectorAll(".row-inbox")).toHaveLength(0);
  });

  it("draws the counts without a link when the app has no page for the project", () => {
    const host = row({
      id: "Not An Id",
      decisions: { waiting: 3, oneWay: 1, reported: 2, closed: 1 },
    });
    const line = oneOf(host, ".row-inbox") as HTMLElement;
    expect(textOf(line)).toBe(
      "3 waiting (1 one-way door) · 2 reported · 1 closed by a session",
    );
    expect(line.querySelector("a")).toBeNull();
  });

  it("draws the Inbox link alone when the project has said no count", () => {
    const host = row({ decisions: undefined });
    expect(textsOf(host, ".row-inbox")).toStrictEqual(["Inbox"]);
    expect(textOf(oneOf(host, ".row-inbox a") as HTMLElement)).toBe("Inbox");
    expect(
      (oneOf(host, ".row-inbox a") as HTMLElement).getAttribute("href"),
    ).toBe("/p/alpha/inbox");
  });

  it("draws the Inbox link alone when all four counts are zero", () => {
    const host = row();
    expect(textsOf(host, ".row-inbox")).toStrictEqual(["Inbox"]);
    expect(textOf(oneOf(host, ".row-inbox a") as HTMLElement)).toBe("Inbox");
  });

  it("draws no inbox line at all when it has neither", () => {
    const host = row({ id: "Not An Id", decisions: undefined });
    expect(host.querySelectorAll(".row-inbox")).toHaveLength(0);
    assertNoInjectedMarkup();
  });
});

describe("the wave bar", () => {
  /** The states of a row's segments, left to right, without the phase class. */
  function segments(host: HTMLElement): string[] {
    return Array.from(host.querySelectorAll(".wave-bar .seg")).map((seg) =>
      Array.from(seg.classList)
        .filter((name) => !name.startsWith("phase-"))
        .join(" "),
    );
  }

  it("puts the oldest wave on the left and the newest on the right", () => {
    const host = draw({
      projects: [
        projectCard({
          recentWaves: [
            recentWave({ wave: "w-3", state: "running" }),
            recentWave({ wave: "w-2", state: "done" }),
            recentWave({ wave: "w-1", state: "settled" }),
          ],
        }),
      ],
    });
    expect(segments(host)).toStrictEqual([
      "seg settled",
      "seg done",
      "seg running",
    ]);
    // It is a list of waves and not a picture of them, so each segment's own
    // state is in the document as text.
    expect(oneOf(host, ".wave-bar")?.getAttribute("aria-label")).toBe(
      "Recent waves, oldest first",
    );
    expect(
      host.querySelectorAll(".wave-bar")[0]?.getAttribute("role"),
    ).toBeNull();
    expect(textsOf(host, ".wave-bar .seg .sr")).toStrictEqual([
      "w-1: settled",
      "w-2: done",
      "w-3: running",
    ]);
  });

  it("says a failed wave in its own colour, and a stale one as stale", () => {
    const host = draw({
      projects: [
        projectCard({
          recentWaves: [
            recentWave({ wave: "w-3", state: "failed", stale: true }),
            recentWave({ wave: "w-2", state: "settled" }),
          ],
        }),
      ],
    });
    expect(segments(host)).toStrictEqual(["seg settled", "seg failed stale"]);
    expect(textsOf(host, ".wave-bar .seg .sr")).toStrictEqual([
      "w-2: settled",
      "w-3: failed, stale",
    ]);
  });

  it("draws a word and no bar for a project with no retained wave", () => {
    const host = draw({ projects: [projectCard({ recentWaves: [] })] });
    expect(textsOf(host, ".bar-empty")).toStrictEqual(["no recent waves"]);
    expect(host.querySelectorAll(".wave-bar")).toHaveLength(0);
    expect(textsOf(host, ".row-caption")).toStrictEqual([
      "no recent waves · last push 2m ago",
    ]);
    expect(host.querySelectorAll(".ring")).toHaveLength(0);
  });
});

describe("the merged ring", () => {
  /** The dash the row's ring is drawn with, or nothing when it drew no ring. */
  function dash(host: HTMLElement): string | null {
    return (
      host.querySelector(".ring .value")?.getAttribute("stroke-dasharray") ??
      null
    );
  }

  /** A project whose recent waves hold the given lanes, of which so many merged. */
  function sharing(merged: number, lanes: number): Partial<ProjectCard> {
    return {
      recentWaves: [recentWave({ wave: "w-3", lanes, merged })],
    };
  }

  it("fills the share of merged lanes, and says the number beside it", () => {
    // 56.55 is the whole circle at r=9; a third of it is 18.85.
    expect(dash(draw({ projects: [projectCard(sharing(0, 3))] }))).toBe(
      "0.00 56.55",
    );
    expect(
      textsOf(draw({ projects: [projectCard(sharing(0, 3))] }), ".ring-label"),
    ).toStrictEqual(["0% merged"]);
    const twoOfThree = draw({ projects: [projectCard(sharing(2, 3))] });
    expect(dash(twoOfThree)).toBe("37.70 56.55");
    expect(textsOf(twoOfThree, ".ring-label")).toStrictEqual(["67% merged"]);
    const all = draw({ projects: [projectCard(sharing(3, 3))] });
    expect(dash(all)).toBe("56.55 56.55");
    expect(textsOf(all, ".ring-label")).toStrictEqual(["100% merged"]);
  });

  it("counts the waves the row lists, not the project's own lane total", () => {
    // The project says 90 lanes; the three waves beside the bar hold 6 of them,
    // and the ring is a share of what the reader can see.
    const host = draw({
      projects: [
        projectCard({
          lanes: 90,
          recentWaves: [
            recentWave({ wave: "w-3", lanes: 4, merged: 2 }),
            recentWave({ wave: "w-2", lanes: 2, merged: 1 }),
          ],
        }),
      ],
    });
    expect(dash(host)).toBe("28.27 56.55");
    expect(textsOf(host, ".ring-label")).toStrictEqual(["50% merged"]);
    // The lane count beside it is the project's own, which is a different number.
    expect(textsOf(host, ".lane-count")).toStrictEqual(["90 lanes"]);
  });

  it("draws no ring for waves that hold no lane between them", () => {
    // No retained wave at all.
    const empty = draw({ projects: [projectCard({ recentWaves: [] })] });
    expect(empty.querySelectorAll(".ring")).toHaveLength(0);
    expect(textsOf(empty, ".ring-label")).toStrictEqual([]);
    // Nor when the waves hold lanes but none of them merged: the share is NaN,
    // and neither number of a dash may reach the document as one.
    const nothing = draw({
      projects: [
        projectCard({
          recentWaves: [recentWave({ lanes: 0, merged: 0, state: "settled" })],
        }),
      ],
    });
    expect(nothing.querySelectorAll(".ring")).toHaveLength(0);
  });

  it("caps a share above one at a whole ring, rather than at a long arc", () => {
    // The shape check holds every wave to `merged <= lanes`, so this is a server
    // that answered a different question — and a dash longer than the circle it
    // is drawn on comes back from the browser as a second arc.
    const over = draw({ projects: [projectCard(sharing(2, 0))] });
    expect(dash(over)).toBe("56.55 56.55");
    expect(textsOf(over, ".ring-label")).toStrictEqual(["100% merged"]);

    const overOne = draw({ projects: [projectCard(sharing(7, 3))] });
    expect(dash(overOne)).toBe("56.55 56.55");
    expect(textsOf(overOne, ".ring-label")).toStrictEqual(["100% merged"]);
  });

  it("is built as an SVG out of literals, and hidden from assistive tech", () => {
    const ring = oneOf(
      draw({ projects: [projectCard(sharing(1, 3))] }),
      ".ring",
    );
    expect(ring?.tagName).toBe("svg");
    expect(ring?.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(ring?.getAttribute("aria-hidden")).toBe("true");
    const circles = Array.from(ring?.querySelectorAll("circle") ?? []);
    expect(circles).toHaveLength(2);
    expect(circles.map((one) => one.getAttribute("class"))).toStrictEqual([
      "track",
      "value",
    ]);
    for (const one of circles) {
      expect(one.getAttribute("r")).toBe("9");
      expect(one.getAttribute("cx")).toBe("12");
      expect(one.getAttribute("cy")).toBe("12");
    }
    expect(circles[0]?.getAttribute("stroke-dasharray")).toBeNull();
    expect(circles[1]?.getAttribute("transform")).toBe("rotate(-90 12 12)");
  });
});

describe("the waves inside an opened row", () => {
  /** The chips of the one row the host holds, newest first. */
  function chips(host: HTMLElement): HTMLElement[] {
    return Array.from(host.querySelectorAll(".wave-chips li"));
  }

  it("links every wave to its own page, newest first", () => {
    const host = draw({
      projects: [
        projectCard({
          recentWaves: [
            recentWave({ wave: "w-3", lanes: 2, merged: 1, state: "running" }),
            recentWave({ wave: "w-2", lanes: 3, merged: 3, state: "done" }),
          ],
        }),
      ],
    });
    expect(
      chips(host).map((chip) => textOf(chip.querySelector("a"))),
    ).toStrictEqual(["w-3", "w-2"]);
    expect(
      Array.from(host.querySelectorAll(".wave-chips a")).map((link) =>
        link.getAttribute("href"),
      ),
    ).toStrictEqual(["/p/alpha/w/w-3", "/p/alpha/w/w-2"]);
    expect(
      Array.from(host.querySelectorAll(".wave-chips .state")).map((state) => [
        state.getAttribute("class"),
        textOf(state),
      ]),
    ).toStrictEqual([
      ["state running", "running"],
      ["state done", "done"],
    ]);
    expect(textsOf(host, ".wave-chips li")[0]).toBe(
      "w-3running2 lanes · 1 mergedjust now",
    );
  });

  it("says a wave's own two counts, singular for one and plural for the rest", () => {
    const counts = (lanes: number, merged: number): string =>
      textsOf(
        draw({
          projects: [
            projectCard({
              recentWaves: [recentWave({ lanes, merged, state: "done" })],
            }),
          ],
        }),
        ".wave-chips li",
      )[0] ?? "";
    // "1 lane" and "2 lanes": the two counts beside a wave's name.
    expect(counts(1, 0)).toContain("1 lane · 0 merged");
    expect(counts(2, 0)).toContain("2 lanes · 0 merged");
    // And a row's own lane count beside them, which is a different number again.
    const laneCount = (lanes: number): string[] =>
      textsOf(draw({ projects: [projectCard({ lanes })] }), ".lane-count");
    expect(laneCount(1)).toStrictEqual(["1 lane"]);
    expect(laneCount(4)).toStrictEqual(["4 lanes"]);
  });

  it("badges a stale wave and stamps every one of them", () => {
    const host = draw({
      projects: [
        projectCard({
          recentWaves: [
            recentWave({
              wave: "w-3",
              state: "failed",
              stale: true,
              receivedAt: "2026-04-01T11:50:00.000Z",
            }),
          ],
        }),
      ],
    });
    expect(textsOf(host, ".wave-chips .badge")).toStrictEqual(["stale"]);
    expect(oneOf(host, ".wave-chips span[title]")?.getAttribute("title")).toBe(
      "2026-04-01T11:50:00.000Z",
    );
    expect(textsOf(host, ".wave-chips span[title]")).toStrictEqual(["10m ago"]);
    // Nothing stale, nothing badged.
    expect(textsOf(draw(), ".wave-chips .badge")).toStrictEqual([]);
  });

  it("draws no chips at all for a project with no wave", () => {
    const host = draw({ projects: [projectCard({ recentWaves: [] })] });
    expect(host.querySelectorAll(".wave-chips")).toHaveLength(0);
  });
});

describe("a project the app has no page for", () => {
  const BROKEN = projectCard({
    id: "Not An Id",
    name: "Spaced",
    repo: "https://git.example.test/spaced",
    lanes: 4,
    recentWaves: [
      recentWave({ wave: "w-2", lanes: 2, merged: 1, state: "done" }),
    ],
  });

  it("keeps its numbers and draws no control and no link", () => {
    const host = draw({ projects: [projectCard(), BROKEN] });
    const broken = host.querySelectorAll("article.project")[1] as HTMLElement;
    expect(broken.querySelectorAll("details")).toHaveLength(0);
    expect(broken.querySelectorAll("[data-key]")).toHaveLength(0);
    expect(broken.querySelectorAll(".wave-chips a")).toHaveLength(0);
    // The name is plain text, and the `repo · id` line says both.
    expect(textsOf(broken, ".row-head h3")).toStrictEqual(["Spaced"]);
    expect(textsOf(broken, ".row-id")).toStrictEqual([
      "https://git.example.test/spaced · Not An Id",
    ]);
    // The same bar, caption, lane count and ring a summary holds.
    const summary = oneOf(broken, ".row-summary") as HTMLElement;
    expect(textsOf(summary, ".wave-bar .seg .sr")).toStrictEqual(["w-2: done"]);
    expect(textsOf(summary, ".row-caption")).toStrictEqual([
      "1/1 waves done · newest w-2 done · last push 2m ago",
    ]);
    expect(textsOf(summary, ".lane-count")).toStrictEqual(["4 lanes"]);
    expect(textsOf(summary, ".ring-label")).toStrictEqual(["50% merged"]);
    expect(textOf(oneOf(broken, ".dot .sr"))).toBe("quiet");
  });

  it("says so in a project's place that registered no repository", () => {
    const host = draw({ projects: [projectCard({ repo: undefined })] });
    expect(textsOf(host, ".row-id")).toStrictEqual([
      "no repository registered · alpha",
    ]);
    expect(host.querySelectorAll(".row-id a")).toHaveLength(0);
  });

  it("never links a repository that is not https", () => {
    const host = draw({
      projects: [
        projectCard({ id: "http", repo: "http://git.example.test/http" }),
        projectCard({ id: "js", repo: "javascript:alert(1)" }),
      ],
    });
    expect(host.querySelectorAll(".row-id a")).toHaveLength(0);
    expect(textsOf(host, ".row-id")).toStrictEqual([
      "http://git.example.test/http · http",
      "javascript:alert(1) · js",
    ]);
  });
});

describe("the row's own status", () => {
  it("says what the project last reported, under the waves", () => {
    const host = draw({
      projects: [projectCard({ status: statusFacts() })],
    });
    expect(textsOf(host, ".row-facts dt")).toStrictEqual(["status"]);
    expect(textsOf(host, ".row-facts dd")).toStrictEqual([
      "backlog recorded · 2 PR rows unread · just now",
    ]);
    expect(oneOf(host, ".row-facts span[title]")?.getAttribute("title")).toBe(
      NOW_ISO,
    );
  });

  it("leaves the row out for a project that has pushed no status", () => {
    expect(draw().querySelectorAll(".row-facts")).toHaveLength(0);
  });

  it("says nothing reported, and counts no rows unread, at their own values", () => {
    const host = draw({
      projects: [
        projectCard({
          status: statusFacts({
            backlogState: undefined,
            prsSkipped: undefined,
          }),
        }),
        projectCard({
          id: "beta",
          name: "Beta",
          status: statusFacts({ prsSkipped: 0 }),
        }),
      ],
    });
    expect(textsOf(host, ".row-facts dd")).toStrictEqual([
      "nothing reported · just now",
      "backlog recorded · just now",
    ]);
    // And never a staleness badge: the document's own window is capped at 300 s.
    expect(
      draw({
        projects: [projectCard({ status: statusFacts({ stale: true }) })],
      }).querySelectorAll(".row-facts .badge"),
    ).toHaveLength(0);
  });
});

describe("a row's key", () => {
  it("names the project the row was drawn for", () => {
    const host = freshRoot();
    const details = document.createElement("details");
    details.setAttribute("class", "project-row");
    const summary = document.createElement("summary");
    summary.setAttribute("data-key", "row:alpha");
    details.append(summary);
    host.append(details);
    expect(rowIdOf(details)).toBe("alpha");
  });

  it("is nothing on a row this page did not key", () => {
    freshRoot();
    const keyless = document.createElement("details");
    keyless.append(document.createElement("summary"));
    expect(rowIdOf(keyless)).toBeUndefined();

    const other = document.createElement("details");
    const summary = document.createElement("summary");
    summary.setAttribute("data-key", "menu");
    other.append(summary);
    expect(rowIdOf(other)).toBeUndefined();
  });

  it("is nothing at all on a disclosure with no summary", () => {
    const host = freshRoot();
    const bare = document.createElement("details");
    host.append(bare);
    expect(rowIdOf(bare)).toBeUndefined();
  });
});

describe("the attention panel", () => {
  it("says so when no lane is asking", () => {
    const host = draw();
    expect(textsOf(host, ".fleet-attention h2")).toStrictEqual([
      "Needs attention",
    ]);
    expect(textsOf(host, ".fleet-attention .empty")).toStrictEqual([
      "Nothing needs attention.",
    ]);
    expect(host.querySelectorAll(".attention")).toHaveLength(0);
  });

  it("carries everything one lane knows, in a readable order", () => {
    const attention: AttentionView = attentionView({
      lanes: [
        attentionLane({
          lane: "wv-c",
          reasons: ["failed", "gate"],
          seat: "s1",
          stale: true,
          pr: 42,
          receivedAt: "2026-04-01T11:50:00.000Z",
        }),
      ],
    });
    const row = oneOf(draw({ attention }), ".attention li");
    expect(textsOf(row as Element, "a")).toStrictEqual(["wv-c"]);
    expect(textsOf(row as Element, ".where code")).toStrictEqual([
      "alpha",
      "w-3",
    ]);
    expect(textsOf(row as Element, ".badge")).toStrictEqual([
      "failed",
      "gate",
      "stale",
    ]);
    expect(textsOf(row as Element, ".seat")).toStrictEqual(["s1"]);
    expect(textsOf(row as Element, ".pr")).toStrictEqual(["PR #42"]);
    expect(textsOf(row as Element, "span[title]")).toStrictEqual(["10m ago"]);
  });

  it("leaves out everything a lane did not report", () => {
    const row = oneOf(
      draw({
        attention: attentionView({
          lanes: [attentionLane({ reasons: ["silent"] })],
        }),
      }),
      ".attention li",
    );
    expect(textsOf(row as Element, ".badge")).toStrictEqual(["silent"]);
    expect(row?.querySelectorAll(".seat")).toHaveLength(0);
    expect(row?.querySelectorAll(".pr")).toHaveLength(0);
    expect(row?.querySelectorAll(".badge.stale")).toHaveLength(0);
  });

  it("labels no-pr as 'no PR' on its attention badge", () => {
    const row = oneOf(
      draw({
        attention: attentionView({
          lanes: [attentionLane({ reasons: ["no-pr"] })],
        }),
      }),
      ".attention li",
    );
    expect(textsOf(row as Element, ".badge")).toStrictEqual(["no PR"]);
  });

  it("links a lane to its own page, with the lane chosen and nothing else", () => {
    const host = draw({
      attention: attentionView({ lanes: [attentionLane()] }),
    });
    const anchor = oneOf(host, ".attention a");
    expect(anchor?.getAttribute("href")).toBe("/p/alpha/w/w-3?lane=wv-a");
    expect(anchor?.getAttribute("data-key")).toBe("nav");
  });

  it("lists the lanes in the order the view was given them", () => {
    const host = draw({
      attention: attentionView({
        lanes: [
          attentionLane({ lane: "wv-c" }),
          attentionLane({ lane: "wv-a" }),
          attentionLane({ lane: "wv-b", project: "beta", wave: "b-3" }),
        ],
      }),
    });
    expect(textsOf(host, ".attention a")).toStrictEqual([
      "wv-c",
      "wv-a",
      "wv-b",
    ]);
  });

  it("says the list was cut only when it was", () => {
    expect(draw().querySelectorAll(".note-inline")).toHaveLength(0);
    expect(
      textsOf(
        draw({ attention: attentionView({ truncated: true }) }),
        ".note-inline",
      ),
    ).toStrictEqual(["Showing the newest 200. More lanes matched."]);
  });
});

describe("the page around them", () => {
  it("is one view, read hero, cards, then the two columns", () => {
    const host = draw({
      attention: attentionView({ lanes: [attentionLane()] }),
    });
    const view = oneOf(host, "section.view");
    expect(view?.getAttribute("class")).toBe("view fleet");
    expect(
      Array.from(view?.children ?? []).map((child) =>
        child.getAttribute("class"),
      ),
    ).toStrictEqual(["fleet-hero", "stats", "fleet-grid"]);
    expect(
      Array.from(host.querySelectorAll(".fleet-grid > section")).map(
        (section) => section.getAttribute("class"),
      ),
    ).toStrictEqual(["fleet-projects", "fleet-attention"]);
    expect(
      textsOf(host, ".fleet-projects > h2, .fleet-attention > h2"),
    ).toStrictEqual(["Projects", "Needs attention"]);
  });
});
