import { describe, expect, it } from "vitest";

import type { Route } from "../../public/app.js";
import { el } from "../../public/dom.js";
import type { ShellModel } from "../../public/shell.js";
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

function draw(model: Partial<ShellModel> = {}): HTMLElement {
  const host = freshRoot();
  const full: ShellModel = {
    route: FLEET,
    projects: [projectCard()],
    attention: undefined,
    all: false,
    note: "",
    ...model,
  };
  host.append(shell(full, el("p", { text: "the body" })));
  assertNoInjectedMarkup();
  return host;
}

function railLinks(host: HTMLElement): { href: string; text: string }[] {
  return Array.from(host.querySelectorAll(".projects a")).map((anchor) => ({
    href: anchor.getAttribute("href") ?? "",
    text: textOf(anchor),
  }));
}

describe("the rail", () => {
  it("says it is loading before the first answer arrives", () => {
    const host = draw({ projects: undefined });
    expect(textsOf(host, ".rail-nav p")).toStrictEqual(["Loading…"]);
    expect(host.querySelectorAll(".projects")).toHaveLength(0);
  });

  it("says so when nothing is registered", () => {
    const host = draw({ projects: [] });
    expect(textsOf(host, ".rail-nav p")).toStrictEqual([
      "No projects registered yet.",
    ]);
  });

  it("carries the brand and one link per project", () => {
    const host = draw({
      projects: [
        projectCard(),
        projectCard({ id: "beta", name: "Beta", waves: 1 }),
        projectCard({ id: "gamma", name: "Gamma", stale: true }),
      ],
    });
    expect(textsOf(host, ".brand small")).toStrictEqual(["read-only"]);
    expect(railLinks(host)).toStrictEqual([
      { href: "/p/alpha", text: "Alpha" },
      { href: "/p/beta", text: "Beta" },
      { href: "/p/gamma", text: "Gamma" },
    ]);
  });

  it("counts a project's waves, and says when it is stale", () => {
    const host = draw({
      projects: [
        projectCard({ id: "alpha", name: "Alpha", waves: 3 }),
        projectCard({ id: "beta", name: "Beta", waves: 1 }),
        projectCard({
          id: "gamma",
          name: "Gamma",
          waves: 12,
          stale: true,
        }),
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

  it("skips a project whose id it would have to invent a path for", () => {
    const host = draw({
      projects: [
        projectCard({ id: "a b", name: "Spaced" }),
        projectCard({ id: "ALPHA", name: "Shouty" }),
        projectCard({ id: "alpha", name: "Alpha" }),
      ],
    });
    expect(railLinks(host)).toStrictEqual([
      { href: "/p/alpha", text: "Alpha" },
    ]);
  });

  it("says nothing is registered when every project was skipped", () => {
    const host = draw({ projects: [projectCard({ id: "a b" })] });
    expect(textsOf(host, ".rail-nav p")).toStrictEqual([
      "No projects registered yet.",
    ]);
  });

  it("says what the three words in the tables mean", () => {
    const host = draw();
    expect(textsOf(host, ".legend p")).toStrictEqual([
      "stale — no snapshot inside the wave's interval; liveness reads unknown",
      "disagreement — reported and derived differ",
      "agrees — reported matches derived",
    ]);
  });
});

describe("the rail's attention counts", () => {
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
  it("leaves a rail link and a breadcrumb link bare when it is off", () => {
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
    expect(host.querySelector(".brand a")?.getAttribute("href")).toBe("/");
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
  it("is in the status region, and says what went wrong", () => {
    const host = draw({ note: "offline, retrying" });
    const status = oneOf(host, ".topbar .note");
    expect(textOf(status as Element)).toBe("offline, retrying");
    expect(status?.getAttribute("role")).toBe("status");
    expect(status?.getAttribute("aria-live")).toBe("polite");
  });

  it("leaves the region there, empty, when there is nothing to say", () => {
    const host = draw({ note: "" });
    expect(host.querySelectorAll(".note")).toHaveLength(0);
    const status = oneOf(host, ".topbar .status");
    expect(status?.getAttribute("role")).toBe("status");
    expect(status?.getAttribute("aria-live")).toBe("polite");
    expect(textOf(status as Element)).toBe("");
  });

  it("appears once, not once per thing that failed", () => {
    const host = draw({ note: "offline, retrying" });
    expect(host.querySelectorAll(".note")).toHaveLength(1);
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

  it("marks every link it may follow in place, and nothing else", () => {
    draw({ route: WAVE });
    const keys = Array.from(document.querySelectorAll("[data-key]")).map(
      (node) => node.getAttribute("data-key"),
    );
    expect(keys.length).toBeGreaterThan(0);
    expect(keys).toStrictEqual(keys.map(() => "nav"));
    expect(root().querySelectorAll("a:not([data-key='nav'])")).toHaveLength(0);
  });
});
