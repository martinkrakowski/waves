import { describe, expect, it } from "vitest";

import type { AppGlobals } from "../../public/app.js";
import { createApp } from "../../public/app.js";
import { el, repoLink } from "../../public/dom.js";

import type { InboxProject } from "../../src/application/notice-read-model.js";
import type { ProjectLanesView } from "../../src/application/read-model.js";
import {
  attentionView,
  decisionResponse,
  inboxHead,
  inboxProject,
  inboxView,
  laneRow,
  projectCard,
  projectInboxView,
  projectLanes,
  waveSummary,
} from "./fixtures.js";
import type { Answer, FetchStub, GatedFetch } from "./helpers.js";
import {
  browserGlobals,
  fetchStub,
  flush,
  freshRoot,
  gatedFetch,
  root,
  textOf,
  textsOf,
  timerStub,
} from "./helpers.js";

/** Every wave each project's listing answers with, so a crossed path shows. */
const WAVE_IDS: Readonly<Record<string, readonly string[]>> = {
  alpha: ["a-3", "a-2"],
  beta: ["b-3", "b-2"],
};

/** The name each project's listing answers with, which is the page's heading. */
const NAMES: Readonly<Record<string, string>> = {
  alpha: "Alpha",
  beta: "Beta",
};

const PROJECTS = [projectCard(), projectCard({ id: "beta", name: "Beta" })];

/** One project's whole answer: its waves, and one lane in each of them. */
function listingFor(id: string, waves: readonly string[]): ProjectLanesView {
  return projectLanes({
    project: { id, name: NAMES[id] ?? id },
    waves: waves.map((wave, at) =>
      waveSummary({
        wave,
        receivedAt: `2026-04-01T${at === 0 ? "11" : "10"}:50:00.000Z`,
      }),
    ),
    lanes: waves.map((wave) => laneRow({ wave })),
  });
}

/** A project card turned into an inbox project entry, with zero counts. */
function inboxOf(projects: readonly unknown[]): InboxProject[] {
  return (projects as readonly { id: string; name: string }[]).map((p) =>
    inboxProject({ id: p.id, name: p.name }),
  );
}

/** The rail's list, and every project's lanes, so a crossed path is visible. */
function perProject(path: string): Answer {
  if (path === "/api/v1/projects") {
    return { status: 200, body: PROJECTS };
  }
  if (path === "/api/v1/attention") {
    return { status: 200, body: attentionView() };
  }
  if (path === "/api/v1/inbox") {
    return { status: 200, body: inboxView({ projects: inboxOf(PROJECTS) }) };
  }
  const lanes = /^\/api\/v1\/projects\/([^/]+)\/lanes(?:\?all=1)?$/.exec(path);
  if (lanes !== null) {
    const id = lanes[1] ?? "";
    return { status: 200, body: listingFor(id, WAVE_IDS[id] ?? []) };
  }
  return { status: 404 };
}

/** Holds the first request to each path `hold` says yes to, and only that one. */
function holding(
  handler: (path: string) => Answer,
  hold: (path: string) => boolean,
): GatedFetch {
  const held = new Set<string>();
  return gatedFetch((path) => {
    const answer = handler(path);
    if (!held.has(path) && hold(path)) {
      held.add(path);
      return { ...answer, hold: true };
    }
    return { ...answer, hold: false };
  });
}

/** The paths asked for that name one project's lanes, whichever project. */
function lanesAskedFor(calls: readonly string[]): string[] {
  return calls.filter((path) => /\/lanes/.test(path));
}

/** The rail's list, and one project's lanes, whichever route the test is on. */
function answering(...projects: unknown[]): (path: string) => Answer {
  const waves = ["w-3", "w-2", "w-1"];
  return (path) => {
    if (path === "/api/v1/projects") {
      return { status: 200, body: projects };
    }
    if (path === "/api/v1/attention") {
      return { status: 200, body: attentionView() };
    }
    if (path === "/api/v1/inbox") {
      return { status: 200, body: inboxView({ projects: inboxOf(projects) }) };
    }
    const lanes = /^\/api\/v1\/projects\/([^/]+)\/lanes(?:\?all=1)?$/.exec(
      path,
    );
    if (lanes !== null) {
      const id = lanes[1] ?? "";
      return {
        status: 200,
        body: projectLanes({
          project: { id, name: NAMES[id] ?? id },
          waves: waves.map((wave) =>
            waveSummary({
              wave,
              receivedAt: "2026-04-01T11:50:00.000Z",
              retained: wave !== "w-1",
            }),
          ),
          lanes: waves.map((wave) => laneRow({ wave })),
        }),
      };
    }
    return { status: 404 };
  };
}

function harness(options: {
  pathname: string;
  search?: string;
  fetchImpl?: FetchStub;
}): {
  readonly app: ReturnType<typeof createApp>;
  readonly browser: ReturnType<typeof browserGlobals>;
  readonly timers: ReturnType<typeof timerStub>;
} {
  freshRoot();
  const timers = timerStub();
  const browser = browserGlobals(options.pathname, options.search ?? "");
  const app = createApp({
    doc: document,
    location: browser.location,
    history: browser.history,
    win: browser.win,
    fetch: options.fetchImpl ?? fetchStub(answering(projectCard())),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    clock: () => Date.parse("2026-04-01T12:00:00.000Z"),
  } satisfies AppGlobals);
  return { app, browser, timers };
}

/**
 * The anchors a test means to leave alone have their default prevented by a
 * listener on `document`, which runs after the root's own listener, so the test
 * DOM never follows a URL it was only inspecting.
 */
function noNavigation(): void {
  document.addEventListener("click", (event) => event.preventDefault(), {
    once: false,
  });
}

/** A click with the bubbles and the cancelability the handler needs to see. */
function click(
  node: EventTarget,
  init: MouseEventInit = {},
  onDocument?: () => void,
): void {
  node.dispatchEvent(
    new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
      ...init,
    }),
  );
  onDocument?.();
}

describe("a click on one of the app's own links", () => {
  it("navigates in place, and draws the new route without a page load", async () => {
    const fetchImpl = fetchStub(
      answering(projectCard(), projectCard({ id: "beta", name: "Beta" })),
    );
    const { app, browser } = harness({ pathname: "/", fetchImpl });
    app.start();
    await flush();

    const beta = textsOf(root(), ".projects a");
    expect(beta).toStrictEqual(["Alpha", "Beta"]);
    (root().querySelectorAll(".projects a")[1] as HTMLElement).click();
    await flush();

    expect(browser.pushes).toStrictEqual(["/p/beta"]);
    expect(browser.location.pathname).toBe("/p/beta");
    expect(app.route).toStrictEqual({ kind: "project", id: "beta" });
    expect(textsOf(root(), "h1")).toStrictEqual(["Beta"]);
    expect(document.title).toBe("waves — beta");
    app.stop();
  });

  it.each(["metaKey", "ctrlKey", "shiftKey", "altKey"] as const)(
    "leaves a %s click to the browser",
    async (modifier) => {
      noNavigation();
      const { app, browser } = harness({ pathname: "/" });
      app.start();
      await flush();

      const alpha = root().querySelectorAll(".projects a")[0] as HTMLElement;
      click(alpha, { [modifier]: true }, () => undefined);

      expect(browser.pushes).toStrictEqual([]);
      expect(app.route).toStrictEqual({ kind: "projects" });
      app.stop();
    },
  );

  it("leaves a click that was not the primary button to the browser", async () => {
    noNavigation();
    const { app, browser } = harness({ pathname: "/" });
    app.start();
    await flush();

    const alpha = root().querySelectorAll(".projects a")[0] as HTMLElement;
    click(alpha, { button: 2 });

    expect(browser.pushes).toStrictEqual([]);
    app.stop();
  });

  it("leaves a click something else already answered to the browser", async () => {
    noNavigation();
    const { app, browser } = harness({ pathname: "/" });
    app.start();
    await flush();

    const alpha = root().querySelectorAll(".projects a")[0] as HTMLElement;
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    event.preventDefault();
    alpha.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(browser.pushes).toStrictEqual([]);
    app.stop();
  });

  it("leaves a repository link to the browser", async () => {
    noNavigation();
    const { app, browser } = harness({ pathname: "/" });
    app.start();
    await flush();

    const repo = root().querySelector(".row-id a");
    expect(repo?.getAttribute("href")).toBe("https://git.example.test/alpha");
    expect(repo?.hasAttribute("data-key")).toBe(false);
    click(repo as HTMLElement);

    expect(browser.pushes).toStrictEqual([]);
    app.stop();
  });

  it("leaves a click on text that is not a link", async () => {
    noNavigation();
    const { app, browser } = harness({ pathname: "/" });
    app.start();
    await flush();

    const heading = root().querySelector("h2") as HTMLElement;
    expect(heading.firstChild).not.toBeNull();
    click(heading.firstChild as EventTarget);

    expect(browser.pushes).toStrictEqual([]);
    app.stop();
  });

  it("follows a link built by the view, not by the shell", async () => {
    noNavigation();
    const { app, browser } = harness({ pathname: "/" });
    app.start();
    await flush();

    const repo = repoLink("git", "https://git.example.test/alpha");
    root().append(repo);
    click(repo);

    expect(browser.pushes).toStrictEqual([]);
    app.stop();
  });

  it("leaves a same-origin anchor the app did not mark alone", async () => {
    noNavigation();
    const { app, browser } = harness({ pathname: "/" });
    app.start();
    await flush();

    // The shape a full page load takes: an address, and no mark of ours on it.
    const plain = el("a", { text: "the stylesheet" });
    plain.setAttribute("href", "/app.css");
    root().append(plain);
    click(plain);

    expect(browser.pushes).toStrictEqual([]);
    expect(app.route).toStrictEqual({ kind: "projects" });
    app.stop();
  });

  it("leaves a marked anchor with no address of its own alone", async () => {
    noNavigation();
    const { app, browser } = harness({ pathname: "/" });
    app.start();
    await flush();

    const anchor = el("a", {
      attrs: { "data-key": "nav" },
      text: "nowhere",
    });
    root().append(anchor);
    click(anchor);

    expect(browser.pushes).toStrictEqual([]);
    expect(app.route).toStrictEqual({ kind: "projects" });
    app.stop();
  });
});

describe("navigate", () => {
  it("ignores a url that is not a path of this origin", async () => {
    const { app, browser } = harness({ pathname: "/" });
    app.start();
    await flush();

    app.navigate("https://evil.example/steal");
    app.navigate("//evil.example/steal");
    app.navigate("/\\evil.example/steal");
    await flush();

    expect(browser.pushes).toStrictEqual([]);
    expect(browser.location.pathname).toBe("/");
    app.stop();
  });

  it("ignores the url it is already at", async () => {
    const { app, browser } = harness({ pathname: "/p/alpha" });
    app.start();
    await flush();

    app.navigate("/p/alpha");
    await flush();

    expect(browser.pushes).toStrictEqual([]);
    app.stop();
  });

  it("goes to a different url carrying the whole path and query", async () => {
    const { app, browser } = harness({ pathname: "/p/alpha" });
    app.start();
    await flush();

    app.navigate("/p/beta?all=1");
    await flush();

    expect(browser.pushes).toStrictEqual(["/p/beta?all=1"]);
    expect(app.route).toStrictEqual({ kind: "project", id: "beta" });
    app.stop();
  });

  it("writes the address over itself when it is told to replace it", async () => {
    const { app, browser } = harness({ pathname: "/p/alpha" });
    app.start();
    await flush();

    app.navigate("/p/alpha?q=s1", { replace: true });
    await flush();

    // One entry per keystroke would be one entry per letter of every word a
    // reader ever searched for, between the page they came from and the page
    // they are on.
    expect(browser.replaces).toStrictEqual(["/p/alpha?q=s1"]);
    expect(browser.pushes).toStrictEqual([]);
    expect(browser.location.search).toBe("?q=s1");
    app.stop();
  });
});

describe("the back button", () => {
  it("re-reads the location and draws the route it names", async () => {
    const fetchImpl = fetchStub(
      answering(projectCard(), projectCard({ id: "beta", name: "Beta" })),
    );
    const { app, browser } = harness({ pathname: "/", fetchImpl });
    app.start();
    await flush();

    (root().querySelectorAll(".projects a")[1] as HTMLElement).click();
    await flush();
    expect(textsOf(root(), "h1")).toStrictEqual(["Beta"]);

    browser.location.pathname = "/";
    browser.location.search = "";
    browser.popstate();
    await flush();

    expect(browser.pushes).toStrictEqual(["/p/beta"]);
    expect(app.route).toStrictEqual({ kind: "projects" });
    expect(textsOf(root(), ".row-head h3 a")).toStrictEqual(["Alpha", "Beta"]);
    app.stop();
  });
});

describe("a navigation that lands while a pass is in flight", () => {
  it("loads the route it moved to, not the one the pass started for", async () => {
    const gate = holding(perProject, (path) => path === "/api/v1/projects");
    const { app } = harness({ pathname: "/", fetchImpl: gate });
    app.start();
    await flush();
    expect(gate.pending()).toBe(1);

    app.navigate("/p/beta");
    gate.release();
    await flush();

    expect(app.route).toStrictEqual({ kind: "project", id: "beta" });
    expect(textsOf(root(), "h1")).toStrictEqual(["Beta"]);
    expect(textsOf(root(), ".wave-strip li a")).toStrictEqual([
      "all lanes",
      "b-3",
      "b-2",
    ]);
    expect(lanesAskedFor(gate.calls)).toStrictEqual([
      "/api/v1/projects/beta/lanes",
    ]);
    app.stop();
  });

  it("never asks the new project for a wave of the old one", async () => {
    const gate = holding(perProject, (path) => path.endsWith("/alpha/lanes"));
    const { app } = harness({ pathname: "/p/alpha", fetchImpl: gate });
    app.start();
    await flush();
    expect(gate.calls).toContain("/api/v1/projects/alpha/lanes");

    app.navigate("/p/beta");
    gate.release();
    await flush();

    // One request for the project on screen, and nothing of alpha's after the
    // navigation.
    expect(lanesAskedFor(gate.calls)).toStrictEqual([
      "/api/v1/projects/alpha/lanes",
      "/api/v1/projects/beta/lanes",
    ]);
    expect(textsOf(root(), "h1")).toStrictEqual(["Beta"]);
    expect(textsOf(root(), ".wave-strip li a")).toStrictEqual([
      "all lanes",
      "b-3",
      "b-2",
    ]);
    expect(textsOf(root(), "tbody tr .in-wave")).toStrictEqual(["b-3", "b-2"]);
    app.stop();
  });

  it("does the same when the back button lands mid-pass", async () => {
    const gate = holding(perProject, (path) => path === "/api/v1/projects");
    const { app, browser } = harness({ pathname: "/", fetchImpl: gate });
    app.start();
    await flush();
    expect(gate.pending()).toBe(1);

    browser.location.pathname = "/p/beta";
    browser.location.search = "";
    browser.popstate();
    gate.release();
    await flush();

    expect(app.route).toStrictEqual({ kind: "project", id: "beta" });
    expect(textsOf(root(), "h1")).toStrictEqual(["Beta"]);
    expect(textsOf(root(), ".wave-strip li a")).toStrictEqual([
      "all lanes",
      "b-3",
      "b-2",
    ]);
    expect(lanesAskedFor(gate.calls)).toStrictEqual([
      "/api/v1/projects/beta/lanes",
    ]);
    app.stop();
  });

  it("keeps a superseded pass that failed from saying the page is offline", async () => {
    let first = true;
    const gate = gatedFetch((path) => {
      if (path === "/api/v1/projects" && first) {
        first = false;
        // Held, and not a list of projects: the pass for `/` fails, but only
        // after the reader has already navigated away from it.
        return { status: 200, body: [{}], hold: true };
      }
      return { ...perProject(path), hold: false };
    });
    const { app } = harness({ pathname: "/", fetchImpl: gate });
    app.start();
    await flush();
    expect(gate.pending()).toBe(1);

    app.navigate("/p/beta");
    gate.release();
    await flush();

    expect(app.route).toStrictEqual({ kind: "project", id: "beta" });
    expect(root().querySelectorAll(".note")).toHaveLength(0);
    expect(textsOf(root(), "h1")).toStrictEqual(["Beta"]);
    expect(gate.calls).toContain("/api/v1/projects/beta/lanes");
    app.stop();
  });

  it("loads the fleet, and nothing of the project, when a project route is left mid-pass", async () => {
    const gate = holding(perProject, (path) => path.endsWith("/alpha/lanes"));
    const { app } = harness({ pathname: "/p/alpha", fetchImpl: gate });
    app.start();
    await flush();
    expect(gate.pending()).toBe(1);
    // The project has drawn nothing yet: its one pass is still waiting on it.
    expect(textsOf(root(), ".empty")).toStrictEqual(["Loading…"]);

    app.navigate("/");
    expect(textsOf(root(), ".empty")).toStrictEqual(["Loading…"]);
    gate.release();
    await flush();

    expect(app.route).toStrictEqual({ kind: "projects" });
    // The pass for the project was dropped rather than drawn under the fleet,
    // and the fleet asked for nothing but the rail's two lists.
    expect(root().querySelectorAll("table")).toHaveLength(0);
    expect(textsOf(root(), ".row-head h3 a")).toStrictEqual(["Alpha", "Beta"]);
    expect(
      gate.calls.filter((path) => path !== "/api/v1/projects"),
    ).toStrictEqual([
      "/api/v1/attention",
      "/api/v1/projects/alpha/lanes",
      "/api/v1/projects/alpha/status",
      "/api/v1/attention",
    ]);
    app.stop();
  });

  it("says a path that is not a page, asking for the rail and nothing else", async () => {
    const gate = holding(perProject, (path) => path.endsWith("/alpha/lanes"));
    const { app } = harness({ pathname: "/p/alpha", fetchImpl: gate });
    app.start();
    await flush();
    expect(gate.pending()).toBe(1);

    app.navigate("/nope");
    // A path that is not a page is said at once, whatever is still in flight.
    expect(textsOf(root(), ".empty")).toStrictEqual(["No such page."]);
    expect(root().querySelectorAll("table")).toHaveLength(0);
    gate.release();
    await flush();

    expect(app.route).toStrictEqual({ kind: "unknown" });
    expect(textsOf(root(), ".empty")).toStrictEqual(["No such page."]);
    expect(textsOf(root(), ".projects a")).toStrictEqual(["Alpha", "Beta"]);
    app.stop();
  });
});

describe("choosing a wave", () => {
  it("navigates to that wave's own path, and keeps the query", async () => {
    const { app, browser } = harness({ pathname: "/p/alpha" });
    app.start();
    await flush();

    (root().querySelectorAll(".wave-strip li a")[2] as HTMLElement).click();
    await flush();

    expect(browser.pushes).toStrictEqual(["/p/alpha/w/w-2"]);
    expect(app.route).toStrictEqual({
      kind: "project",
      id: "alpha",
      wave: "w-2",
    });
    expect(textsOf(root(), '.wave-strip a[aria-current="page"]')).toStrictEqual(
      ["w-2"],
    );
    expect(textsOf(root(), "tbody tr")).toHaveLength(1);
    expect(document.title).toBe("waves — alpha");
    app.stop();
  });

  it("navigates to a lane's own wave with the lane chosen", async () => {
    const { app, browser } = harness({ pathname: "/p/alpha" });
    app.start();
    await flush();

    const lane = root().querySelector("td[data-label='Lane'] a") as HTMLElement;
    expect(lane.getAttribute("href")).toBe("/p/alpha/w/w-3?lane=wv-a");
    lane.click();
    await flush();

    expect(browser.pushes).toStrictEqual(["/p/alpha/w/w-3?lane=wv-a"]);
    expect(app.route).toStrictEqual({
      kind: "project",
      id: "alpha",
      wave: "w-3",
    });
    expect(root().querySelectorAll("tbody tr.current")).toHaveLength(1);
    app.stop();
  });

  it("carries the show-all state the toggle had at the moment of the click", async () => {
    const { app, browser } = harness({ pathname: "/p/alpha" });
    app.start();
    await flush();

    (root().querySelector(".wave-strip > a") as HTMLElement).click();
    await flush();
    (root().querySelectorAll(".wave-strip li a")[3] as HTMLElement).click();
    await flush();

    expect(browser.pushes).toStrictEqual([
      "/p/alpha?all=1",
      "/p/alpha/w/w-1?all=1",
    ]);
    expect(textsOf(root(), '.wave-strip a[aria-current="page"]')).toStrictEqual(
      ["w-1"],
    );
    app.stop();
  });

  it("shows the wave the route names, from the one listing", async () => {
    const fetchImpl = fetchStub(answering(projectCard()));
    const { app } = harness({ pathname: "/p/alpha/w/w-2", fetchImpl });
    app.start();
    await flush();

    expect(textsOf(root(), '.wave-strip a[aria-current="page"]')).toStrictEqual(
      ["w-2"],
    );
    expect(fetchImpl.calls).toStrictEqual([
      "/api/v1/projects",
      "/api/v1/attention",
      "/api/v1/projects/alpha/lanes",
      "/api/v1/projects/alpha/status",
    ]);
    expect(textsOf(root(), '.crumbs [aria-current="page"]')).toStrictEqual([
      "w-2",
    ]);
    app.stop();
  });

  it("says a wave the project does not have, and asks for nothing more", async () => {
    const fetchImpl = fetchStub(answering(projectCard()));
    const { app } = harness({ pathname: "/p/alpha/w/w-9", fetchImpl });
    app.start();
    await flush();

    expect(textsOf(root(), ".empty")).toStrictEqual([
      "No such wave in this project.",
    ]);
    expect(fetchImpl.calls).not.toContain("/api/v1/projects/alpha/waves/w-3");
    expect(lanesAskedFor(fetchImpl.calls)).toStrictEqual([
      "/api/v1/projects/alpha/lanes",
    ]);
    app.stop();
  });

  it("starts with the waves past retention when the query says all=1", async () => {
    const { app } = harness({ pathname: "/p/alpha", search: "?all=1" });
    app.start();
    await flush();

    expect(textsOf(root(), ".wave-strip li a")).toStrictEqual([
      "all lanes",
      "w-3",
      "w-2",
      "w-1",
    ]);
    app.stop();
  });

  it("keeps the query when the toggle has not been used", async () => {
    const { app, browser } = harness({
      pathname: "/p/alpha",
      search: "?reason=gate",
    });
    app.start();
    await flush();

    (root().querySelectorAll(".wave-strip li a")[2] as HTMLElement).click();
    await flush();

    expect(browser.pushes).toStrictEqual(["/p/alpha/w/w-2?reason=gate"]);
    app.stop();
  });
});

describe("what a change of the address asks for", () => {
  /** One project's whole answer, with a seat and a stage to filter on. */
  function seated(path: string): Answer {
    if (path === "/api/v1/projects") {
      return { status: 200, body: PROJECTS };
    }
    if (path === "/api/v1/attention") {
      return { status: 200, body: attentionView() };
    }
    // No status: a listing is not a status, and the panel would rather be absent
    // than drawn from something the page cannot read.
    if (/\/status$/.test(path)) {
      return { status: 404 };
    }
    return {
      status: 200,
      body: projectLanes({
        waves: [waveSummary({ wave: "w-3" })],
        lanes: [
          laneRow({ id: "wv-a", seat: "s1" }),
          laneRow({ id: "wv-b", seat: "s2" }),
        ],
      }),
    };
  }

  it("narrows to the seat a reader picks, and asks for nothing", async () => {
    const fetchImpl = fetchStub(seated);
    const { app, browser } = harness({ pathname: "/p/alpha", fetchImpl });
    app.start();
    await flush();
    fetchImpl.calls.length = 0;

    const select = root().querySelector("#filter-seat") as HTMLSelectElement;
    select.value = "s2";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    // Synchronously: a filter is a question the answer in hand can answer.
    expect(browser.pushes).toStrictEqual(["/p/alpha?seat=s2"]);
    expect(fetchImpl.calls).toStrictEqual([]);
    expect(textsOf(root(), "tbody tr")).toHaveLength(1);
    expect(textsOf(root(), "td[data-label='Lane'] a")).toStrictEqual(["wv-b"]);

    await flush();
    expect(fetchImpl.calls).toStrictEqual([]);
    app.stop();
  });

  it("replaces the address as the reader types, and never pushes", async () => {
    const fetchImpl = fetchStub(seated);
    const { app, browser } = harness({ pathname: "/p/alpha", fetchImpl });
    app.start();
    await flush();
    fetchImpl.calls.length = 0;

    const input = root().querySelector("#filter-q") as HTMLInputElement;
    for (const text of ["s", "s1", "s2"]) {
      input.value = text;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    // One entry per keystroke would be one entry per letter of every word a
    // reader ever searched for, between the page they came from and the page
    // they are on — so the address is written over, not pushed onto.
    expect(browser.replaces).toStrictEqual([
      "/p/alpha?q=s",
      "/p/alpha?q=s1",
      "/p/alpha?q=s2",
    ]);
    expect(browser.pushes).toStrictEqual([]);
    expect(fetchImpl.calls).toStrictEqual([]);
    expect(textsOf(root(), "tbody tr")).toHaveLength(1);
    app.stop();
  });

  it("clears the search out of the address when the box is emptied", async () => {
    const fetchImpl = fetchStub(seated);
    const { app, browser } = harness({
      pathname: "/p/alpha",
      search: "?q=s1",
      fetchImpl,
    });
    app.start();
    await flush();
    fetchImpl.calls.length = 0;
    expect((root().querySelector("#filter-q") as HTMLInputElement).value).toBe(
      "s1",
    );

    const input = root().querySelector("#filter-q") as HTMLInputElement;
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(browser.replaces).toStrictEqual(["/p/alpha"]);
    expect(fetchImpl.calls).toStrictEqual([]);
    expect(textsOf(root(), "tbody tr")).toHaveLength(2);
    app.stop();
  });

  it("puts the search text back in the box it was typed in", async () => {
    const fetchImpl = fetchStub(seated);
    const { app } = harness({ pathname: "/p/alpha", fetchImpl });
    app.start();
    await flush();

    const input = root().querySelector("#filter-q") as HTMLInputElement;
    input.value = "s1";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();

    const after = root().querySelector("#filter-q") as HTMLInputElement;
    expect(after).not.toBe(input);
    expect(after.value).toBe("s1");
    app.stop();
  });

  it("asks again for the waves past retention, which are other lanes", async () => {
    const fetchImpl = fetchStub(answering(projectCard()));
    const { app, browser } = harness({ pathname: "/p/alpha", fetchImpl });
    app.start();
    await flush();
    fetchImpl.calls.length = 0;

    (root().querySelector(".wave-strip > a") as HTMLElement).click();
    expect(browser.pushes).toStrictEqual(["/p/alpha?all=1"]);

    await flush();
    expect(lanesAskedFor(fetchImpl.calls)).toStrictEqual([
      "/api/v1/projects/alpha/lanes?all=1",
    ]);
    app.stop();
  });

  it("asks again for another project, which is another listing", async () => {
    const fetchImpl = fetchStub(perProject);
    const { app } = harness({ pathname: "/p/alpha", fetchImpl });
    app.start();
    await flush();
    fetchImpl.calls.length = 0;

    app.navigate("/p/beta");
    expect(textsOf(root(), ".empty")).toStrictEqual(["Loading…"]);

    await flush();
    expect(lanesAskedFor(fetchImpl.calls)).toStrictEqual([
      "/api/v1/projects/beta/lanes",
    ]);
    expect(textsOf(root(), "tbody tr")).toHaveLength(2);
    app.stop();
  });

  it("draws a pass that was already in flight when the filter changed", async () => {
    // The pass answers the same project under the same `all`, so a filter change
    // in the middle of it does not supersede it: the rows it brings are drawn,
    // filtered by what the reader has asked for since.
    let lanes = 0;
    let later = false;
    const gate = gatedFetch((path) => {
      const answer = seated(path);
      if (
        answer.status !== 200 ||
        path === "/api/v1/projects" ||
        path === "/api/v1/attention"
      ) {
        return { ...answer, hold: false };
      }
      lanes += 1;
      return {
        ...answer,
        body: projectLanes({
          waves: [waveSummary({ wave: "w-3" })],
          lanes: [
            laneRow({ id: later ? "wv-c" : "wv-a", seat: later ? "s3" : "s1" }),
          ],
        }),
        hold: lanes === 2,
      };
    });
    const { app, timers } = harness({ pathname: "/p/alpha", fetchImpl: gate });
    app.start();
    await flush();
    expect(textsOf(root(), "tbody tr")).toHaveLength(1);

    later = true;
    timers.runLast();
    await flush();
    expect(gate.pending()).toBe(1);

    const input = root().querySelector("#filter-q") as HTMLInputElement;
    input.value = "s3";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    // The rows on screen are still the old ones, and the filter is on top of
    // them: nothing matched, and nothing was asked for.
    expect(textsOf(root(), ".empty")).toStrictEqual(["No lanes match."]);

    gate.release();
    await flush();

    expect(textsOf(root(), "tbody tr")).toHaveLength(1);
    expect(textsOf(root(), "td[data-label='Lane'] a")).toStrictEqual(["wv-c"]);
    expect(textsOf(root(), ".toolbar .shown")).toStrictEqual(["1 of 1 shown"]);
    app.stop();
  });

  it("keeps the reader's own query on the link that chose a filter", async () => {
    const fetchImpl = fetchStub(seated);
    const { app, browser } = harness({
      pathname: "/p/alpha",
      search: "?all=1&lane=wv-a",
      fetchImpl,
    });
    app.start();
    await flush();

    const select = root().querySelector("#filter-seat") as HTMLSelectElement;
    select.value = "s2";
    select.dispatchEvent(new Event("change", { bubbles: true }));

    // The lane is not carried: a lane id names a lane of one wave, and a filter
    // that changed the scope cannot mean it still.
    expect(browser.pushes).toStrictEqual(["/p/alpha?seat=s2&all=1"]);
    app.stop();
  });
});

describe("the / key", () => {
  /** A keydown on the document, the way a reader's own would arrive. */
  function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...init,
    });
    document.dispatchEvent(event);
    return event;
  }

  const onProject = async (): Promise<ReturnType<typeof harness>> => {
    const started = harness({ pathname: "/p/alpha" });
    started.app.start();
    await flush();
    return started;
  };

  it("goes to the search box, and keeps the slash out of the address", async () => {
    const { app } = await onProject();
    expect(document.activeElement).toBe(document.body);

    const event = press("/");

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(root().querySelector("#filter-q"));
    app.stop();
  });

  it("takes a slash typed with Shift, as some keyboard layouts type it", async () => {
    const { app } = await onProject();
    const event = press("/", { shiftKey: true });
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(root().querySelector("#filter-q"));
    app.stop();
  });

  it.each(["metaKey", "ctrlKey", "altKey"] as const)(
    "leaves a %s slash to the browser",
    async (modifier) => {
      const { app } = await onProject();
      const event = press("/", { [modifier]: true });
      expect(event.defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(document.body);
      app.stop();
    },
  );

  it("leaves a slash alone in the box it is being typed into", async () => {
    const { app } = await onProject();
    const input = root().querySelector("#filter-q") as HTMLInputElement;
    input.focus();

    const event = press("/");

    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(input);
    app.stop();
  });

  it("leaves a slash alone in a select the reader is choosing from", async () => {
    const { app } = await onProject();
    const select = root().querySelector("#filter-seat") as HTMLSelectElement;
    select.focus();

    const event = press("/");

    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(select);
    app.stop();
  });

  it("does nothing on a page with no search box", async () => {
    // A project with no lanes in scope draws no toolbar, and so no search box:
    // the fleet's is the other one on the page.
    const fetchImpl = fetchStub((path) =>
      path === "/api/v1/projects"
        ? { status: 200, body: [projectCard()] }
        : path === "/api/v1/attention"
          ? { status: 200, body: attentionView() }
          : /\/status$/.test(path)
            ? { status: 404 }
            : { status: 200, body: projectLanes({ lanes: [], waves: [] }) },
    );
    const { app } = harness({ pathname: "/p/alpha", fetchImpl });
    app.start();
    await flush();
    expect(root().querySelector("#filter-q")).toBeNull();
    expect(root().querySelector("#fleet-q")).toBeNull();

    const event = press("/");

    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(document.body);
    app.stop();
  });

  it("does nothing for any other key", async () => {
    const { app } = await onProject();
    const event = press("s");
    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(document.body);
    app.stop();
  });

  it("is gone once the app is stopped", async () => {
    const { app } = await onProject();
    app.stop();

    const event = press("/");

    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(document.body);
    app.stop();
  });
});

describe("the fleet's own filters", () => {
  /** The rows' names, in the order the page drew them. */
  function names(): string[] {
    return textsOf(root(), ".row-head h3");
  }

  /** The rows' disclosures, in the order the page drew them. */
  function rows(): HTMLDetailsElement[] {
    return Array.from(
      root().querySelectorAll("details.project-row"),
    ) as HTMLDetailsElement[];
  }

  /** The tab at the reader's own place in the nav. */
  function tab(name: string): HTMLElement {
    const link = Array.from(root().querySelectorAll(".fleet-tabs a")).find(
      (anchor) => textOf(anchor) === name,
    );
    expect(link).toBeDefined();
    return link as HTMLElement;
  }

  /**
   * Booted and settled on whatever route it is asked for, with the fleet's two
   * reads and one project's lanes behind it, and with the call log emptied: a
   * test here is about what a change of the address asks for.
   */
  async function onFleet(
    pathname = "/",
    search = "",
  ): Promise<ReturnType<typeof harness> & { readonly fetchImpl: FetchStub }> {
    const fetchImpl = fetchStub(
      answering(
        projectCard(),
        projectCard({ id: "beta", name: "Beta", stale: true }),
      ),
    );
    const started = harness({ pathname, search, fetchImpl });
    started.app.start();
    await flush();
    fetchImpl.calls.length = 0;
    return { ...started, fetchImpl };
  }

  it("redraws the fleet on a tab change and asks for nothing", async () => {
    const { app, browser, fetchImpl } = await onFleet();
    expect(names()).toStrictEqual(["Alpha", "Beta"]);

    tab("Flagged").click();

    expect(browser.pushes).toStrictEqual(["/?tab=flagged"]);
    expect(fetchImpl.calls).toStrictEqual([]);
    expect(textsOf(root(), ".fleet-projects .empty")).toStrictEqual([
      "No project matches.",
    ]);

    // Synchronously, because the answer in hand is the answer to this question.
    tab("Quiet").click();
    expect(browser.pushes).toStrictEqual(["/?tab=flagged", "/?tab=quiet"]);
    expect(names()).toStrictEqual(["Alpha", "Beta"]);
    expect(textsOf(root(), ".fleet-tabs a[aria-current]")).toStrictEqual([
      "Quiet",
    ]);
    // The count sits beside its tab, so the link's own name stays the name of
    // the filter.
    expect(
      textOf(
        root().querySelector(".fleet-tabs a[aria-current]")
          ?.nextElementSibling as Element,
      ),
    ).toBe("2");

    await flush();
    expect(fetchImpl.calls).toStrictEqual([]);
    app.stop();
  });

  it("redraws the fleet on a keystroke and asks for nothing", async () => {
    const { app, browser, fetchImpl } = await onFleet();
    const input = root().querySelector("#fleet-q") as HTMLInputElement;
    input.value = "BETA";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(browser.replaces).toStrictEqual(["/?q=BETA"]);
    expect(fetchImpl.calls).toStrictEqual([]);
    expect(names()).toStrictEqual(["Beta"]);

    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(browser.replaces).toStrictEqual(["/?q=BETA", "/"]);
    expect(names()).toStrictEqual(["Alpha", "Beta"]);

    await flush();
    expect(fetchImpl.calls).toStrictEqual([]);
    app.stop();
  });

  it("keeps a tab across a keystroke, and a keystroke across a tab", async () => {
    const { app, browser, fetchImpl } = await onFleet();
    const flagged = tab("Flagged");
    flagged.click();
    const input = root().querySelector("#fleet-q") as HTMLInputElement;
    input.value = "beta";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(browser.replaces).toStrictEqual(["/?tab=flagged&q=beta"]);
    tab("Active").click();
    expect(browser.pushes).toStrictEqual([
      "/?tab=flagged",
      "/?tab=active&q=beta",
    ]);
    expect(fetchImpl.calls).toStrictEqual([]);
    app.stop();
  });

  it("asks again for a project, which is another listing", async () => {
    const { app, fetchImpl } = await onFleet();
    (root().querySelector(".row-head h3 a") as HTMLElement).click();
    expect(textsOf(root(), ".empty")).toStrictEqual(["Loading…"]);

    await flush();
    expect(lanesAskedFor(fetchImpl.calls)).toStrictEqual([
      "/api/v1/projects/alpha/lanes",
    ]);
    app.stop();
  });

  it("carries no tab into a project's page, or into any link it draws", async () => {
    const { app } = await onFleet("/p/alpha", "?tab=flagged");
    expect(app.route).toStrictEqual({ kind: "project", id: "alpha" });
    for (const anchor of Array.from(root().querySelectorAll("a[href]"))) {
      expect(anchor.getAttribute("href")).not.toContain("tab");
    }

    // Nor after the reader has chosen a filter there, whose links are written
    // from the same query.
    const input = root().querySelector("#filter-q") as HTMLInputElement;
    input.value = "wv";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();

    for (const anchor of Array.from(root().querySelectorAll("a[href]"))) {
      expect(anchor.getAttribute("href")).not.toContain("tab");
    }
    expect(textsOf(root(), "a[href]").length).toBeGreaterThan(0);
    app.stop();
  });

  it("keeps an open row open across a refresh pass and a tab change", async () => {
    const { app, timers } = await onFleet();
    (rows()[0] as HTMLDetailsElement).open = true;
    await flush();
    expect(rows().map((row) => row.open)).toStrictEqual([true, false]);

    timers.runLast();
    await flush();
    expect(rows().map((row) => row.open)).toStrictEqual([true, false]);

    tab("Quiet").click();
    await flush();
    expect(rows().map((row) => row.open)).toStrictEqual([true, false]);

    // And the reader can still close it: the set follows them both ways.
    (rows()[0] as HTMLDetailsElement).open = false;
    await flush();
    expect(rows().map((row) => row.open)).toStrictEqual([false, false]);
    app.stop();
  });

  it("hears nothing from a row this page did not key", async () => {
    const { app } = await onFleet();
    const stray = document.createElement("details");
    stray.setAttribute("class", "project-row");
    stray.append(document.createElement("summary"));
    root().append(stray);
    stray.open = true;
    await flush();

    await app.refresh();

    expect(rows().map((row) => row.open)).toStrictEqual([false, false]);
    app.stop();
  });

  it("treats a summary whose repository is not a string as a failed load", async () => {
    // The fleet's search lowercases `repo`, so a summary carrying a number here
    // would throw inside a draw — and every address the reader might type reaches
    // a search. The shape check refuses the answer instead, and a refused answer
    // is a failed load: the offline note, and the last good answer left alone.
    const fetchImpl = fetchStub((path) =>
      path === "/api/v1/projects"
        ? { status: 200, body: [{ ...projectCard(), repo: 42 }] }
        : path === "/api/v1/attention"
          ? { status: 200, body: attentionView() }
          : { status: 404 },
    );
    for (const search of ["", "?q=alpha", "?q=git", "?tab=flagged"]) {
      const { app } = harness({ pathname: "/", search, fetchImpl });
      app.start();
      await flush();

      expect(textsOf(root(), ".note")).toStrictEqual(["offline, retrying"]);
      expect(root().querySelectorAll(".project")).toHaveLength(0);
      app.stop();
    }
  });

  it("goes to the fleet's own search box on a slash", async () => {
    const { app } = await onFleet();
    expect(document.activeElement).toBe(document.body);

    const event = new KeyboardEvent("keydown", {
      key: "/",
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(root().querySelector("#fleet-q"));
    app.stop();
  });

  it("puts the caret back in the fleet's search box after a keystroke", async () => {
    const { app } = await onFleet();
    const input = root().querySelector("#fleet-q") as HTMLInputElement;
    input.focus();
    input.value = "alph";
    input.setSelectionRange(3, 3);
    input.dispatchEvent(new Event("input", { bubbles: true }));

    const after = root().querySelector("#fleet-q") as HTMLInputElement;
    expect(after).not.toBe(input);
    expect(after.value).toBe("alph");
    expect(document.activeElement).toBe(after);
    expect(after.selectionStart).toBe(3);
    app.stop();
  });
});

describe("the projects menu", () => {
  /** The shell's own `details`, which is the only one the menu draws. */
  function menu(): HTMLDetailsElement {
    return root().querySelector("details.menu") as HTMLDetailsElement;
  }

  function summary(): HTMLElement {
    return root().querySelector("details.menu > summary") as HTMLElement;
  }

  /** A keydown on the document, the way a reader's own would arrive. */
  function press(key: string): KeyboardEvent {
    const event = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);
    return event;
  }

  /** Booted on the fleet page with two projects, and settled. */
  async function onFleet(): Promise<ReturnType<typeof harness>> {
    const started = harness({
      pathname: "/",
      fetchImpl: fetchStub(
        answering(projectCard(), projectCard({ id: "beta", name: "Beta" })),
      ),
    });
    started.app.start();
    await flush();
    return started;
  }

  it("is shut until the reader opens it", async () => {
    const { app } = await onFleet();
    expect(menu().open).toBe(false);
    app.stop();
  });

  it("stays open across a refresh pass, the way the reader left it", async () => {
    const { app } = await onFleet();
    menu().open = true;

    await app.refresh();

    expect(menu().open).toBe(true);
    app.stop();
  });

  it("stays shut across a refresh pass once the reader has shut it", async () => {
    const { app } = await onFleet();
    menu().open = true;
    menu().open = false;

    await app.refresh();

    expect(menu().open).toBe(false);
    app.stop();
  });

  it("ignores a toggle from another details element on the page", async () => {
    const { app } = await onFleet();
    const stray = document.createElement("details");
    stray.setAttribute("class", "elsewhere");
    root().append(stray);

    stray.open = true;

    expect(menu().open).toBe(false);
    await app.refresh();
    expect(menu().open).toBe(false);
    app.stop();
  });

  it("ignores a toggle from something that is not a details element", async () => {
    const { app } = await onFleet();
    root()
      .querySelector(".menu-list")
      ?.dispatchEvent(new Event("toggle", { bubbles: true }));

    await app.refresh();

    expect(menu().open).toBe(false);
    app.stop();
  });

  it("closes on the project the reader picked from it, in one push", async () => {
    const { app, browser } = await onFleet();
    menu().open = true;

    (
      root().querySelectorAll(".menu-list .projects a")[1] as HTMLElement
    ).click();
    await flush();

    expect(browser.pushes).toStrictEqual(["/p/beta"]);
    expect(app.route).toStrictEqual({ kind: "project", id: "beta" });
    expect(menu().open).toBe(false);
    app.stop();
  });

  it("closes on Back, which no click inside or outside it explains", async () => {
    const { app, browser } = harness({ pathname: "/p/alpha" });
    app.start();
    await flush();
    menu().open = true;

    browser.location.search = "?reason=gate";
    browser.popstate();

    expect(menu().open).toBe(false);
    app.stop();
  });

  it("leaves an Escape that something else already took", async () => {
    const { app } = await onFleet();
    menu().open = true;
    const takeIt = (event: Event): void => {
      event.preventDefault();
    };
    document.addEventListener("keydown", takeIt, true);

    press("Escape");

    document.removeEventListener("keydown", takeIt, true);
    expect(menu().open).toBe(true);
    expect(document.activeElement).toBe(document.body);
    app.stop();
  });

  it("leaves the focus on the new summary after a refresh pass", async () => {
    const { app } = await onFleet();
    summary().focus();

    await app.refresh();

    expect(document.activeElement).toBe(summary());
    app.stop();
  });

  it("closes on Escape, and hands the focus back to the summary", async () => {
    const { app, browser } = await onFleet();
    menu().open = true;
    expect(document.activeElement).toBe(document.body);

    press("Escape");

    expect(menu().open).toBe(false);
    expect(document.activeElement).toBe(summary());
    expect(browser.pushes).toStrictEqual([]);
    app.stop();
  });

  it("leaves Escape alone with the menu shut, and the slash to the search box", async () => {
    const { app } = harness({ pathname: "/p/alpha" });
    app.start();
    await flush();
    expect(menu().open).toBe(false);

    press("Escape");

    expect(document.activeElement).toBe(document.body);
    expect(menu().open).toBe(false);

    press("/");

    expect(document.activeElement).toBe(root().querySelector("#filter-q"));
    app.stop();
  });

  it("closes on a click outside it", async () => {
    const { app } = await onFleet();
    menu().open = true;
    const heading = root().querySelector("h1") as HTMLElement;

    heading.click();

    expect(menu().open).toBe(false);
    // Shut in place: the page the click landed on is still the page on screen.
    expect(heading.isConnected).toBe(true);
    await app.refresh();
    expect(menu().open).toBe(false);
    app.stop();
  });

  it("shuts when the reader picks the page already on screen", async () => {
    const { app, browser } = harness({ pathname: "/p/alpha" });
    app.start();
    await flush();
    menu().open = true;
    const here = Array.from(root().querySelectorAll(".menu-list a")).find(
      (anchor) => anchor.getAttribute("href") === "/p/alpha",
    ) as HTMLElement;

    here.click();

    expect(menu().open).toBe(false);
    expect(browser.pushes).toStrictEqual([]);
    await app.refresh();
    expect(menu().open).toBe(false);
    app.stop();
  });

  it("stays open for a click inside it that is not a link", async () => {
    const { app } = await onFleet();
    menu().open = true;

    (root().querySelector(".menu-list .projects small") as HTMLElement).click();

    expect(menu().open).toBe(true);
    app.stop();
  });

  it("closes on a click on a link outside it, and follows that link", async () => {
    const { app, browser } = await onFleet();
    menu().open = true;

    (root().querySelector(".row-head h3 a") as HTMLElement).click();
    await flush();

    expect(menu().open).toBe(false);
    expect(browser.pushes).toStrictEqual(["/p/alpha"]);
    app.stop();
  });

  it("hears nothing once the app is stopped", async () => {
    const { app } = await onFleet();
    app.stop();

    menu().open = true;
    await app.refresh();

    expect(menu().open).toBe(false);
  });

  it("does not close on Escape once the app is stopped", async () => {
    const { app } = await onFleet();
    menu().open = true;
    app.stop();

    press("Escape");

    expect(document.activeElement).toBe(document.body);
  });
});

describe("the rail across a navigation", () => {
  it("keeps listing the projects while the next route loads", async () => {
    const gate = holding(perProject, (path) => path.endsWith("/alpha/lanes"));
    const { app } = harness({ pathname: "/", fetchImpl: gate });
    app.start();
    await flush();
    expect(textsOf(root(), ".projects a")).toStrictEqual(["Alpha", "Beta"]);

    app.navigate("/p/alpha");
    // Synchronously: the rail has not gone back to saying it is loading.
    expect(textsOf(root(), ".projects a")).toStrictEqual(["Alpha", "Beta"]);

    gate.release();
    await flush();
    expect(textsOf(root(), ".projects a")).toStrictEqual(["Alpha", "Beta"]);
    app.stop();
  });

  it("keeps the last good list on a route that is not a page of its own", async () => {
    const gate = holding(perProject, () => false);
    const { app } = harness({ pathname: "/", fetchImpl: gate });
    app.start();
    await flush();
    expect(textsOf(root(), ".projects a")).toStrictEqual(["Alpha", "Beta"]);
    const before = gate.calls.length;

    app.navigate("/nope");
    expect(textsOf(root(), ".projects a")).toStrictEqual(["Alpha", "Beta"]);
    await flush();

    // Not a page, so nothing for the body, and the rail's two lists: the reader
    // still has to be able to get to a project from a page that is not there.
    expect(gate.calls.slice(before)).toStrictEqual([
      "/api/v1/projects",
      "/api/v1/attention",
    ]);
    expect(textsOf(root(), ".projects a")).toStrictEqual(["Alpha", "Beta"]);
    expect(textsOf(root(), ".empty")).toStrictEqual(["No such page."]);
    app.stop();
  });

  it("narrows to the wave the reader picks, and asks for nothing", async () => {
    const fetchImpl = fetchStub(perProject);
    const { app, browser } = harness({ pathname: "/p/alpha", fetchImpl });
    app.start();
    await flush();
    expect(textsOf(root(), ".wave-strip li a")).toStrictEqual([
      "all lanes",
      "a-3",
      "a-2",
    ]);
    expect(textsOf(root(), "tbody tr")).toHaveLength(2);
    fetchImpl.calls.length = 0;

    (root().querySelectorAll(".wave-strip li a")[2] as HTMLElement).click();
    // Synchronously: what a pass requests depends on the project and on `all`,
    // and a wave is neither — so the table is narrowed from the answer already
    // held, and never replaced by a bare "Loading…".
    expect(browser.pushes).toStrictEqual(["/p/alpha/w/a-2"]);
    expect(fetchImpl.calls).toStrictEqual([]);
    expect(textsOf(root(), '.wave-strip a[aria-current="page"]')).toStrictEqual(
      ["a-2"],
    );
    expect(textsOf(root(), "tbody tr")).toHaveLength(1);
    expect(root().querySelectorAll(".note")).toHaveLength(0);

    // And no pass is started behind it either: there is nothing to ask for.
    await flush();
    expect(fetchImpl.calls).toStrictEqual([]);
    expect(textsOf(root(), "tbody tr")).toHaveLength(1);
    app.stop();
  });
});

describe("stopping", () => {
  it("removes the click listener and the popstate listener", async () => {
    const { app, browser } = harness({ pathname: "/" });
    app.start();
    await flush();
    expect(browser.popstates).toBe(1);

    app.stop();
    expect(browser.popstates).toBe(0);

    (root().querySelectorAll(".projects a")[0] as HTMLElement).click();
    browser.location.pathname = "/p/alpha";
    browser.popstate();
    await flush();

    expect(browser.pushes).toStrictEqual([]);
  });

  it("leaves no page load behind for an anchor the test only looks at", async () => {
    noNavigation();
    const { app } = harness({ pathname: "/" });
    app.start();
    await flush();
    const anchor = root().querySelectorAll(".projects a")[0] as HTMLElement;
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    anchor.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    app.stop();
  });
});

describe("what the reader is told", () => {
  it("titles the page after the wave route's project", async () => {
    const { app } = harness({ pathname: "/p/alpha/w/w-2" });
    app.start();
    await flush();
    expect(document.title).toBe("waves — alpha");
    expect(textOf(root().querySelector(".crumbs") as Element)).toBe(
      "waves / alpha / w-2",
    );
    app.stop();
  });
});

describe("the inbox route", () => {
  it("boots on /inbox and draws the inbox", async () => {
    const fetchImpl = fetchStub(
      answering(projectCard(), projectCard({ id: "beta", name: "Beta" })),
    );
    const { app } = harness({ pathname: "/inbox", fetchImpl });
    app.start();
    await flush();

    expect(app.route).toStrictEqual({ kind: "inbox" });
    expect(textsOf(root(), "h1")).toStrictEqual(["Inbox"]);
    // The totals line is all zeroes: the stubbed inbox has no decisions.
    expect(textsOf(root(), ".inbox-totals")).toStrictEqual([
      "0 waiting (0 one-way doors) · 0 reported · 0 closed by a session",
    ]);
    // The menu still lists every project.
    expect(textsOf(root(), ".projects a")).toStrictEqual(["Alpha", "Beta"]);
    app.stop();
  });

  it("fetches the inbox alongside the rail's two lists", async () => {
    const fetchImpl = fetchStub(
      answering(projectCard(), projectCard({ id: "beta", name: "Beta" })),
    );
    const { app } = harness({ pathname: "/inbox", fetchImpl });
    app.start();
    await flush();

    expect(fetchImpl.calls).toStrictEqual([
      "/api/v1/projects",
      "/api/v1/attention",
      "/api/v1/inbox",
    ]);
    app.stop();
  });

  it("navigates from the fleet to the inbox", async () => {
    const fetchImpl = fetchStub(
      answering(projectCard(), projectCard({ id: "beta", name: "Beta" })),
    );
    const { app, browser } = harness({ pathname: "/", fetchImpl });
    app.start();
    await flush();

    app.navigate("/inbox");
    await flush();

    expect(browser.pushes).toStrictEqual(["/inbox"]);
    expect(app.route).toStrictEqual({ kind: "inbox" });
    expect(textsOf(root(), ".inbox-totals")).toStrictEqual([
      "0 waiting (0 one-way doors) · 0 reported · 0 closed by a session",
    ]);
    app.stop();
  });

  it("names the inbox in the breadcrumb and marks it current", async () => {
    const { app } = harness({ pathname: "/inbox" });
    app.start();
    await flush();

    expect(textOf(root().querySelector(".crumbs") as Element)).toBe(
      "waves / Inbox",
    );
    expect(
      textOf(root().querySelector('.crumbs [aria-current="page"]') as Element),
    ).toBe("Inbox");
    app.stop();
  });

  it("reads nothing from the query string on the inbox route", async () => {
    const { app } = harness({ pathname: "/inbox", search: "?q=leak" });
    app.start();
    await flush();

    expect(app.route).toStrictEqual({ kind: "inbox" });
    expect(document.body.textContent ?? "").not.toContain("leak");
    app.stop();
  });
});

describe("the decision route", () => {
  /** A fetch stub that answers the rail's two lists and one decision. */
  function decisionFetch(body: unknown) {
    return fetchStub((path) =>
      path === "/api/v1/projects"
        ? { status: 200, body: [projectCard()] }
        : path === "/api/v1/attention"
          ? { status: 200, body: attentionView() }
          : path === "/api/v1/projects/alpha/decisions/d1"
            ? body === undefined
              ? { status: 404 }
              : { status: 200, body }
            : { status: 404 },
    );
  }

  it("boots on the decision page and draws the decision", async () => {
    const fetchImpl = decisionFetch(decisionResponse());
    const { app } = harness({ pathname: "/p/alpha/d/d1", fetchImpl });
    app.start();
    await flush();

    expect(app.route).toStrictEqual({
      kind: "decision",
      project: "alpha",
      id: "d1",
    });
    expect(textsOf(root(), "h1")).toStrictEqual(["Go?"]);
    expect(fetchImpl.calls).toStrictEqual([
      "/api/v1/projects",
      "/api/v1/attention",
      "/api/v1/projects/alpha/decisions/d1",
    ]);
    app.stop();
  });

  it("says No such decision for a 404", async () => {
    const fetchImpl = decisionFetch(undefined);
    const { app } = harness({ pathname: "/p/alpha/d/d1", fetchImpl });
    app.start();
    await flush();

    expect(app.route).toStrictEqual({
      kind: "decision",
      project: "alpha",
      id: "d1",
    });
    expect(textsOf(root(), ".empty")).toStrictEqual(["No such decision."]);
    app.stop();
  });

  it("shows offline for a 200 with an unusable body", async () => {
    const bad = {
      ...decisionResponse(),
      head: { ...inboxHead(), project: "beta" },
    };
    const fetchImpl = decisionFetch(bad);
    const { app } = harness({ pathname: "/p/alpha/d/d1", fetchImpl });
    app.start();
    await flush();

    expect(app.route).toStrictEqual({
      kind: "decision",
      project: "alpha",
      id: "d1",
    });
    expect(textsOf(root(), ".note")).toStrictEqual(["offline, retrying"]);
    app.stop();
  });

  it("names the project in the breadcrumb and title", async () => {
    const { app } = harness({
      pathname: "/p/alpha/d/d1",
      fetchImpl: decisionFetch(decisionResponse()),
    });
    app.start();
    await flush();

    expect(document.title).toBe("waves — alpha");
    expect(textOf(root().querySelector(".crumbs") as Element)).toBe(
      "waves / alpha / d1",
    );
    app.stop();
  });

  it("navigates to another route while a decision load is in flight", async () => {
    const decisionFetch = (path: string): Answer =>
      path === "/api/v1/projects"
        ? { status: 200, body: [projectCard()] }
        : path === "/api/v1/attention"
          ? { status: 200, body: attentionView() }
          : path === "/api/v1/projects/alpha/decisions/d1"
            ? { status: 200, body: decisionResponse() }
            : { status: 404 };
    const gate = holding(
      decisionFetch,
      (path) => path === "/api/v1/projects/alpha/decisions/d1",
    );
    const { app } = harness({
      pathname: "/p/alpha/d/d1",
      fetchImpl: gate,
    });
    app.start();
    await flush();
    expect(gate.pending()).toBe(1);

    app.navigate("/");
    gate.release();
    await flush();

    expect(app.route).toStrictEqual({ kind: "projects" });
    expect(textsOf(root(), ".projects a")).toStrictEqual(["Alpha"]);
    app.stop();
  });
});

describe("the project-inbox route", () => {
  /** A fetch stub that answers the rail's two lists and one project's decisions. */
  function projectInboxFetch(body: unknown) {
    return fetchStub((path) =>
      path === "/api/v1/projects"
        ? {
            status: 200,
            body: [projectCard(), projectCard({ id: "beta", name: "Beta" })],
          }
        : path === "/api/v1/attention"
          ? { status: 200, body: attentionView() }
          : path === "/api/v1/projects/alpha/decisions"
            ? body === undefined
              ? { status: 404 }
              : { status: 200, body }
            : { status: 404 },
    );
  }

  it("boots on /p/alpha/inbox and draws the project inbox", async () => {
    const fetchImpl = projectInboxFetch(projectInboxView());
    const { app } = harness({ pathname: "/p/alpha/inbox", fetchImpl });
    app.start();
    await flush();

    expect(app.route).toStrictEqual({
      kind: "project-inbox",
      project: "alpha",
    });
    expect(textsOf(root(), ".project-inbox h1")).toStrictEqual([
      "Alpha · decisions",
    ]);
    // The rail still lists every project.
    expect(textsOf(root(), ".projects a")).toStrictEqual(["Alpha", "Beta"]);
    app.stop();
  });

  it("fetches the project's decisions alongside the rail's two lists", async () => {
    const fetchImpl = projectInboxFetch(projectInboxView());
    const { app } = harness({ pathname: "/p/alpha/inbox", fetchImpl });
    app.start();
    await flush();

    expect(fetchImpl.calls).toStrictEqual([
      "/api/v1/projects",
      "/api/v1/attention",
      "/api/v1/projects/alpha/decisions",
    ]);
    app.stop();
  });

  it("shows No such project for a 404", async () => {
    const fetchImpl = projectInboxFetch(undefined);
    const { app } = harness({ pathname: "/p/alpha/inbox", fetchImpl });
    app.start();
    await flush();

    expect(app.route).toStrictEqual({
      kind: "project-inbox",
      project: "alpha",
    });
    expect(textsOf(root(), ".empty")).toStrictEqual(["No such project."]);
    app.stop();
  });

  it("shows offline for a 200 with an unusable body", async () => {
    const bad = {
      ...projectInboxView(),
      project: { id: "beta", name: "Beta" },
    };
    const fetchImpl = projectInboxFetch(bad);
    const { app } = harness({ pathname: "/p/alpha/inbox", fetchImpl });
    app.start();
    await flush();

    expect(app.route).toStrictEqual({
      kind: "project-inbox",
      project: "alpha",
    });
    expect(textsOf(root(), ".note")).toStrictEqual(["offline, retrying"]);
    app.stop();
  });

  it("names the project in the breadcrumb and title", async () => {
    const fetchImpl = projectInboxFetch(projectInboxView());
    const { app } = harness({ pathname: "/p/alpha/inbox", fetchImpl });
    app.start();
    await flush();

    expect(document.title).toBe("waves — alpha");
    expect(textOf(root().querySelector(".crumbs") as Element)).toBe(
      "waves / alpha / Inbox",
    );
    app.stop();
  });
});
