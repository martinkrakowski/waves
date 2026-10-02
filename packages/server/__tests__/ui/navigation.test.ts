import { describe, expect, it } from "vitest";

import type { AppGlobals } from "../../public/app.js";
import { createApp } from "../../public/app.js";
import { el, repoLink } from "../../public/dom.js";

import {
  attentionView,
  projectCard,
  waveSummary,
  waveView,
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

/** Every project's own waves name that project, so a crossed path is visible. */
const WAVE_IDS: Readonly<Record<string, readonly string[]>> = {
  alpha: ["a-3", "a-2"],
  beta: ["b-3", "b-2"],
};

const PROJECTS = [projectCard(), projectCard({ id: "beta", name: "Beta" })];

/** The rail's list, and every project's waves, so a crossed path is visible. */
function perProject(path: string): Answer {
  if (path === "/api/v1/projects") {
    return { status: 200, body: PROJECTS };
  }
  if (path === "/api/v1/attention") {
    return { status: 200, body: attentionView() };
  }
  const list = /^\/api\/v1\/projects\/([^/]+)\/waves$/.exec(path);
  if (list !== null) {
    const id = list[1] ?? "";
    return {
      status: 200,
      body: (WAVE_IDS[id] ?? []).map((wave, at) =>
        waveSummary({
          wave,
          receivedAt: `2026-04-01T${at === 0 ? "11" : "10"}:50:00.000Z`,
        }),
      ),
    };
  }
  const detail = /^\/api\/v1\/projects\/([^/]+)\/waves\/([^/]+)$/.exec(path);
  if (detail !== null) {
    return {
      status: 200,
      body: waveView({
        envelope: {
          ...waveView().envelope,
          project: detail[1] ?? "",
          wave: detail[2] ?? "",
        },
      }),
    };
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

/** The paths asked for that name one wave's detail, whichever project. */
function waveDetails(calls: readonly string[]): string[] {
  return calls.filter((path) => /\/waves\/[^/]+$/.test(path));
}

/** The rail's list, and one project's waves, whichever route the test is on. */
function answering(...projects: unknown[]): (path: string) => Answer {
  const waves = [
    waveSummary({ wave: "w-3" }),
    waveSummary({ wave: "w-2", receivedAt: "2026-04-01T11:50:00.000Z" }),
    waveSummary({
      wave: "w-1",
      receivedAt: "2026-04-01T11:00:00.000Z",
      retained: false,
    }),
  ];
  return (path) => {
    if (path === "/api/v1/projects") {
      return { status: 200, body: projects };
    }
    if (path === "/api/v1/attention") {
      return { status: 200, body: attentionView() };
    }
    if (/\/waves$/.test(path)) {
      return { status: 200, body: waves };
    }
    const wave = /\/waves\/([^/]+)$/.exec(path);
    if (wave !== null) {
      return {
        status: 200,
        body: waveView({
          envelope: { ...waveView().envelope, wave: wave[1] ?? "" },
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
  return { app, browser };
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
    expect(textsOf(root(), "h1 code")).toStrictEqual(["beta"]);
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

    const repo = root().querySelector("dd a");
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
    expect(textsOf(root(), "h1 code")).toStrictEqual(["beta"]);

    browser.location.pathname = "/";
    browser.location.search = "";
    browser.popstate();
    await flush();

    expect(browser.pushes).toStrictEqual(["/p/beta"]);
    expect(app.route).toStrictEqual({ kind: "projects" });
    expect(textsOf(root(), ".project-card h3 a")).toStrictEqual([
      "Alpha",
      "Beta",
    ]);
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
    expect(textsOf(root(), "h1 code")).toStrictEqual(["beta"]);
    expect(textsOf(root(), ".wave code")).toStrictEqual(["b-3", "b-2"]);
    expect(gate.calls).toContain("/api/v1/projects/beta/waves");
    expect(waveDetails(gate.calls)).toStrictEqual([
      "/api/v1/projects/beta/waves/b-3",
    ]);
    app.stop();
  });

  it("never asks the new project for a wave of the old one", async () => {
    const gate = holding(perProject, (path) => path.endsWith("/alpha/waves"));
    const { app } = harness({ pathname: "/p/alpha", fetchImpl: gate });
    app.start();
    await flush();
    expect(gate.calls).toContain("/api/v1/projects/alpha/waves");

    app.navigate("/p/beta");
    gate.release();
    await flush();

    expect(gate.calls).not.toContain("/api/v1/projects/beta/waves/a-3");
    expect(gate.calls).not.toContain("/api/v1/projects/beta/waves/a-2");
    expect(textsOf(root(), "h1 code")).toStrictEqual(["beta"]);
    expect(textsOf(root(), ".wave code")).toStrictEqual(["b-3", "b-2"]);
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
    expect(textsOf(root(), "h1 code")).toStrictEqual(["beta"]);
    expect(textsOf(root(), ".wave code")).toStrictEqual(["b-3", "b-2"]);
    expect(gate.calls).toContain("/api/v1/projects/beta/waves");
    expect(waveDetails(gate.calls)).toStrictEqual([
      "/api/v1/projects/beta/waves/b-3",
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
    expect(textsOf(root(), "h1 code")).toStrictEqual(["beta"]);
    expect(gate.calls).toContain("/api/v1/projects/beta/waves");
    app.stop();
  });
});

describe("choosing a wave", () => {
  it("navigates to that wave's own path, and keeps the query", async () => {
    const { app, browser } = harness({ pathname: "/p/alpha" });
    app.start();
    await flush();

    (root().querySelectorAll(".wave")[1] as HTMLElement).click();
    await flush();

    expect(browser.pushes).toStrictEqual(["/p/alpha/w/w-2"]);
    expect(app.route).toStrictEqual({
      kind: "project",
      id: "alpha",
      wave: "w-2",
    });
    expect(textsOf(root(), ".wave.current code")).toStrictEqual(["w-2"]);
    expect(document.title).toBe("waves — alpha");
    app.stop();
  });

  it("carries the show-all state the toggle had at the moment of the click", async () => {
    const { app, browser } = harness({ pathname: "/p/alpha" });
    app.start();
    await flush();

    (root().querySelector(".toggle") as HTMLElement).click();
    (root().querySelectorAll(".wave")[2] as HTMLElement).click();
    await flush();

    expect(browser.pushes).toStrictEqual(["/p/alpha/w/w-1?all=1"]);
    app.stop();
  });

  it("shows the wave the route names", async () => {
    const fetchImpl = fetchStub(answering(projectCard()));
    const { app } = harness({ pathname: "/p/alpha/w/w-2", fetchImpl });
    app.start();
    await flush();

    expect(textsOf(root(), ".wave.current code")).toStrictEqual(["w-2"]);
    expect(fetchImpl.calls).toStrictEqual([
      "/api/v1/projects",
      "/api/v1/attention",
      "/api/v1/projects/alpha/waves",
      "/api/v1/projects/alpha/waves/w-2",
    ]);
    expect(textsOf(root(), '.crumbs [aria-current="page"]')).toStrictEqual([
      "w-2",
    ]);
    app.stop();
  });

  it("falls back to the first wave it can show when the route names none", async () => {
    const fetchImpl = fetchStub(answering(projectCard()));
    const { app } = harness({ pathname: "/p/alpha/w/w-9", fetchImpl });
    app.start();
    await flush();

    expect(textsOf(root(), ".wave.current code")).toStrictEqual(["w-3"]);
    expect(fetchImpl.calls).toContain("/api/v1/projects/alpha/waves/w-3");
    expect(fetchImpl.calls).not.toContain("/api/v1/projects/alpha/waves/w-9");
    app.stop();
  });

  it("starts with the waves past retention when the query says all=1", async () => {
    const { app } = harness({ pathname: "/p/alpha", search: "?all=1" });
    app.start();
    await flush();

    expect(textsOf(root(), ".wave code")).toStrictEqual(["w-3", "w-2", "w-1"]);
    app.stop();
  });

  it("keeps the query when the toggle has not been used", async () => {
    const { app, browser } = harness({
      pathname: "/p/alpha",
      search: "?reason=gate",
    });
    app.start();
    await flush();

    (root().querySelectorAll(".wave")[1] as HTMLElement).click();
    await flush();

    expect(browser.pushes).toStrictEqual(["/p/alpha/w/w-2?reason=gate"]);
    app.stop();
  });
});

describe("the rail across a navigation", () => {
  it("keeps listing the projects while the next route loads", async () => {
    const gate = holding(perProject, (path) => path.endsWith("/alpha/waves"));
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

  it("says a chosen wave is loading, not gone, while its lanes cannot be read", async () => {
    const failing = holding(
      (path) =>
        path.endsWith("/waves/a-2")
          ? { status: 500, body: {} }
          : perProject(path),
      () => false,
    );
    const { app } = harness({ pathname: "/p/alpha", fetchImpl: failing });
    app.start();
    await flush();
    expect(textsOf(root(), "tbody tr")).toHaveLength(2);

    (root().querySelectorAll(".wave")[1] as HTMLElement).click();
    await flush();

    // The wave exists; the server could not answer for it. The page says so
    // once, and does not claim the wave was deleted.
    expect(textsOf(root(), ".note")).toStrictEqual(["offline, retrying"]);
    expect(textsOf(root(), ".empty")).toStrictEqual(["Loading…"]);
    expect(textsOf(root(), "tbody tr")).toHaveLength(0);
    app.stop();
  });

  it("keeps the wave list on screen while the chosen wave's lanes load", async () => {
    const gate = holding(perProject, (path) => path.endsWith("/waves/a-2"));
    const { app } = harness({ pathname: "/p/alpha", fetchImpl: gate });
    app.start();
    await flush();
    expect(textsOf(root(), ".wave code")).toStrictEqual(["a-3", "a-2"]);
    expect(textsOf(root(), "tbody tr")).toHaveLength(2);

    (root().querySelectorAll(".wave")[1] as HTMLElement).click();
    // Synchronously: the wave list has not gone back to a bare placeholder, and
    // the lane panel says it is loading, not that the wave is gone.
    expect(textsOf(root(), ".wave code")).toStrictEqual(["a-3", "a-2"]);
    expect(textsOf(root(), ".empty")).toStrictEqual(["Loading…"]);
    expect(textsOf(root(), "tbody tr")).toHaveLength(0);

    // Let the pass reach the held detail before releasing it.
    await flush();
    expect(gate.pending()).toBe(1);
    gate.release();
    await flush();

    expect(textsOf(root(), ".wave.current code")).toStrictEqual(["a-2"]);
    expect(textsOf(root(), "tbody tr")).toHaveLength(2);
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
