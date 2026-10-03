import { describe, expect, it } from "vitest";

import type { AttentionView } from "../../src/application/read-model.js";
import type { ProjectCard } from "../../public/api.js";
import type { FleetModel } from "../../public/views/fleet.js";
import { renderFleet } from "../../public/views/fleet.js";

import {
  attentionLane,
  attentionView,
  NOW_ISO,
  NOW_MS,
  projectCard,
  statusFacts,
} from "./fixtures.js";
import {
  assertNoInjectedMarkup,
  freshRoot,
  oneOf,
  textOf,
  textsOf,
} from "./helpers.js";

/** Draws the page and hands back the host it was drawn into. */
function draw(model: Partial<FleetModel> = {}): HTMLElement {
  const host = freshRoot();
  const full: FleetModel = {
    projects: [projectCard()],
    attention: attentionView(),
    ...model,
  };
  host.append(renderFleet(full, NOW_MS));
  assertNoInjectedMarkup();
  return host;
}

/** The five counters, in order, as `[term, value]` pairs. */
function counters(host: HTMLElement): [string, string][] {
  return Array.from(host.querySelectorAll(".kpi")).map(
    (kpi) =>
      [textOf(kpi.querySelector("dt")), textOf(kpi.querySelector("dd"))] as [
        string,
        string,
      ],
  );
}

const ALPHA = projectCard();

describe("the fleet page's counters", () => {
  it("counts the projects, and sums their waves and lanes", () => {
    const host = draw({
      projects: [
        ALPHA,
        projectCard({ id: "beta", name: "Beta", waves: 1, lanes: 0 }),
      ],
    });
    expect(counters(host)).toStrictEqual([
      ["Projects", "2"],
      ["Waves", "4"],
      ["Lanes", "6"],
      ["Need attention", "0"],
      ["Stale projects", "0"],
    ]);
    expect(host.querySelectorAll(".kpi.warn")).toHaveLength(0);
  });

  it("counts an empty fleet as zeroes rather than hiding the row", () => {
    expect(counters(draw({ projects: [] }))).toStrictEqual([
      ["Projects", "0"],
      ["Waves", "0"],
      ["Lanes", "0"],
      ["Need attention", "0"],
      ["Stale projects", "0"],
    ]);
  });

  it("warns when something is asking for attention, and only then", () => {
    const host = draw({
      attention: attentionView({
        projects: [
          { id: "alpha", attention: 2 },
          { id: "beta", attention: 0 },
        ],
      }),
    });
    expect(textsOf(host, ".kpi dd")).toContain("2");
    const asking = Array.from(host.querySelectorAll(".kpi")).find(
      (kpi) => textOf(kpi.querySelector("dt")) === "Need attention",
    );
    expect(asking?.getAttribute("class")).toBe("kpi warn");
    expect(asking?.querySelectorAll(".warn")).toHaveLength(0);

    const quiet = Array.from(
      draw({
        attention: attentionView({ projects: [{ id: "alpha", attention: 0 }] }),
      }).querySelectorAll(".kpi"),
    ).find((kpi) => textOf(kpi.querySelector("dt")) === "Need attention");
    expect(quiet?.getAttribute("class")).toBe("kpi");
  });

  it("warns when a project is stale, and only then", () => {
    const host = draw({
      projects: [ALPHA, projectCard({ id: "beta", name: "Beta", stale: true })],
    });
    const stale = Array.from(host.querySelectorAll(".kpi")).find(
      (kpi) => textOf(kpi.querySelector("dt")) === "Stale projects",
    );
    expect(textOf(stale?.querySelector("dd") ?? null)).toBe("1");
    expect(stale?.getAttribute("class")).toBe("kpi warn");

    expect(
      Array.from(draw().querySelectorAll(".kpi"))
        .find((kpi) => textOf(kpi.querySelector("dt")) === "Stale projects")
        ?.getAttribute("class"),
    ).toBe("kpi");
  });
});

describe("the projects panel", () => {
  it("says so when nothing is registered", () => {
    const host = draw({ projects: [] });
    expect(textsOf(host, ".fleet-projects h2")).toStrictEqual(["Projects"]);
    expect(textsOf(host, ".fleet-projects .empty")).toStrictEqual([
      "No projects registered yet.",
    ]);
    expect(host.querySelectorAll(".project-card")).toHaveLength(0);
  });

  it("gives one card per project, in the order given", () => {
    const host = draw({
      projects: [
        ALPHA,
        projectCard({ id: "beta", name: "Beta" }),
        projectCard({ id: "gamma", name: "Gamma" }),
      ],
    });
    expect(textsOf(host, ".project-card h3 a")).toStrictEqual([
      "Alpha",
      "Beta",
      "Gamma",
    ]);
  });

  it("gives a card every fact, in the order the eye reads them", () => {
    const host = draw({
      projects: [
        projectCard({
          id: "beta",
          name: "Beta",
          repo: "https://git.example.test/beta",
          waves: 1,
          lanes: 2,
        }),
      ],
    });
    const card = oneOf(host, ".project-card");
    expect(textsOf(card as Element, "dt")).toStrictEqual([
      "id",
      "repo",
      "waves",
      "lanes",
      "last push",
      "attention",
    ]);
    expect(textsOf(card as Element, "dd")).toStrictEqual([
      "beta",
      "https://git.example.test/beta",
      "1 wave",
      "2",
      "2m ago",
      "0",
    ]);
    // dt and dd are direct children of the dl, so the grid is the whole layout.
    const facts = oneOf(card as Element, ".facts");
    expect(
      Array.from(facts?.children ?? []).map((child) => child.tagName),
    ).toStrictEqual([
      "DT",
      "DD",
      "DT",
      "DD",
      "DT",
      "DD",
      "DT",
      "DD",
      "DT",
      "DD",
      "DT",
      "DD",
    ]);
  });

  it("links a project whose id the app owns, and never one it does not", () => {
    const host = draw({
      projects: [ALPHA, projectCard({ id: "Not An Id", name: "Spaced" })],
    });
    expect(textsOf(host, ".project-card h3 a")).toStrictEqual(["Alpha"]);
    const unlinked = host.querySelectorAll(".project-card")[1] as HTMLElement;
    const name = unlinked.querySelector("h3")?.firstChild as HTMLElement;
    expect(name.tagName).toBe("SPAN");
    expect(textOf(name)).toBe("Spaced");
    expect(unlinked.querySelector("h3")?.childElementCount).toBe(2);
    expect(textsOf(unlinked, ".facts dd")[0]).toBe("Not An Id");
  });

  it("links the repository only when it is https, and says so when there is none", () => {
    const host = draw({
      projects: [
        projectCard({ id: "http", repo: "http://git.example.test/http" }),
        projectCard({ id: "js", repo: "javascript:alert(1)" }),
        projectCard({ id: "none", repo: undefined }),
      ],
    });
    expect(textsOf(host, ".facts a")).toStrictEqual([]);
    // Six facts per card, and the repository is the second of them.
    const values = textsOf(host, ".facts dd");
    expect(values.filter((_, at) => at % 6 === 1)).toStrictEqual([
      "http://git.example.test/http",
      "javascript:alert(1)",
      "no repository registered",
    ]);

    const withHttps = draw();
    expect(textsOf(withHttps, ".project-card a")).toStrictEqual([
      "Alpha",
      "https://git.example.test/alpha",
    ]);
    expect(withHttps.querySelector(".facts a")?.getAttribute("href")).toBe(
      "https://git.example.test/alpha",
    );
  });

  it("puts the exact push time in the title of the relative one", () => {
    const host = draw({
      projects: [projectCard({ lastPush: "2026-04-01T11:58:00.000Z" })],
    });
    const stamp = oneOf(host, ".facts dd span[title]");
    expect(textOf(stamp)).toBe("2m ago");
    expect(stamp?.getAttribute("title")).toBe("2026-04-01T11:58:00.000Z");
  });

  it("says never when the project has pushed nothing", () => {
    const host = draw({
      projects: [projectCard({ waves: 0, lastPush: undefined })],
    });
    expect(textsOf(host, ".facts dd")[4]).toBe("never");
  });

  it("badges a project stale or fresh, and a project with no waves is fresh", () => {
    const host = draw({
      projects: [
        ALPHA,
        projectCard({ id: "beta", name: "Beta", stale: true }),
        projectCard({ id: "gamma", name: "Gamma", waves: 0, stale: false }),
      ],
    });
    expect(textsOf(host, ".pill")).toStrictEqual(["fresh", "stale", "fresh"]);
    expect(
      Array.from(host.querySelectorAll(".pill")).map((pill) =>
        pill.getAttribute("class"),
      ),
    ).toStrictEqual(["pill fresh", "pill stale", "pill fresh"]);
  });

  it("shows a project's own attention count, and zeroes one with no entry", () => {
    const host = draw({
      projects: [ALPHA, projectCard({ id: "beta", name: "Beta" })],
      attention: attentionView({
        projects: [{ id: "alpha", attention: 4 }],
      }),
    });
    const first = host.querySelectorAll(".project-card")[0] as HTMLElement;
    const second = host.querySelectorAll(".project-card")[1] as HTMLElement;
    // Alpha is the only project the view has a count for; Beta has none.
    expect(textsOf(first as Element, ".facts dd")[5]).toBe("4");
    expect(textsOf(second, ".facts dd")[5]).toBe("0");
  });
});

describe("a card's status row", () => {
  /** The terms and values of the row the card drew for a project. */
  function statusRow(
    overrides: Partial<NonNullable<ProjectCard["status"]>> = {},
  ): { terms: string[]; value: string; title: string | null } {
    const host = draw({
      projects: [projectCard({ status: statusFacts(overrides) })],
    });
    const dd = host.querySelectorAll(".facts dd");
    const row = dd[dd.length - 1] as HTMLElement;
    return {
      terms: textsOf(host, ".facts dt"),
      value: textOf(row),
      title: row.querySelector("span[title]")?.getAttribute("title") ?? null,
    };
  }

  it("leaves the row out entirely for a project with no status", () => {
    const host = draw({ projects: [ALPHA] });

    expect(textsOf(host, ".facts dt")).not.toContain("status");
    expect(textsOf(host, ".facts dd")).toHaveLength(6);
  });

  it("says the backlog state, the unread rows and when it arrived", () => {
    const row = statusRow();

    expect(row.terms.at(-1)).toBe("status");
    expect(row.value).toBe("backlog recorded · 2 PR rows unread · just now");
    expect(row.title).toBe(NOW_ISO);
  });

  it("says nothing reported for a document that carried no backlog", () => {
    expect(
      statusRow({ backlogState: undefined, prsSkipped: undefined }).value,
    ).toBe("nothing reported · just now");
  });

  it("leaves the unread rows out when the summary sent none", () => {
    expect(statusRow({ prsSkipped: undefined }).value).toBe(
      "backlog recorded · just now",
    );
  });

  it("leaves them out at zero, which is a count rather than a warning", () => {
    expect(statusRow({ prsSkipped: 0 }).value).toBe(
      "backlog recorded · just now",
    );
  });

  it("badges nothing stale, whatever the summary says about staleness", () => {
    // The window is the document's own and is capped at 300 s, so a project that
    // pushes a status once a run would be badged stale nearly every time a reader
    // looked. The receive time is shown instead, and `stale` stays in the API.
    const host = draw({
      projects: [
        projectCard({ status: statusFacts({ stale: true }) }),
        projectCard({ id: "beta", name: "Beta" }),
      ],
    });

    expect(textsOf(host, ".facts dd span.badge.stale")).toStrictEqual([]);
    expect(host.querySelectorAll(".facts dd .badge")).toHaveLength(0);
    // The card's own freshness pill is still there: that one is about the waves.
    expect(textsOf(host, ".pill")).toStrictEqual(["fresh", "fresh"]);
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
    const host = draw({
      attention: attentionView({
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
      }),
    });
    const row = oneOf(host, ".attention li");
    expect(textsOf(row as Element, "a")).toStrictEqual(["wv-c"]);
    expect(textsOf(row as Element, ".where code")).toStrictEqual([
      "alpha",
      "w-3",
    ]);
    expect(textOf(row?.querySelector(".where") ?? null)).toBe("alpha / w-3");
    expect(textsOf(row as Element, ".badge")).toStrictEqual([
      "failed",
      "gate",
      "stale",
    ]);
    expect(
      Array.from(row?.querySelectorAll(".badge") ?? []).map((badge) =>
        badge.getAttribute("class"),
      ),
    ).toStrictEqual(["badge reason", "badge reason", "badge stale"]);
    expect(textsOf(row as Element, ".seat")).toStrictEqual(["s1"]);
    expect(textsOf(row as Element, ".pr")).toStrictEqual(["PR #42"]);
    expect(textsOf(row as Element, "span[title]")).toStrictEqual(["10m ago"]);
    expect(textOf(row?.querySelector("span[title]") ?? null)).toBe("10m ago");
  });

  it("leaves out everything a lane did not report", () => {
    const host = draw({
      attention: attentionView({
        lanes: [attentionLane({ reasons: ["silent"] })],
      }),
    });
    const row = oneOf(host, ".attention li");
    expect(textsOf(row as Element, "a")).toStrictEqual(["wv-a"]);
    expect(textsOf(row as Element, ".badge")).toStrictEqual(["silent"]);
    expect(row?.querySelectorAll(".seat")).toHaveLength(0);
    expect(row?.querySelectorAll(".pr")).toHaveLength(0);
    expect(row?.querySelectorAll(".badge.stale")).toHaveLength(0);
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
    const attention: AttentionView = attentionView({
      lanes: [
        attentionLane({ lane: "wv-c" }),
        attentionLane({ lane: "wv-a" }),
        attentionLane({ lane: "wv-b", project: "beta", wave: "b-3" }),
      ],
    });
    const host = draw({ attention });
    expect(textsOf(host, ".attention a")).toStrictEqual([
      "wv-c",
      "wv-a",
      "wv-b",
    ]);
    expect(host.querySelectorAll(".attention li")).toHaveLength(3);
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
  it("names itself and says what it is for", () => {
    const host = draw();
    const view = oneOf(host, "section.view");
    expect(view?.getAttribute("class")).toBe("view fleet");
    expect(textsOf(host, "h1")).toStrictEqual(["Fleet"]);
    expect(textOf(oneOf(host, ".lede"))).toBe(
      "What each project's lanes reported, beside what the last push could derive. The gap is flagged, not resolved.",
    );
  });

  it("puts the counters above the grid, and the two panels in it", () => {
    const host = draw({
      attention: attentionView({ lanes: [attentionLane()] }),
    });
    const view = oneOf(host, "section.view");
    const order = Array.from(view?.children ?? []).map((child) =>
      child.getAttribute("class"),
    );
    expect(order).toStrictEqual([null, "lede", "kpis", "fleet-grid"]);
    expect(host.querySelectorAll(".fleet-grid > section")).toHaveLength(2);
    expect(
      Array.from(host.querySelectorAll(".fleet-grid > section")).map(
        (section) => section.getAttribute("class"),
      ),
    ).toStrictEqual(["fleet-projects", "fleet-attention"]);
  });
});
