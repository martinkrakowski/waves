import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppGlobals } from "../../public/app.js";
import { createApp, REFRESH_MS } from "../../public/app.js";
import { clockTime } from "../../public/format.js";

import type { Answer, FetchStub, TimerStub } from "./helpers.js";
import {
  attentionView,
  laneRow,
  NOW_MS,
  projectCard,
  projectLanes,
  waveSummary,
} from "./fixtures.js";
import {
  browserGlobals,
  fetchStub,
  flush,
  freshRoot,
  gatedFetch,
  root,
  setHidden,
  textOf,
  textsOf,
  throwingFetch,
  timerStub,
  visible,
} from "./helpers.js";

interface Harness {
  readonly app: ReturnType<typeof createApp>;
  readonly timers: TimerStub;
  readonly browser: ReturnType<typeof browserGlobals>;
}

/** The only note the app ever writes, as the reader sees it. */
const OFFLINE = "offline, retrying";

function harness(options: {
  pathname?: string;
  search?: string;
  fetchImpl: FetchStub;
  withoutRoot?: boolean;
  refreshMs?: number;
  /** The app's clock. Only a test that watches time move passes its own. */
  clock?: () => number;
}): Harness {
  if (options.withoutRoot === true) {
    document.body.replaceChildren();
  } else {
    freshRoot();
  }
  const timers = timerStub();
  const browser = browserGlobals(options.pathname ?? "/", options.search ?? "");
  const app = createApp({
    doc: document,
    location: browser.location,
    history: browser.history,
    win: browser.win,
    fetch: options.fetchImpl,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    clock: options.clock ?? (() => NOW_MS),
    refreshMs: options.refreshMs ?? REFRESH_MS,
  } satisfies AppGlobals);
  return { app, timers, browser };
}

/** The fleet route's two requests, and nothing else. */
function listing(...projects: unknown[]): (path: string) => Answer {
  return (path) => {
    if (path === "/api/v1/projects") {
      return { status: 200, body: projects };
    }
    if (path === "/api/v1/attention") {
      return { status: 200, body: attentionView() };
    }
    return { status: 404 };
  };
}

/** The rail's answer on any route: one project, and nothing asking for it. */
function railAnswer(path: string): Answer | undefined {
  if (path === "/api/v1/projects") {
    return { status: 200, body: [projectCard()] };
  }
  if (path === "/api/v1/attention") {
    return { status: 200, body: attentionView() };
  }
  return undefined;
}

/** Every wave the one listing answers with, newest first, one past retention. */
const LISTING_WAVES = [
  waveSummary({ wave: "w-3" }),
  waveSummary({ wave: "w-2", receivedAt: "2026-04-01T11:50:00.000Z" }),
  waveSummary({
    wave: "w-1",
    receivedAt: "2026-04-01T11:00:00.000Z",
    retained: false,
  }),
];

/**
 * The rail's two lists on every route, and one project's lanes on a project
 * route: the whole of a project pass, in three requests, whichever wave the
 * path names and whichever query it carries.
 */
function projectListing(path: string): Answer {
  const rail = railAnswer(path);
  if (rail !== undefined) {
    return rail;
  }
  const lanes = /^\/api\/v1\/projects\/([^/]+)\/lanes(?:\?all=1)?$/.exec(path);
  if (lanes === null) {
    return { status: 404 };
  }
  const id = lanes[1] ?? "";
  return {
    status: 200,
    body: projectLanes({
      project: { id, name: id === "alpha" ? "Alpha" : "Beta" },
      waves: LISTING_WAVES,
      lanes: [laneRow(), laneRow({ id: "wv-b", wave: "w-2" })],
    }),
  };
}

/**
 * The status route, which a project may legitimately never answer: every handler
 * in this file that shadows `projectListing` says `404` here, so a test about the
 * listing is not also a test about a status the handler never wrote.
 */
function noStatus(): Answer {
  return { status: 404 };
}

afterEach(() => {
  setHidden(false);
  vi.unstubAllGlobals();
});

describe("the project list route", () => {
  it("loads the list once on start and arms a ten second timer", async () => {
    const fetchImpl = fetchStub(listing(projectCard()));
    const { app, timers } = harness({ fetchImpl });
    app.start();
    await flush();
    expect(fetchImpl.calls).toStrictEqual([
      "/api/v1/projects",
      "/api/v1/attention",
    ]);
    expect(textsOf(root(), ".row-head h3 a")).toStrictEqual(["Alpha"]);
    expect(timers.scheduled.map((entry) => entry.delayMs)).toStrictEqual([
      REFRESH_MS,
    ]);
    expect(REFRESH_MS).toBe(10_000);
    app.stop();
  });

  it("says it is loading before the first answer arrives", async () => {
    const { app } = harness({ fetchImpl: fetchStub(listing(projectCard())) });
    app.start();
    expect(textsOf(root(), ".empty")).toStrictEqual(["Loading…"]);
    await flush();
    expect(textsOf(root(), ".row-head h3 a")).toStrictEqual(["Alpha"]);
    app.stop();
  });

  it("keeps one chain when the tab is hidden and shown mid-refresh", async () => {
    // Every response is held, so a pass on the fleet route is waiting on both of
    // its requests at once: the project list and the attention view.
    const answers = listing(projectCard());
    const fetchImpl = gatedFetch(
      (path) => answers(path) ?? { status: 200, body: attentionView() },
    );
    const { app, timers } = harness({ fetchImpl });

    app.start();
    await flush();
    expect(fetchImpl.calls).toHaveLength(2);
    expect(fetchImpl.pending()).toBe(2);
    fetchImpl.release();
    await flush();
    expect(timers.scheduled).toHaveLength(1);

    timers.runLast();
    await flush();
    expect(fetchImpl.calls).toHaveLength(4);
    expect(fetchImpl.pending()).toBe(2);
    expect(timers.scheduled).toHaveLength(0);

    setHidden(true);
    visible();
    setHidden(false);
    visible();
    expect(fetchImpl.calls).toHaveLength(4);

    fetchImpl.release();
    await flush();

    expect(fetchImpl.calls).toHaveLength(4);
    expect(timers.scheduled).toHaveLength(1);
    expect(timers.scheduled[0]?.delayMs).toBe(REFRESH_MS);
    app.stop();
  });

  it("keeps refreshing when the project list comes back as not a list", async () => {
    const { app, timers } = harness({
      fetchImpl: fetchStub(() => ({ status: 404 })),
    });
    app.start();
    await flush();
    // The status region carries the note; the body still says it is loading.
    expect(textsOf(root(), ".empty")).toStrictEqual(["Loading…"]);
    expect(textOf(root().querySelector(".note"))).toBe("offline, retrying");

    timers.runLast();
    await flush();
    expect(timers.scheduled).toHaveLength(1);
    expect(textsOf(root(), ".empty")).toStrictEqual(["Loading…"]);
    expect(textOf(root().querySelector(".note"))).toBe("offline, retrying");
    app.stop();
  });

  it("says the note once, and only in the status region", async () => {
    const { app } = harness({
      fetchImpl: fetchStub(() => ({ status: 404 })),
    });
    app.start();
    await flush();
    expect(root().querySelectorAll(".note")).toHaveLength(1);
    expect(textOf(root()).split(OFFLINE).length - 1).toBe(1);
    app.stop();
  });

  it("keeps the last good cards when a later list holds one it cannot show", async () => {
    let second = false;
    const flaky = fetchStub((path) => {
      if (path === "/api/v1/attention") {
        return { status: 200, body: attentionView() };
      }
      return second
        ? { status: 200, body: [null] }
        : {
            status: 200,
            body: [projectCard(), projectCard({ id: "beta", name: "Beta" })],
          };
    });
    const { app, timers } = harness({ fetchImpl: flaky });
    const unhandled: unknown[] = [];
    const listener = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", listener);

    app.start();
    await flush();
    expect(textsOf(root(), ".row-head h3 a")).toStrictEqual(["Alpha", "Beta"]);

    second = true;
    timers.runLast();
    await flush();

    expect(timers.scheduled).toHaveLength(1);
    expect(textsOf(root(), ".row-head h3 a")).toStrictEqual(["Alpha", "Beta"]);
    expect(textOf(root().querySelector(".note"))).toBe("offline, retrying");
    expect(unhandled).toStrictEqual([]);
    process.off("unhandledRejection", listener);
    app.stop();
  });

  it("keeps the last good lanes when a later listing holds a wave it cannot show", async () => {
    let second = false;
    const flaky = fetchStub((path) => {
      const rail = railAnswer(path);
      if (rail !== undefined) {
        return rail;
      }
      if (/\/status$/.test(path)) {
        return noStatus();
      }
      return second
        ? {
            status: 200,
            body: projectLanes({
              waves: [waveSummary({ receivedAt: undefined })],
            }),
          }
        : projectListing(path);
    });
    const { app, timers } = harness({ pathname: "/p/alpha", fetchImpl: flaky });
    const unhandled: unknown[] = [];
    const listener = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", listener);

    app.start();
    await flush();
    expect(textsOf(root(), "tbody tr")).toHaveLength(2);

    second = true;
    timers.runLast();
    await flush();

    expect(timers.scheduled).toHaveLength(1);
    expect(textsOf(root(), "tbody tr")).toHaveLength(2);
    expect(textOf(root().querySelector(".note"))).toBe("offline, retrying");
    expect(unhandled).toStrictEqual([]);
    process.off("unhandledRejection", listener);
    app.stop();
  });

  it("is a failed load when a later listing answers with another project", async () => {
    let second = false;
    const flaky = fetchStub((path) => {
      const rail = railAnswer(path);
      if (rail !== undefined) {
        return rail;
      }
      if (/\/status$/.test(path)) {
        return noStatus();
      }
      return second
        ? {
            status: 200,
            body: projectLanes({ project: { id: "beta", name: "Beta" } }),
          }
        : projectListing(path);
    });
    const { app, timers } = harness({ pathname: "/p/alpha", fetchImpl: flaky });

    app.start();
    await flush();
    expect(textsOf(root(), "tbody tr")).toHaveLength(2);

    second = true;
    timers.runLast();
    await flush();

    expect(timers.scheduled).toHaveLength(1);
    expect(textsOf(root(), "tbody tr")).toHaveLength(2);
    expect(root().querySelectorAll(".note")).toHaveLength(1);
    expect(textOf(root().querySelector(".note"))).toBe("offline, retrying");
    app.stop();
  });

  it("says it is offline when the very first listing is not drawable", async () => {
    const { app, timers } = harness({
      pathname: "/p/alpha",
      fetchImpl: fetchStub((path) => {
        const rail = railAnswer(path);
        if (rail !== undefined) {
          return rail;
        }
        return path.endsWith("/lanes")
          ? { status: 200, body: {} }
          : { status: 404 };
      }),
    });
    app.start();
    await flush();
    expect(timers.scheduled).toHaveLength(1);
    expect(textsOf(root(), ".empty")).toStrictEqual(["Loading…"]);
    expect(textOf(root().querySelector(".note"))).toBe("offline, retrying");
    app.stop();
  });

  it("refreshes on whatever interval it is given", async () => {
    const { app, timers } = harness({
      fetchImpl: fetchStub(listing(projectCard())),
      refreshMs: 250,
    });
    app.start();
    await flush();
    expect(timers.scheduled.map((entry) => entry.delayMs)).toStrictEqual([250]);
    app.stop();
  });

  it("never reaches for setInterval", async () => {
    const interval = vi.fn();
    vi.stubGlobal("setInterval", interval);
    const { app } = harness({ fetchImpl: fetchStub(listing(projectCard())) });
    app.start();
    await flush();
    expect(interval).not.toHaveBeenCalled();
    app.stop();
  });

  it("refetches and re-arms when the timer runs out", async () => {
    const fetchImpl = fetchStub(listing(projectCard()));
    const { app, timers } = harness({ fetchImpl });
    app.start();
    await flush();
    fetchImpl.calls.length = 0;
    timers.runLast();
    await flush();
    expect(fetchImpl.calls).toStrictEqual([
      "/api/v1/projects",
      "/api/v1/attention",
    ]);
    expect(timers.scheduled).toHaveLength(1);
    app.stop();
  });

  it("titles the page after the route", async () => {
    const { app } = harness({ fetchImpl: fetchStub(listing(projectCard())) });
    app.start();
    await flush();
    expect(document.title).toBe("waves");
    app.stop();
  });

  it("says when the very first fetch fails", async () => {
    const { app } = harness({ fetchImpl: throwingFetch() });
    app.start();
    await flush();
    expect(textsOf(root(), ".empty")).toStrictEqual(["Loading…"]);
    expect(textOf(root().querySelector(".note"))).toBe("offline, retrying");
    app.stop();
  });

  it("keeps the last data, with a note, when a later fetch fails", async () => {
    let broken = false;
    const flaky = fetchStub((path) =>
      broken
        ? { status: 500 }
        : path === "/api/v1/attention"
          ? { status: 200, body: attentionView() }
          : { status: 200, body: [projectCard()] },
    );
    const { app } = harness({ fetchImpl: flaky });
    app.start();
    await flush();
    broken = true;
    await app.refresh();
    expect(textsOf(root(), ".row-head h3 a")).toStrictEqual(["Alpha"]);
    expect(textOf(root().querySelector(".note"))).toBe("offline, retrying");
    expect(root().querySelector(".note")?.getAttribute("role")).toBe("status");

    broken = false;
    await app.refresh();
    expect(root().querySelectorAll(".note")).toHaveLength(0);
    app.stop();
  });
});

describe("the attention view", () => {
  /** The rail answering with a project that has two lanes asking for attention. */
  function asking(attention: unknown): (path: string) => Answer {
    return (path) =>
      path === "/api/v1/projects"
        ? { status: 200, body: [projectCard()] }
        : path === "/api/v1/attention"
          ? { status: 200, body: attention }
          : { status: 404 };
  }

  it("asks for it in one pass, beside the project list", async () => {
    const fetchImpl = fetchStub(
      asking(attentionView({ projects: [{ id: "alpha", attention: 2 }] })),
    );
    const { app } = harness({ fetchImpl });
    app.start();
    await flush();
    expect(fetchImpl.calls).toStrictEqual([
      "/api/v1/projects",
      "/api/v1/attention",
    ]);
    expect(textsOf(root(), ".projects small")[0]).toBe(
      "3 waves · 2 need attention",
    );
    expect(root().querySelectorAll(".note")).toHaveLength(0);
    app.stop();
  });

  it("is a failed load when the route is not there at all", async () => {
    const fetchImpl = fetchStub((path) =>
      path === "/api/v1/attention"
        ? { status: 404 }
        : { status: 200, body: [projectCard()] },
    );
    const { app } = harness({ fetchImpl });
    app.start();
    await flush();
    expect(textsOf(root(), ".empty")).toStrictEqual(["Loading…"]);
    expect(root().querySelectorAll(".note")).toHaveLength(1);
    expect(textOf(root().querySelector(".note"))).toBe(OFFLINE);
    app.stop();
  });

  it("is a failed load when the view is not a view the page can draw", async () => {
    const fetchImpl = fetchStub(asking({ lanes: [], projects: {} }));
    const { app, timers } = harness({ fetchImpl });
    app.start();
    await flush();
    expect(textsOf(root(), ".empty")).toStrictEqual(["Loading…"]);
    expect(root().querySelectorAll(".note")).toHaveLength(1);

    timers.runLast();
    await flush();
    expect(root().querySelectorAll(".note")).toHaveLength(1);
    expect(textOf(root().querySelector(".note"))).toBe(OFFLINE);
    app.stop();
  });

  it("keeps the rail's count across a failed load and a navigation", async () => {
    let broken = false;
    const flaky = fetchStub((path) => {
      if (path === "/api/v1/attention") {
        return {
          status: 200,
          body: attentionView({ projects: [{ id: "alpha", attention: 2 }] }),
        };
      }
      return broken ? { status: 500 } : { status: 200, body: [projectCard()] };
    });
    const { app } = harness({ fetchImpl: flaky });
    app.start();
    await flush();
    expect(textsOf(root(), ".projects small")[0]).toBe(
      "3 waves · 2 need attention",
    );

    broken = true;
    await app.refresh();
    expect(textsOf(root(), ".projects small")[0]).toBe(
      "3 waves · 2 need attention",
    );
    expect(textOf(root().querySelector(".note"))).toBe(OFFLINE);

    app.navigate("/nope");
    // Synchronously: the count is the last one the API gave, and the rail is
    // never blanked to say it is loading.
    expect(textsOf(root(), ".projects small")[0]).toBe(
      "3 waves · 2 need attention",
    );
    app.stop();
  });

  it("passes again when the reader leaves a page that is not one of ours", async () => {
    // The rail's list is held, and only the first time, so the pass for the
    // page nobody is on is still waiting when the reader leaves it.
    let held = false;
    const gate = gatedFetch((path) => {
      const answer = projectListing(path);
      const hold = path === "/api/v1/projects" && !held;
      if (hold) {
        held = true;
      }
      return { ...answer, hold };
    });
    const { app } = harness({ pathname: "/elsewhere", fetchImpl: gate });
    app.start();
    await flush();
    expect(gate.pending()).toBe(1);
    expect(textsOf(root(), ".empty")).toStrictEqual(["No such page."]);

    app.navigate("/p/alpha");
    gate.release();
    await flush();

    expect(app.route).toStrictEqual({ kind: "project", id: "alpha" });
    expect(textsOf(root(), '.wave-strip a[aria-current="page"]')).toStrictEqual(
      ["all lanes"],
    );
    expect(root().querySelectorAll(".note")).toHaveLength(0);
    app.stop();
  });
});

describe("the focus across a redraw", () => {
  it("follows the link the reader is on to the link that replaced it", async () => {
    const { app } = harness({ fetchImpl: fetchStub(listing(projectCard())) });
    app.start();
    await flush();
    const link = root().querySelector(".projects a") as HTMLElement;
    link.focus();
    expect(document.activeElement).toBe(link);

    await app.refresh();

    const after = root().querySelector(".projects a") as HTMLElement;
    expect(after).not.toBe(link);
    expect(document.activeElement).toBe(after);
    expect(document.activeElement?.getAttribute("href")).toBe("/p/alpha");
    app.stop();
  });

  it("says a path is not a page at once, and still says so when the load fails", async () => {
    const { app } = harness({ pathname: "/nope", fetchImpl: throwingFetch() });
    app.start();
    // Before anything has answered: the path is not a page whatever loads.
    expect(textsOf(root(), ".empty")).toStrictEqual(["No such page."]);
    await flush();

    expect(textsOf(root(), ".empty")).toStrictEqual(["No such page."]);
    expect(textsOf(root(), ".note")).toStrictEqual(["offline, retrying"]);
    app.stop();
  });

  it("keeps the reader on the card's link, not the menu's link to the same page", async () => {
    const { app } = harness({ fetchImpl: fetchStub(listing(projectCard())) });
    app.start();
    await flush();
    const link = root().querySelector(".row-head h3 a") as HTMLElement;
    expect(link.getAttribute("href")).toBe(
      (root().querySelector(".projects a") as HTMLElement).getAttribute("href"),
    );
    link.focus();

    await app.refresh();

    const active = document.activeElement as HTMLElement;
    expect(active.getAttribute("href")).toBe("/p/alpha");
    expect(active.closest("article.project")).not.toBeNull();
    expect(active.closest(".menu")).toBeNull();
    app.stop();
  });

  it("leaves the focus alone when that link is not there to replace it", async () => {
    const { app } = harness({ fetchImpl: fetchStub(listing(projectCard())) });
    app.start();
    await flush();
    // A link the page owns, with an address no view draws.
    const stray = document.createElement("a");
    stray.setAttribute("href", "/p/nowhere");
    root().append(stray);
    stray.focus();
    expect(document.activeElement).toBe(stray);

    await expect(app.refresh()).resolves.toBe(true);

    expect(document.activeElement).toBe(document.body);
    app.stop();
  });

  it("focuses nothing when nothing was focused", async () => {
    const { app } = harness({ fetchImpl: fetchStub(listing(projectCard())) });
    app.start();
    await flush();
    const before = document.activeElement;
    expect(root().contains(before as Node)).toBe(false);

    await app.refresh();

    expect(document.activeElement).toBe(before);
    app.stop();
  });

  it("leaves a control that is not a link where the browser puts it", async () => {
    const { app } = harness({
      pathname: "/p/alpha",
      fetchImpl: fetchStub(projectListing),
    });
    app.start();
    await flush();
    // A control the page did not draw and carries no key for, which is what a
    // reader's own browser extension would do. The page's own buttons are keyed,
    // so this is the one the redraw cannot put back.
    const button = document.createElement("button");
    root().append(button);
    button.focus();
    expect(document.activeElement).toBe(button);

    await app.refresh();

    const anchors = Array.from(root().querySelectorAll("a"));
    expect(anchors.length).toBeGreaterThan(0);
    expect(anchors).not.toContain(document.activeElement);
    expect(document.activeElement).not.toBe(button);
    expect(root().contains(button)).toBe(false);
    // And the focus is not pulled onto the page's own controls either: nothing
    // was focused that the redraw can recognise.
    expect(document.activeElement).toBe(document.body);
    app.stop();
  });

  it("keeps the search box and the caret in it across the redraw", async () => {
    // Ten seconds between refreshes and a reader who is halfway through a word:
    // the box is still the box they were typing in, with the caret where they
    // left it. A selection equal to the value's length would look the same
    // whether it was put back or never taken, so this one is in the middle.
    const { app } = harness({
      pathname: "/p/alpha",
      search: "?q=wv-a",
      fetchImpl: fetchStub(projectListing),
    });
    app.start();
    await flush();
    const box = root().querySelector("#filter-q") as HTMLInputElement;
    expect(box.value).toBe("wv-a");
    box.focus();
    box.setSelectionRange(1, 2);
    expect(document.activeElement).toBe(box);

    await app.refresh();

    const after = root().querySelector("#filter-q") as HTMLInputElement;
    expect(after).not.toBe(box);
    expect(document.activeElement).toBe(after);
    expect(after.value).toBe("wv-a");
    expect(after.selectionStart).toBe(1);
    expect(after.selectionEnd).toBe(2);
    app.stop();
  });

  it("keeps the focus in the select the reader was choosing from", async () => {
    const { app } = harness({
      pathname: "/p/alpha",
      fetchImpl: fetchStub(projectListing),
    });
    app.start();
    await flush();
    const select = root().querySelector("#filter-seat") as HTMLSelectElement;
    select.focus();
    expect(document.activeElement).toBe(select);

    await app.refresh();

    const after = root().querySelector("#filter-seat") as HTMLSelectElement;
    expect(after).not.toBe(select);
    expect(document.activeElement).toBe(after);
    app.stop();
  });

  it("focuses nothing when the scope emptied and took the toolbar with it", async () => {
    let second = false;
    const flaky = fetchStub((path) => {
      const rail = railAnswer(path);
      if (rail !== undefined) {
        return rail;
      }
      if (/\/status$/.test(path)) {
        return noStatus();
      }
      return second
        ? { status: 200, body: projectLanes({ lanes: [] }) }
        : projectListing(path);
    });
    const { app } = harness({ pathname: "/p/alpha", fetchImpl: flaky });
    app.start();
    await flush();
    (root().querySelector("#filter-q") as HTMLInputElement).focus();
    expect(document.activeElement).not.toBe(document.body);

    second = true;
    await app.refresh();

    expect(root().querySelector("#filter-q")).toBeNull();
    expect(document.activeElement).toBe(document.body);
    expect(textsOf(root(), ".empty")).toStrictEqual([
      "No lanes in this scope.",
    ]);
    app.stop();
  });
});

describe("pausing while the page is hidden", () => {
  it("arms no timer at all when the page starts hidden", async () => {
    setHidden(true);
    const fetchImpl = fetchStub(listing(projectCard()));
    const { app, timers } = harness({ fetchImpl });
    app.start();
    await flush();
    // The one pass it does make asks for the rail's two lists.
    expect(fetchImpl.calls).toHaveLength(2);
    expect(timers.scheduled).toHaveLength(0);
    app.stop();
  });

  it("clears the pending timer when the page goes hidden, and refetches when it comes back", async () => {
    const fetchImpl = fetchStub(listing(projectCard()));
    const { app, timers } = harness({ fetchImpl });
    app.start();
    await flush();
    expect(timers.scheduled).toHaveLength(1);

    setHidden(true);
    visible();
    expect(timers.cleared).toStrictEqual([1]);
    expect(timers.scheduled).toHaveLength(0);
    expect(fetchImpl.calls).toHaveLength(2);

    setHidden(false);
    visible();
    await flush();
    expect(fetchImpl.calls).toHaveLength(4);
    expect(timers.scheduled).toHaveLength(1);

    setHidden(true);
    visible();
    setHidden(true);
    visible();
    expect(timers.cleared).toStrictEqual([1, 2]);
    expect(timers.scheduled).toHaveLength(0);
    app.stop();
  });
});

describe("stopping", () => {
  it("clears the timer, and a later start arms a new one", async () => {
    const { app, timers } = harness({
      fetchImpl: fetchStub(listing(projectCard())),
    });
    app.start();
    await flush();
    app.stop();
    expect(timers.cleared).toStrictEqual([1]);
    expect(timers.scheduled).toHaveLength(0);

    app.start();
    await flush();
    expect(timers.scheduled).toHaveLength(1);
    app.stop();
  });
});

describe("the project route", () => {
  it("loads every lane of the project in one pass, and the rail beside them", async () => {
    const fetchImpl = fetchStub(projectListing);
    const { app } = harness({ pathname: "/p/alpha", fetchImpl });
    app.start();
    await flush();
    expect(fetchImpl.calls).toStrictEqual([
      "/api/v1/projects",
      "/api/v1/attention",
      "/api/v1/projects/alpha/lanes",
      "/api/v1/projects/alpha/status",
    ]);
    expect(textsOf(root(), '.wave-strip a[aria-current="page"]')).toStrictEqual(
      ["all lanes"],
    );
    expect(textsOf(root(), "tbody tr")).toHaveLength(2);
    expect(textsOf(root(), "h1")).toStrictEqual(["Alpha"]);
    expect(document.title).toBe("waves — alpha");
    app.stop();
  });

  it("loads the wave the reader picks, without asking that project's lanes again", async () => {
    const fetchImpl = fetchStub(projectListing);
    const { app, browser } = harness({ pathname: "/p/alpha", fetchImpl });
    app.start();
    await flush();
    fetchImpl.calls.length = 0;

    (root().querySelectorAll(".wave-strip li a")[2] as HTMLElement).click();
    await flush();

    expect(browser.pushes).toStrictEqual(["/p/alpha/w/w-2"]);
    // What a pass requests depends on the project and on `all`, and a wave is
    // neither: the rows on screen were already the answer to this question.
    expect(fetchImpl.calls).toStrictEqual([]);
    expect(textsOf(root(), '.wave-strip a[aria-current="page"]')).toStrictEqual(
      ["w-2"],
    );
    expect(textsOf(root(), "tbody tr")).toHaveLength(1);
    expect(root().querySelectorAll(".note")).toHaveLength(0);
    app.stop();
  });

  it("asks for the waves past retention when the toggle link is followed", async () => {
    const fetchImpl = fetchStub(projectListing);
    const { app, browser } = harness({ pathname: "/p/alpha", fetchImpl });
    app.start();
    await flush();
    expect(textsOf(root(), ".wave-strip li a")).toHaveLength(3);

    (root().querySelector(".wave-strip > a") as HTMLElement).click();
    // Synchronously: the rows asked for without the waves past retention are
    // not shown as the answer to a page that now says it shows them.
    expect(textsOf(root(), "tbody tr")).toHaveLength(0);
    expect(textsOf(root(), ".empty")).toStrictEqual(["Loading…"]);
    await flush();

    expect(browser.pushes).toStrictEqual(["/p/alpha?all=1"]);
    expect(fetchImpl.calls.slice(-4)).toStrictEqual([
      "/api/v1/projects",
      "/api/v1/attention",
      "/api/v1/projects/alpha/lanes?all=1",
      "/api/v1/projects/alpha/status",
    ]);
    expect(textsOf(root(), ".wave-strip li a")).toHaveLength(4);
    expect(textsOf(root(), ".wave-strip > a")).toStrictEqual([
      "hide waves past retention",
    ]);
    app.stop();
  });

  it("narrowed to a wave that is past retention, says so and keeps the wave", async () => {
    // The path names a wave the listing holds, but the reader did not ask for
    // the waves past the retention, so the strip cannot show this one and the
    // table has nothing in scope. The heading still names what was asked for.
    const { app } = harness({
      pathname: "/p/alpha/w/w-1",
      fetchImpl: fetchStub(projectListing),
    });
    app.start();
    await flush();

    expect(textsOf(root(), "h1 code")).toStrictEqual(["w-1"]);
    expect(
      root().querySelectorAll('.wave-strip a[aria-current="page"]'),
    ).toHaveLength(0);
    expect(textsOf(root(), ".empty")).toStrictEqual([
      "This wave is past retention. Show the waves past retention to list its lanes.",
    ]);
    expect(textsOf(root(), ".wave-strip > a")).toStrictEqual([
      "show waves past retention",
    ]);
    app.stop();
  });

  it("says a wave the project does not have, and draws no table", async () => {
    const { app } = harness({
      pathname: "/p/alpha/w/w-9",
      fetchImpl: fetchStub(projectListing),
    });
    app.start();
    await flush();

    expect(textsOf(root(), "h1 code")).toStrictEqual(["w-9"]);
    expect(textsOf(root(), ".empty")).toStrictEqual([
      "No such wave in this project.",
    ]);
    expect(textsOf(root(), ".wave-strip li a")).toStrictEqual([
      "all lanes",
      "w-3",
      "w-2",
    ]);
    expect(root().querySelectorAll("table")).toHaveLength(0);
    expect(root().querySelectorAll(".note")).toHaveLength(0);
    app.stop();
  });

  it("says so when a later pass finds the wave it is reading has gone", async () => {
    // The address still names the wave; the answer stopped carrying it. The page
    // says so rather than drawing a table of nothing under a heading that claims
    // a wave is there.
    let second = false;
    const flaky = fetchStub((path) => {
      const rail = railAnswer(path);
      if (rail !== undefined) {
        return rail;
      }
      if (/\/status$/.test(path)) {
        return noStatus();
      }
      return second
        ? {
            status: 200,
            body: projectLanes({
              waves: [waveSummary({ wave: "w-3" })],
              lanes: [laneRow()],
            }),
          }
        : projectListing(path);
    });
    const { app, timers } = harness({
      pathname: "/p/alpha/w/w-2",
      fetchImpl: flaky,
    });
    app.start();
    await flush();
    expect(textsOf(root(), "tbody tr")).toHaveLength(1);

    second = true;
    timers.runLast();
    await flush();

    expect(textsOf(root(), "h1 code")).toStrictEqual(["w-2"]);
    expect(textsOf(root(), ".empty")).toStrictEqual([
      "No such wave in this project.",
    ]);
    expect(root().querySelectorAll("table")).toHaveLength(0);
    expect(root().querySelectorAll(".note")).toHaveLength(0);
    app.stop();
  });

  it("draws a later listing with one row fewer, and says nothing", async () => {
    let second = false;
    const flaky = fetchStub((path) => {
      const rail = railAnswer(path);
      if (rail !== undefined) {
        return rail;
      }
      if (/\/status$/.test(path)) {
        return noStatus();
      }
      return second
        ? { status: 200, body: projectLanes({ lanes: [laneRow()] }) }
        : projectListing(path);
    });
    const { app, timers } = harness({ pathname: "/p/alpha", fetchImpl: flaky });
    app.start();
    await flush();
    expect(textsOf(root(), "tbody tr")).toHaveLength(2);

    second = true;
    timers.runLast();
    await flush();

    expect(timers.scheduled).toHaveLength(1);
    expect(textsOf(root(), "tbody tr")).toHaveLength(1);
    expect(root().querySelectorAll(".note")).toHaveLength(0);
    app.stop();
  });

  it("keeps the table the reader is working down when a wave link is followed mid-pass", async () => {
    const gate = gatedFetch((path) => {
      const answer = projectListing(path);
      return {
        status: answer.status,
        body: answer.body,
        hold: /\/lanes/.test(path),
      };
    });
    const { app, timers } = harness({ pathname: "/p/alpha", fetchImpl: gate });
    app.start();
    await flush();
    gate.release();
    await flush();
    expect(textsOf(root(), '.wave-strip a[aria-current="page"]')).toStrictEqual(
      ["all lanes"],
    );

    timers.runLast();
    await flush();
    expect(gate.pending()).toBe(1);
    // The lanes read is the one this gate holds: the project's own status is
    // asked for in the same pass and answers at once.
    expect(
      gate.calls.filter((path) => /\/lanes/.test(path)).slice(-1),
    ).toStrictEqual(["/api/v1/projects/alpha/lanes"]);

    const callsBeforeClick = gate.calls.length;
    (root().querySelectorAll(".wave-strip li a")[2] as HTMLElement).click();
    // The click waits for the pass in flight; it starts no request of its own.
    expect(gate.calls).toHaveLength(callsBeforeClick);

    gate.release();
    await flush();

    expect(gate.calls.filter((path) => /\/lanes/.test(path))).toStrictEqual([
      "/api/v1/projects/alpha/lanes",
      "/api/v1/projects/alpha/lanes",
    ]);
    gate.release();
    await flush();
    expect(textsOf(root(), '.wave-strip a[aria-current="page"]')).toStrictEqual(
      ["w-2"],
    );
    expect(textsOf(root(), "tbody tr")).toHaveLength(1);
    expect(timers.scheduled).toHaveLength(1);
    app.stop();
  });

  it("keeps the last good cards when a later list holds none it can show", async () => {
    let second = false;
    const flaky = fetchStub((path) => {
      if (path === "/api/v1/attention") {
        return { status: 200, body: attentionView() };
      }
      return second
        ? { status: 200, body: [{}] }
        : { status: 200, body: [projectCard()] };
    });
    const { app, timers } = harness({ fetchImpl: flaky });
    app.start();
    await flush();
    expect(textsOf(root(), ".row-head h3 a")).toStrictEqual(["Alpha"]);

    second = true;
    timers.runLast();
    await flush();

    expect(timers.scheduled).toHaveLength(1);
    expect(textsOf(root(), ".row-head h3 a")).toStrictEqual(["Alpha"]);
    expect(textOf(root().querySelector(".note"))).toBe("offline, retrying");
    app.stop();
  });

  it("asks for nothing more when every wave is past retention", async () => {
    const fetchImpl = fetchStub((path) => {
      const rail = railAnswer(path);
      if (rail !== undefined) {
        return rail;
      }
      return path === "/api/v1/projects/alpha/lanes"
        ? {
            status: 200,
            body: projectLanes({
              // One wave to ask about, none of it retained and no lanes listed:
              // the store is meant to be holding none of its lanes, so a row for
              // it is a state the server cannot produce.
              waves: [waveSummary({ wave: "w-3", retained: false })],
              lanes: [],
            }),
          }
        : { status: 404 };
    });
    const { app } = harness({ pathname: "/p/alpha", fetchImpl });
    app.start();
    await flush();
    expect(fetchImpl.calls).toStrictEqual([
      "/api/v1/projects",
      "/api/v1/attention",
      "/api/v1/projects/alpha/lanes",
      "/api/v1/projects/alpha/status",
    ]);
    // Nothing is shown and nothing is in scope, so the strip shows the way back
    // to all of them and the table says what is not there.
    expect(textsOf(root(), ".wave-strip li a")).toStrictEqual(["all lanes"]);
    expect(textsOf(root(), ".wave-strip .meta")).toStrictEqual(["0 lanes"]);
    expect(textsOf(root(), ".wave-strip > a")).toStrictEqual([
      "show waves past retention",
    ]);
    expect(textsOf(root(), "tbody tr")).toHaveLength(0);
    expect(textsOf(root(), ".empty")).toStrictEqual([
      "No lanes in this scope.",
    ]);
    app.stop();
  });

  it("asks again for a project whose listing never arrived", async () => {
    const fetchImpl = fetchStub((path) => {
      const rail = railAnswer(path);
      if (rail !== undefined) {
        return rail;
      }
      // A failure and not a 404: a project that is not registered is an answer,
      // and this is about a listing that never arrived at all.
      return { status: 500 };
    });
    const { app } = harness({ pathname: "/p/alpha", fetchImpl });
    app.start();
    await flush();
    expect(textsOf(root(), ".empty")).toStrictEqual(["Loading…"]);
    expect(textOf(root().querySelector(".note"))).toBe("offline, retrying");

    app.navigate("/p/alpha?reason=gate");
    // Nothing was ever loaded for this project, so a filter on it is not a
    // redraw out of data in hand: it is a pass, and the note about the failure
    // behind it goes with the page it was about.
    expect(textsOf(root(), ".empty")).toStrictEqual(["Loading…"]);
    expect(root().querySelectorAll(".note")).toHaveLength(0);

    await flush();
    expect(fetchImpl.calls).toHaveLength(8);
    expect(textOf(root().querySelector(".note"))).toBe("offline, retrying");
    app.stop();
  });

  it("says so when the project is not registered", async () => {
    const { app } = harness({
      pathname: "/p/nope",
      fetchImpl: fetchStub((path) => railAnswer(path) ?? { status: 404 }),
    });
    app.start();
    await flush();
    expect(textsOf(root(), ".empty")).toStrictEqual(["No such project."]);
    expect(document.title).toBe("waves — nope");
    app.stop();
  });

  it("says so when the page is not one of ours, and still loads the rail", async () => {
    // A cold load of a path that is not a page used to ask for nothing at all,
    // which left the rail on that page empty; it now loads what the rail draws.
    const fetchImpl = fetchStub((path) =>
      path === "/api/v1/attention"
        ? { status: 200, body: attentionView() }
        : { status: 200, body: [projectCard()] },
    );
    const { app } = harness({ pathname: "/elsewhere", fetchImpl });
    app.start();
    await flush();
    expect(textsOf(root(), ".empty")).toStrictEqual(["No such page."]);
    expect(fetchImpl.calls).toStrictEqual([
      "/api/v1/projects",
      "/api/v1/attention",
    ]);
    expect(textsOf(root(), ".projects a")).toStrictEqual(["Alpha"]);
    app.stop();
  });

  it("survives a page with no #root to draw into", async () => {
    const { app } = harness({
      pathname: "/p/alpha",
      fetchImpl: fetchStub(projectListing),
      withoutRoot: true,
    });
    app.start();
    await flush();
    expect(document.getElementById("root")).toBeNull();
    expect(document.title).toBe("waves — alpha");
    app.stop();
  });
});

describe("the sync pill", () => {
  it("says it is syncing before the first answer, and the clock time after", async () => {
    const { app } = harness({ fetchImpl: fetchStub(listing(projectCard())) });
    app.start();
    expect(textsOf(root(), ".sync")).toStrictEqual(["syncing…"]);
    await flush();
    expect(textsOf(root(), ".sync")).toStrictEqual([
      `synced ${clockTime(NOW_MS)}`,
    ]);
    expect(textsOf(root(), ".sync")).not.toStrictEqual(["syncing…"]);
    app.stop();
  });

  it("records the clock a later pass answers with, and not one that fails", async () => {
    let second = false;
    const flaky = fetchStub((path) =>
      second ? { status: 404 } : listing(projectCard())(path),
    );
    // A clock that moves, because a clock that does not would make a pass that
    // wrongly recorded one look like a pass that correctly did not.
    let now = NOW_MS;
    const { app } = harness({
      fetchImpl: flaky,
      clock: () => {
        now += 3_600_000;
        return now;
      },
    });
    app.start();
    await flush();
    const first = textOf(root().querySelector(".sync"));
    expect(first).toBe(`synced ${clockTime(NOW_MS + 3_600_000)}`);

    second = true;
    await app.refresh();

    expect(textOf(root().querySelector(".note"))).toBe(OFFLINE);
    expect(textOf(root().querySelector(".sync"))).toBe(first);
    app.stop();
  });

  it("keeps the clock of the data on screen when the new data will not draw", async () => {
    // The second pass loads, records its time, and then its draw throws (the
    // view reads the clock, which fails once): the old data goes back on screen,
    // and so must the old time.
    let now = NOW_MS;
    let armed = 0;
    const { app } = harness({
      fetchImpl: fetchStub(listing(projectCard())),
      clock: () => {
        now += 3_600_000;
        if (armed === 1) {
          armed = 2;
          return now;
        }
        if (armed === 2) {
          armed = 0;
          throw new Error("the view could not be drawn");
        }
        return now;
      },
    });
    app.start();
    await flush();
    const first = textOf(root().querySelector(".sync"));

    armed = 1;
    await app.refresh();

    expect(textOf(root().querySelector(".note"))).toBe(OFFLINE);
    expect(textOf(root().querySelector(".sync"))).toBe(first);
    app.stop();
  });

  it("keeps the clock at the first answer when every later pass fails", async () => {
    const { app } = harness({
      fetchImpl: fetchStub(() => ({ status: 404 })),
    });
    app.start();
    await flush();
    expect(textsOf(root(), ".sync")).toStrictEqual(["syncing…"]);
    expect(root().querySelector(".sync")?.getAttribute("class")).toBe(
      "sync offline",
    );
    app.stop();
  });
});

describe("the refresh button", () => {
  it("asks the app for one pass, and never a second while one is in flight", async () => {
    const fetchImpl = gatedFetch(listing(projectCard()));
    const { app, timers } = harness({ fetchImpl });
    app.start();
    fetchImpl.release();
    await flush();
    expect(fetchImpl.calls).toHaveLength(2);

    (root().querySelector("button.refresh") as HTMLButtonElement).click();

    // The frame is redrawn at once, so the spin is on screen before the pass has
    // answered anything at all.
    expect(root().querySelector("button.refresh")?.getAttribute("class")).toBe(
      "refresh spin",
    );
    await flush();
    expect(fetchImpl.calls).toHaveLength(4);
    expect(fetchImpl.pending()).toBe(2);

    (root().querySelector("button.refresh") as HTMLButtonElement).click();
    (root().querySelector("button.refresh") as HTMLButtonElement).click();
    expect(fetchImpl.calls).toHaveLength(4);

    fetchImpl.release();
    await flush();

    expect(fetchImpl.calls).toHaveLength(4);
    expect(root().querySelector("button.refresh")?.getAttribute("class")).toBe(
      "refresh",
    );
    expect(textsOf(root(), ".sync")).toStrictEqual([
      `synced ${clockTime(NOW_MS)}`,
    ]);
    expect(timers.scheduled).toHaveLength(1);
    app.stop();
  });

  it("is the only thing the page draws that starts a pass on its own", async () => {
    const fetchImpl = fetchStub(listing(projectCard()));
    const { app, timers } = harness({ fetchImpl });
    app.start();
    await flush();

    timers.runLast();
    await flush();

    expect(fetchImpl.calls).toHaveLength(4);
    expect(root().querySelector("button.refresh")?.getAttribute("class")).toBe(
      "refresh",
    );

    setHidden(true);
    visible();
    setHidden(false);
    visible();
    await flush();

    expect(fetchImpl.calls).toHaveLength(6);
    expect(root().querySelector("button.refresh")?.getAttribute("class")).toBe(
      "refresh",
    );
    app.stop();
  });

  it("keeps the focus on it across the redraw that replaces it", async () => {
    const { app } = harness({ fetchImpl: fetchStub(listing(projectCard())) });
    app.start();
    await flush();
    const before = root().querySelector("button.refresh") as HTMLButtonElement;
    before.focus();
    expect(document.activeElement).toBe(before);

    await app.refresh();

    const after = root().querySelector("button.refresh") as HTMLButtonElement;
    expect(after).not.toBe(before);
    expect(after.getAttribute("data-key")).toBe("refresh");
    expect(document.activeElement).toBe(after);
    app.stop();
  });
});

describe("the first paint", () => {
  it("marks #root, keeps the mark over the first paint with data, drops it after", async () => {
    const { app } = harness({ fetchImpl: fetchStub(listing(projectCard())) });
    app.start();
    expect(root().getAttribute("data-first")).toBe("1");

    await flush();

    // Still set: the draw that has just happened is the first with data, and the
    // mark goes with the draw after it, which is what leaves the entrance on
    // screen for a paint instead of removing it in the same task.
    expect(root().getAttribute("data-first")).toBe("1");
    expect(root().querySelectorAll("article.project")).toHaveLength(1);

    await app.refresh();

    expect(root().getAttribute("data-first")).toBeNull();
    expect(root().querySelectorAll("article.project")).toHaveLength(1);
    app.stop();
  });

  it("keeps the mark while there is nothing to enter with", async () => {
    const { app } = harness({ fetchImpl: fetchStub(() => ({ status: 404 })) });
    app.start();
    await flush();
    expect(textsOf(root(), ".empty")).toStrictEqual(["Loading…"]);
    expect(root().getAttribute("data-first")).toBe("1");

    await app.refresh();

    expect(textsOf(root(), ".empty")).toStrictEqual(["Loading…"]);
    expect(root().getAttribute("data-first")).toBe("1");
    app.stop();
  });

  it("marks nothing when the page has no #root to mark", async () => {
    const { app } = harness({
      pathname: "/p/alpha",
      fetchImpl: fetchStub(projectListing),
      withoutRoot: true,
    });
    app.start();
    await flush();
    expect(document.getElementById("root")).toBeNull();
    app.stop();
  });
});
