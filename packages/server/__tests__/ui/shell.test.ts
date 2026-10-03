import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { Route } from "../../public/app.js";
import { el } from "../../public/dom.js";
import type { ShellHandlers, ShellModel } from "../../public/shell.js";
import { shell } from "../../public/shell.js";

import { attentionView, projectCard } from "./fixtures.js";
import {
  assertNoInjectedMarkup,
  freshRoot,
  oneOf,
  root,
  textOf,
  textsOf,
} from "./helpers.js";

const FLEET: Route = { kind: "projects" };
const PROJECT: Route = { kind: "project", id: "alpha" };
const WAVE: Route = { kind: "project", id: "alpha", wave: "wv1" };

/** The one handler the shell takes, and what it costs to press it. */
const HANDLERS: ShellHandlers = { onRefresh() {} };

/** The frame's own stylesheet, read as text: which rules the markup leans on. */
const HERE = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(join(HERE, "..", "..", "public", "shell.css"), "utf8");

function draw(
  model: Partial<ShellModel> = {},
  handlers = HANDLERS,
): HTMLElement {
  const host = freshRoot();
  const full: ShellModel = {
    route: FLEET,
    projects: [projectCard()],
    attention: undefined,
    all: false,
    menuOpen: false,
    note: "",
    syncedAt: undefined,
    syncing: false,
    ...model,
  };
  host.append(shell(full, el("p", { text: "the body" }), handlers));
  assertNoInjectedMarkup();
  return host;
}

function menuLinks(host: HTMLElement): { href: string; text: string }[] {
  return Array.from(host.querySelectorAll(".projects a")).map((anchor) => ({
    href: anchor.getAttribute("href") ?? "",
    text: textOf(anchor),
  }));
}

/** The menu's `details`, which is the only one the shell draws. */
function menuOf(host: HTMLElement): HTMLDetailsElement {
  return oneOf(host, "details.menu") as HTMLDetailsElement;
}

/** What the summary says, which counts the projects the app can link to. */
function summaryOf(host: HTMLElement): string {
  return textOf(oneOf(host, "details.menu > summary"));
}

describe("the frame", () => {
  it("is the top bar, the page and the footbar, in that order", () => {
    const app = oneOf(draw(), "div.app") as HTMLElement;
    expect(
      Array.from(app.children).map(
        (child) => `${child.tagName}.${child.getAttribute("class")}`,
      ),
    ).toStrictEqual(["HEADER.topbar", "MAIN.page", "FOOTER.footbar"]);
  });

  it("has no side rail any more", () => {
    const host = draw();
    expect(host.querySelectorAll("aside")).toHaveLength(0);
    expect(host.querySelectorAll(".rail")).toHaveLength(0);
    expect(host.querySelectorAll(".brand")).toHaveLength(0);
  });

  it("opens the top bar with the mark, the trail, the tag and the controls", () => {
    const bar = oneOf(draw(), "header.topbar") as HTMLElement;
    expect(
      Array.from(bar.children).map((child) => child.tagName),
    ).toStrictEqual(["svg", "NAV", "SPAN", "SPAN", "BUTTON", "DETAILS"]);
  });

  it("puts the mark first on the fleet page and on a project page", () => {
    for (const route of [FLEET, PROJECT]) {
      const bar = oneOf(draw({ route }), "header.topbar") as HTMLElement;
      const first = bar.children[0] as Element;
      expect(first.tagName).toBe("svg");
      expect(first.getAttribute("class")).toBe("logo");
    }
  });

  it("puts the console tag after the breadcrumb, before the controls", () => {
    const bar = oneOf(draw(), "header.topbar") as HTMLElement;
    const tag = oneOf(bar, "span.tag") as Element;
    expect(textOf(tag)).toBe("console");
    expect(Array.from(bar.children).indexOf(tag)).toBe(2);
  });
});

describe("the sync pill", () => {
  it("says it is syncing before anything has loaded", () => {
    const host = draw();
    expect(textOf(oneOf(host, "span.sync .sync-label"))).toBe("syncing…");
    expect(host.querySelector(".sync")?.getAttribute("class")).toBe("sync");
  });

  it("says the clock time of the last load", () => {
    const at = new Date(2026, 3, 1, 9, 5, 7).getTime();
    const host = draw({ syncedAt: at });
    expect(textOf(oneOf(host, "span.sync .sync-label"))).toBe(
      "synced 09:05:07",
    );
  });

  it("pings while there is no note", () => {
    const host = draw({ syncedAt: 0 });
    expect(host.querySelector(".sync")?.getAttribute("class")).toBe("sync");
    expect(host.querySelectorAll("span.sync .sync-dot")).toHaveLength(1);
  });

  it("stops and goes amber when there is a note", () => {
    const host = draw({ syncedAt: 0, note: "offline, retrying" });
    expect(host.querySelector(".sync")?.getAttribute("class")).toBe(
      "sync offline",
    );
    // The rule that stops it is in the stylesheet and nowhere else, so the class
    // above is only meaningful because this one is there.
    expect(CSS).toMatch(
      /\.sync\.offline\s+\.sync-dot\s*\{[^}]*animation:\s*none/,
    );
  });

  it("carries the note nowhere but the class and the label", () => {
    const host = draw({ note: "offline, retrying" });
    expect(textOf(oneOf(host, "span.sync"))).toBe("syncing…");
    expect(host.querySelectorAll(".note")).toHaveLength(1);
  });
});

describe("the refresh button", () => {
  it("is a labelled button of its own, not a link", () => {
    const button = oneOf(draw(), "button.refresh") as HTMLButtonElement;
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");
    expect(button.getAttribute("aria-label")).toBe("Refresh now");
    expect(button.getAttribute("data-key")).toBe("refresh");
    expect(button.querySelectorAll("svg.arrow")).toHaveLength(1);
  });

  it("draws its arrow as an svg of two paths and no text", () => {
    const arrow = oneOf(draw(), "button.refresh svg") as SVGElement;
    expect(arrow.getAttribute("aria-hidden")).toBe("true");
    expect(arrow.getAttribute("focusable")).toBe("false");
    expect(arrow.children).toHaveLength(2);
    for (const path of Array.from(arrow.children)) {
      expect(path.tagName).toBe("path");
      expect(path.textContent).toBe("");
    }
  });

  it("asks the app for a pass, and only when it is pressed", () => {
    let asked = 0;
    const host = draw({}, { onRefresh: () => (asked += 1) });
    expect(asked).toBe(0);
    (oneOf(host, "button.refresh") as HTMLButtonElement).click();
    expect(asked).toBe(1);
  });

  it("is still while no pass is in flight, and spins while one is", () => {
    expect(oneOf(draw(), "button.refresh")?.getAttribute("class")).toBe(
      "refresh",
    );
    expect(
      oneOf(draw({ syncing: true }), "button.refresh")?.getAttribute("class"),
    ).toBe("refresh spin");
    expect(CSS).toMatch(/\.refresh\.spin\s+\.arrow\s*\{[^}]*animation:/);
  });
});

describe("the projects menu", () => {
  it("is shut until the reader opens it", () => {
    const host = draw();
    expect(menuOf(host).open).toBe(false);
  });

  it("is open when the reader has it open", () => {
    expect(menuOf(draw({ menuOpen: true })).open).toBe(true);
  });

  it("names itself without a count before the first answer", () => {
    const host = draw({ projects: undefined });
    expect(summaryOf(host)).toBe("Projects");
    expect(textsOf(host, ".menu-list p")).toStrictEqual(["Loading…"]);
    expect(host.querySelectorAll(".projects")).toHaveLength(0);
  });

  it("counts the projects it can link to, and no others", () => {
    expect(summaryOf(draw({ projects: [] }))).toBe("Projects (0)");
    expect(
      summaryOf(
        draw({
          projects: [
            projectCard({ id: "a b", name: "Spaced" }),
            projectCard({ id: "alpha", name: "Alpha" }),
            projectCard({ id: "beta", name: "Beta" }),
          ],
        }),
      ),
    ).toBe("Projects (2)");
  });

  it("lists every project it kept, with the state beside the name", () => {
    const host = draw({
      all: true,
      route: PROJECT,
      projects: [
        projectCard({ id: "alpha", name: "Alpha", waves: 3 }),
        projectCard({ id: "beta", name: "Beta", waves: 1, stale: true }),
      ],
      attention: attentionView({
        projects: [
          { id: "alpha", attention: 1 },
          { id: "beta", attention: 2 },
        ],
      }),
    });
    expect(menuLinks(host)).toStrictEqual([
      { href: "/p/alpha?all=1", text: "Alpha" },
      { href: "/p/beta?all=1", text: "Beta" },
    ]);
    expect(
      Array.from(host.querySelectorAll(".projects a")).map((anchor) =>
        anchor.getAttribute("aria-current"),
      ),
    ).toStrictEqual(["page", null]);
    expect(textsOf(host, ".menu-list .projects small")).toStrictEqual([
      "3 waves · 1 needs attention",
      "1 wave · 2 need attention · stale",
    ]);
  });

  it("is named for assistive tech, and its summary is a control of its own", () => {
    const host = draw();
    expect(oneOf(host, "nav.menu-list")?.getAttribute("aria-label")).toBe(
      "Projects",
    );
    const summary = oneOf(host, "details.menu > summary");
    expect(summary?.getAttribute("data-key")).toBe("menu");
    expect(host.querySelectorAll("details")).toHaveLength(1);
  });

  it("counts a project's waves, and says when it is stale", () => {
    const host = draw({
      projects: [
        projectCard({ id: "alpha", name: "Alpha", waves: 3 }),
        projectCard({ id: "beta", name: "Beta", waves: 1 }),
        projectCard({ id: "gamma", name: "Gamma", waves: 12, stale: true }),
      ],
    });
    expect(textsOf(host, ".projects small")).toStrictEqual([
      "3 waves",
      "1 wave",
      "12 waves · stale",
    ]);
  });

  it("marks the project the route is on, and no other", () => {
    const projects = [
      projectCard({ id: "alpha", name: "Alpha" }),
      projectCard({ id: "beta", name: "Beta" }),
    ];
    const host = draw({ route: PROJECT, projects });
    const current = host.querySelectorAll('.projects a[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(textOf(current[0] as Element)).toBe("Alpha");
    expect(
      Array.from(host.querySelectorAll(".projects a")).map((anchor) =>
        anchor.getAttribute("aria-current"),
      ),
    ).toStrictEqual(["page", null]);
  });

  it("marks nothing on the fleet route", () => {
    const host = draw({ route: FLEET });
    expect(
      host.querySelectorAll('.projects a[aria-current="page"]'),
    ).toHaveLength(0);
  });

  it("says so when nothing is registered", () => {
    const host = draw({ projects: [] });
    expect(textsOf(host, ".menu-list p")).toStrictEqual([
      "No projects registered yet.",
    ]);
  });

  it("skips a project whose id it would have to invent a path for", () => {
    const host = draw({
      projects: [
        projectCard({ id: "a b", name: "Spaced" }),
        projectCard({ id: "ALPHA", name: "Shouty" }),
        projectCard({ id: "alpha", name: "Alpha" }),
      ],
    });
    expect(menuLinks(host)).toStrictEqual([
      { href: "/p/alpha", text: "Alpha" },
    ]);
    expect(host.querySelectorAll("a")).toHaveLength(1);
  });

  it("says nothing is registered when every project was skipped", () => {
    const host = draw({ projects: [projectCard({ id: "a b" })] });
    expect(textsOf(host, ".menu-list p")).toStrictEqual([
      "No projects registered yet.",
    ]);
  });

  it("draws the whole list even while it is shut", () => {
    const host = draw({
      projects: [projectCard(), projectCard({ id: "beta", name: "Beta" })],
    });
    expect(menuLinks(host)).toHaveLength(2);
  });
});

describe("the footbar", () => {
  it("says what mode this build runs in", () => {
    expect(textsOf(draw(), ".footbar .mode")).toStrictEqual(["read-only"]);
  });

  it("says what the seven words in the tables mean", () => {
    const host = draw();
    expect(textsOf(host, ".footbar .legend p")).toStrictEqual([
      "stale — no snapshot inside the wave's interval; liveness reads unknown",
      "disagreement — reported and derived differ",
      "agrees — reported matches derived",
      "running",
      "done",
      "settled",
      "failed",
    ]);
  });

  it("gives each chip a square, and says `stale` once", () => {
    const host = draw();
    expect(
      Array.from(host.querySelectorAll(".footbar .legend p")).map((chip) =>
        (chip.firstElementChild as Element).getAttribute("class"),
      ),
    ).toStrictEqual([
      "swatch stale",
      "swatch disagreement",
      "swatch agrees",
      "swatch running",
      "swatch done",
      "swatch settled",
      "swatch failed",
    ]);
    const words = textsOf(host, ".footbar .legend p").filter((line) =>
      line.startsWith("stale"),
    );
    expect(words).toHaveLength(1);
  });

  it("carries the squares as no text at all, so no colour is the only meaning", () => {
    const host = draw();
    for (const mark of Array.from(host.querySelectorAll(".legend .swatch"))) {
      expect(mark.textContent).toBe("");
      expect(mark.getAttributeNames()).toStrictEqual(["class"]);
    }
  });

  it("carries the status region ahead of them", () => {
    const bar = oneOf(draw(), "footer.footbar") as HTMLElement;
    expect(
      Array.from(bar.children).map((child) => child.getAttribute("class")),
    ).toStrictEqual(["status", "mode", "legend"]);
  });
});

describe("the menu's attention counts", () => {
  const projects = [
    projectCard({ id: "alpha", name: "Alpha", waves: 3 }),
    projectCard({ id: "beta", name: "Beta", waves: 1 }),
  ];

  it("says nothing at all before the first attention view arrives", () => {
    const host = draw({ projects, attention: undefined });
    expect(textsOf(host, ".projects small")).toStrictEqual([
      "3 waves",
      "1 wave",
    ]);
  });

  it("says nothing for a project the view has no entry for", () => {
    const host = draw({
      projects,
      attention: attentionView({ projects: [{ id: "gamma", attention: 4 }] }),
    });
    expect(textsOf(host, ".projects small")).toStrictEqual([
      "3 waves",
      "1 wave",
    ]);
  });

  it("says nothing for a project whose lanes need nothing", () => {
    const host = draw({
      projects,
      attention: attentionView({
        projects: [
          { id: "alpha", attention: 0 },
          { id: "beta", attention: 0 },
        ],
      }),
    });
    expect(textsOf(host, ".projects small")).toStrictEqual([
      "3 waves",
      "1 wave",
    ]);
  });

  it("agrees in the singular", () => {
    const host = draw({
      projects,
      attention: attentionView({ projects: [{ id: "alpha", attention: 1 }] }),
    });
    expect(textsOf(host, ".projects small")).toStrictEqual([
      "3 waves · 1 needs attention",
      "1 wave",
    ]);
  });

  it("counts the lanes, not the projects, and keeps the stale mark", () => {
    const host = draw({
      projects: [
        projectCard({ id: "alpha", name: "Alpha", waves: 3, stale: true }),
        projectCard({ id: "beta", name: "Beta", waves: 1 }),
      ],
      attention: attentionView({
        projects: [
          { id: "alpha", attention: 3 },
          { id: "beta", attention: 2 },
        ],
      }),
    });
    expect(textsOf(host, ".projects small")).toStrictEqual([
      "3 waves · 3 need attention · stale",
      "1 wave · 2 need attention",
    ]);
  });
});

describe("the links keep the show-all state", () => {
  it("leaves a menu link and a breadcrumb link bare when it is off", () => {
    const host = draw({ route: WAVE, all: false });
    expect(host.querySelector(".projects a")?.getAttribute("href")).toBe(
      "/p/alpha",
    );
    expect(host.querySelectorAll(".crumbs a")[1]?.getAttribute("href")).toBe(
      "/p/alpha",
    );
  });

  it("carries all=1 on both when it is on, and leaves the fleet link bare", () => {
    const host = draw({ route: WAVE, all: true });
    expect(host.querySelector(".projects a")?.getAttribute("href")).toBe(
      "/p/alpha?all=1",
    );
    expect(host.querySelectorAll(".crumbs a")[1]?.getAttribute("href")).toBe(
      "/p/alpha?all=1",
    );
    expect(host.querySelector(".crumbs a")?.getAttribute("href")).toBe("/");
  });
});

describe("the breadcrumb", () => {
  it("is the brand alone on the fleet route", () => {
    const host = draw({ route: FLEET });
    const crumbs = oneOf(host, ".crumbs");
    expect(textsOf(host, ".crumbs a")).toStrictEqual([]);
    expect(textsOf(host, '.crumbs [aria-current="page"]')).toStrictEqual([
      "waves",
    ]);
    expect(textOf(crumbs as Element)).toBe("waves");
  });

  it("leads back to the fleet from a page that is not one of ours", () => {
    const host = draw({ route: { kind: "unknown" } });
    expect(textsOf(host, ".crumbs a")).toStrictEqual(["waves"]);
    expect(host.querySelector(".crumbs a")?.getAttribute("href")).toBe("/");
    expect(host.querySelector('.crumbs [aria-current="page"]')).toBeNull();
  });

  it("is the brand and the project on a project route", () => {
    const host = draw({ route: PROJECT });
    expect(textsOf(host, ".crumbs a")).toStrictEqual(["waves"]);
    expect(host.querySelector(".crumbs a")?.getAttribute("href")).toBe("/");
    expect(textsOf(host, '.crumbs [aria-current="page"]')).toStrictEqual([
      "alpha",
    ]);
    expect(textsOf(host, '.crumbs [aria-current="page"] code')).toStrictEqual([
      "alpha",
    ]);
  });

  it("is the brand, the project and the wave on a wave route", () => {
    const host = draw({ route: WAVE });
    expect(textsOf(host, ".crumbs a")).toStrictEqual(["waves", "alpha"]);
    expect(textsOf(host, ".crumbs a")[1]).toBe("alpha");
    expect(host.querySelectorAll(".crumbs a")[1]?.getAttribute("href")).toBe(
      "/p/alpha",
    );
    expect(textsOf(host, '.crumbs [aria-current="page"]')).toStrictEqual([
      "wv1",
    ]);
    expect(textsOf(host, '.crumbs [aria-current="page"] code')).toStrictEqual([
      "wv1",
    ]);
    expect(textOf(oneOf(host, ".crumbs") as Element)).toBe(
      "waves / alpha / wv1",
    );
  });
});

describe("the note", () => {
  it("is in the footbar's status region, and says what went wrong", () => {
    const host = draw({ note: "offline, retrying" });
    const status = oneOf(host, ".footbar .note");
    expect(textOf(status as Element)).toBe("offline, retrying");
    expect(status?.getAttribute("role")).toBe("status");
    expect(status?.getAttribute("aria-live")).toBe("polite");
  });

  it("leaves the region there, empty, when there is nothing to say", () => {
    const host = draw({ note: "" });
    expect(host.querySelectorAll(".note")).toHaveLength(0);
    const status = oneOf(host, ".footbar .status");
    expect(status?.getAttribute("role")).toBe("status");
    expect(status?.getAttribute("aria-live")).toBe("polite");
    expect(textOf(status as Element)).toBe("");
  });

  it("appears once, not once per thing that failed", () => {
    const host = draw({ note: "offline, retrying" });
    expect(host.querySelectorAll(".note")).toHaveLength(1);
  });

  it("is not in the top bar, which carries the mark and the menu instead", () => {
    const host = draw({ note: "offline, retrying" });
    expect(
      oneOf(host, "header.topbar")?.querySelectorAll(".note"),
    ).toHaveLength(0);
  });
});

describe("the page area", () => {
  it("holds what the view drew, inside one main", () => {
    const host = draw();
    const mains = host.querySelectorAll("main.page");
    expect(mains).toHaveLength(1);
    expect(textOf(oneOf(host, "main.page") as Element)).toContain("the body");
    expect(textsOf(host, "main.page > p")).toStrictEqual(["the body"]);
  });
});

describe("the first paint", () => {
  it("rises once, on the page's own content, and never on the loader line", () => {
    // The entrance is CSS over an attribute `app.js` sets and takes off, so the
    // selector is the whole of the gate: under `#root[data-first]`, on what the
    // views drew, and not on the line that says nothing has been drawn yet.
    expect(CSS).toMatch(
      /#root\[data-first\]\s+\.app\s*>\s*main\s*>\s*:not\(\.empty\)\s*\{[^}]*animation:/,
    );
    expect(CSS).toMatch(/@keyframes\s+waves-rise\s*\{/);
    expect(CSS).toMatch(/translateY\(12px\)/);
    expect(CSS).toMatch(/waves-rise\s+600ms/);
  });
});

describe("the attributes the app owns", () => {
  it("names nothing, so no payload can be carried by an id, a for or a name", () => {
    const host = draw({
      route: WAVE,
      projects: [projectCard()],
      note: "offline, retrying",
    });
    for (const name of ["id", "for", "name"]) {
      expect(
        Array.from(host.querySelectorAll("*")).filter((node) =>
          node.hasAttribute(name),
        ),
      ).toStrictEqual([]);
    }
  });

  it("marks every link it may follow in place, and its own two controls once", () => {
    draw({ route: WAVE });
    const keys = Array.from(document.querySelectorAll("[data-key]")).map(
      (node) => node.getAttribute("data-key"),
    );
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.filter((key) => key === "menu")).toHaveLength(1);
    expect(keys.filter((key) => key === "refresh")).toHaveLength(1);
    expect(keys.filter((key) => key === "nav")).toHaveLength(keys.length - 2);
    expect(root().querySelectorAll("a:not([data-key='nav'])")).toHaveLength(0);
  });
});
