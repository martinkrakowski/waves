import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  LaneDerivedView,
  LaneView,
} from "../../src/application/read-model.js";
import type { AppGlobals } from "../../public/app.js";
import { createApp, REFRESH_MS } from "../../public/app.js";

import type { Answer, FetchStub, TimerStub } from "./helpers.js";
import {
  attentionView,
  envelope,
  lane,
  NOW_MS,
  projectCard,
  waveSummary,
  waveView,
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
    clock: () => NOW_MS,
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

function projectWaves(path: string): Answer {
  const rail = railAnswer(path);
  if (rail !== undefined) {
    return rail;
  }
  if (path === "/api/v1/projects/alpha/waves") {
    return {
      status: 200,
      body: [
        waveSummary({ wave: "w-3" }),
        waveSummary({ wave: "w-2", receivedAt: "2026-04-01T11:50:00.000Z" }),
        waveSummary({
          wave: "w-1",
          receivedAt: "2026-04-01T11:00:00.000Z",
          retained: false,
        }),
      ],
    };
  }
  const wave = /\/waves\/(w-\d)$/.exec(path);
  if (wave !== null) {
    return {
      status: 200,
      body: waveView({
        envelope: { ...waveView().envelope, wave: wave[1] ?? "" },
      }),
    };
  }
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
    expect(textsOf(root(), ".card-name")).toStrictEqual(["Alpha"]);
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
    expect(textsOf(root(), ".card-name")).toStrictEqual(["Alpha"]);
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
    expect(textsOf(root(), ".card-name")).toStrictEqual(["Alpha", "Beta"]);

    second = true;
    timers.runLast();
    await flush();

    expect(timers.scheduled).toHaveLength(1);
    expect(textsOf(root(), ".card-name")).toStrictEqual(["Alpha", "Beta"]);
    expect(textOf(root().querySelector(".note"))).toBe("offline, retrying");
    expect(unhandled).toStrictEqual([]);
    process.off("unhandledRejection", listener);
    app.stop();
  });

  it("keeps the last good lanes when the wave comes back without one", async () => {
    let second = false;
    const flaky = fetchStub((path) => {
      const rail = railAnswer(path);
      if (rail !== undefined) {
        return rail;
      }
      if (path.endsWith("/waves")) {
        return { status: 200, body: [waveSummary()] };
      }
      return second
        ? { status: 200, body: {} }
        : { status: 200, body: waveView() };
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

  it("says it is offline when the very first wave is not a wave at all", async () => {
    const { app, timers } = harness({
      pathname: "/p/alpha",
      fetchImpl: fetchStub((path) => {
        const rail = railAnswer(path);
        if (rail !== undefined) {
          return rail;
        }
        return path.endsWith("/waves")
          ? { status: 200, body: [waveSummary()] }
          : { status: 200, body: {} };
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
    expect(textsOf(root(), ".card-name")).toStrictEqual(["Alpha"]);
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
      const answer = projectWaves(path);
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
    expect(textsOf(root(), ".empty")).toStrictEqual(["Loading…"]);

    app.navigate("/p/alpha");
    gate.release();
    await flush();

    expect(app.route).toStrictEqual({ kind: "project", id: "alpha" });
    expect(textsOf(root(), ".wave.current code")).toStrictEqual(["w-3"]);
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

    expect(document.activeElement).not.toBe(stray);
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
      fetchImpl: fetchStub(projectWaves),
    });
    app.start();
    await flush();
    const toggle = root().querySelector(".toggle") as HTMLElement;
    toggle.focus();
    expect(document.activeElement).toBe(toggle);

    await app.refresh();

    const after = root().querySelector(".toggle") as HTMLElement;
    expect(after).not.toBe(toggle);
    expect(after.getAttribute("href")).toBeNull();
    expect(document.activeElement).not.toBe(after);
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
  it("loads the newest wave and its lanes, and the rail's list beside them", async () => {
    const fetchImpl = fetchStub(projectWaves);
    const { app } = harness({ pathname: "/p/alpha", fetchImpl });
    app.start();
    await flush();
    expect(fetchImpl.calls).toStrictEqual([
      "/api/v1/projects",
      "/api/v1/attention",
      "/api/v1/projects/alpha/waves",
      "/api/v1/projects/alpha/waves/w-3",
    ]);
    expect(textsOf(root(), ".wave.current code")).toStrictEqual(["w-3"]);
    expect(textsOf(root(), "tbody tr")).toHaveLength(2);
    expect(document.title).toBe("waves — alpha");
    app.stop();
  });

  it("loads the wave the user picks, and keeps the pick", async () => {
    const fetchImpl = fetchStub(projectWaves);
    const { app } = harness({ pathname: "/p/alpha", fetchImpl });
    app.start();
    await flush();
    (root().querySelectorAll(".wave")[1] as HTMLElement).click();
    await flush();
    expect(fetchImpl.calls.slice(-1)).toStrictEqual([
      "/api/v1/projects/alpha/waves/w-2",
    ]);
    expect(textsOf(root(), ".wave.current code")).toStrictEqual(["w-2"]);
    app.stop();
  });

  it("reveals the waves past retention without asking the API again", async () => {
    const fetchImpl = fetchStub(projectWaves);
    const { app } = harness({ pathname: "/p/alpha", fetchImpl });
    app.start();
    await flush();
    fetchImpl.calls.length = 0;

    (root().querySelector(".toggle") as HTMLElement).click();
    expect(fetchImpl.calls).toStrictEqual([]);
    expect(textsOf(root(), ".wave code")).toStrictEqual(["w-3", "w-2", "w-1"]);

    (root().querySelector(".toggle") as HTMLElement).click();
    expect(textsOf(root(), ".wave code")).toStrictEqual(["w-3", "w-2"]);
    app.stop();
  });

  it("drops the lanes of a wave the toggle has just hidden", async () => {
    const fetchImpl = fetchStub(projectWaves);
    const { app } = harness({ pathname: "/p/alpha", fetchImpl });
    app.start();
    await flush();

    (root().querySelector(".toggle") as HTMLElement).click();
    (root().querySelectorAll(".wave")[2] as HTMLElement).click();
    await flush();
    expect(textsOf(root(), ".wave.current code")).toStrictEqual(["w-1"]);
    expect(textsOf(root(), "tbody tr")).toHaveLength(2);

    (root().querySelector(".toggle") as HTMLElement).click();
    expect(textsOf(root(), ".wave code")).toStrictEqual(["w-3", "w-2"]);
    expect(textsOf(root(), ".wave.current")).toHaveLength(0);
    expect(root().querySelectorAll("tbody")).toHaveLength(0);
    expect(textsOf(root(), ".empty")).toStrictEqual(["No wave selected."]);
    app.stop();
  });

  it("never shows one wave's lanes under another wave's selection", async () => {
    const gate = gatedFetch((path) => {
      const answer = projectWaves(path);
      return {
        status: answer.status,
        body: answer.body,
        hold: /\/waves\/[^/]+$/.test(path),
      };
    });
    const { app, timers } = harness({ pathname: "/p/alpha", fetchImpl: gate });
    app.start();
    await flush();
    gate.release();
    await flush();
    expect(textsOf(root(), ".wave.current code")).toStrictEqual(["w-3"]);

    timers.runLast();
    await flush();
    expect(gate.pending()).toBe(1);
    expect(gate.calls.slice(-1)).toStrictEqual([
      "/api/v1/projects/alpha/waves/w-3",
    ]);

    const callsBeforeClick = gate.calls.length;
    (root().querySelectorAll(".wave")[1] as HTMLElement).click();
    // The click waits for the pass in flight; it starts no fetch of its own.
    expect(gate.calls).toHaveLength(callsBeforeClick);

    gate.release();
    await flush();

    expect(gate.calls.slice(-1)).toStrictEqual([
      "/api/v1/projects/alpha/waves/w-2",
    ]);
    gate.release();
    await flush();
    expect(textsOf(root(), ".wave.current code")).toStrictEqual(["w-2"]);
    expect(textsOf(root(), ".lane-panel h2 code")).toStrictEqual(["w-2"]);
    expect(timers.scheduled).toHaveLength(1);
    app.stop();
  });

  it("keeps the last good lanes when the detail answers with another wave", async () => {
    let second = false;
    const other = waveView({ envelope: envelope({ wave: "w-9" }) });
    const flaky = fetchStub((path) => {
      const rail = railAnswer(path);
      if (rail !== undefined) {
        return rail;
      }
      if (path.endsWith("/waves")) {
        return { status: 200, body: [waveSummary({ wave: "w-3" })] };
      }
      return second
        ? { status: 200, body: other }
        : { status: 200, body: waveView() };
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
    expect(textOf(root().querySelector(".note"))).toBe("offline, retrying");
    app.stop();
  });

  it.each([
    [
      "an envelope with nothing around it",
      { envelope: { wave: "w-3", lanes: [] } },
    ],
    [
      "lanes that are not a list",
      waveView({
        envelope: envelope({ lanes: "two" as unknown as LaneView[] }),
      }),
    ],
    [
      "a lane with no derived",
      waveView({
        envelope: envelope({
          lanes: [lane({ derived: undefined as unknown as LaneDerivedView })],
        }),
      }),
    ],
  ])(
    "keeps the last good lanes when the detail is %s",
    async (_label, body) => {
      let second = false;
      const flaky = fetchStub((path) => {
        const rail = railAnswer(path);
        if (rail !== undefined) {
          return rail;
        }
        if (path.endsWith("/waves")) {
          return { status: 200, body: [waveSummary({ wave: "w-3" })] };
        }
        return second
          ? { status: 200, body }
          : { status: 200, body: waveView() };
      });
      const { app, timers } = harness({
        pathname: "/p/alpha",
        fetchImpl: flaky,
      });
      app.start();
      await flush();
      expect(textsOf(root(), "tbody tr")).toHaveLength(2);

      second = true;
      timers.runLast();
      await flush();

      expect(timers.scheduled).toHaveLength(1);
      expect(textsOf(root(), "tbody tr")).toHaveLength(2);
      expect(textOf(root().querySelector(".note"))).toBe("offline, retrying");
      app.stop();
    },
  );

  it("draws a later full wave detail for the wave it is showing", async () => {
    let second = false;
    const thinner = waveView({
      envelope: envelope({ lanes: [lane({ id: "wv-c" })] }),
    });
    const flaky = fetchStub((path) => {
      const rail = railAnswer(path);
      if (rail !== undefined) {
        return rail;
      }
      if (path.endsWith("/waves")) {
        return { status: 200, body: [waveSummary({ wave: "w-3" })] };
      }
      return second
        ? { status: 200, body: thinner }
        : { status: 200, body: waveView() };
    });
    const { app, timers } = harness({ pathname: "/p/alpha", fetchImpl: flaky });
    app.start();
    await flush();
    expect(textsOf(root(), "tbody tr")).toHaveLength(2);

    second = true;
    timers.runLast();
    await flush();

    expect(timers.scheduled).toHaveLength(1);
    expect(textsOf(root(), ".lane-panel h2 code")).toStrictEqual(["w-3"]);
    expect(textsOf(root(), "tbody tr")).toHaveLength(1);
    expect(root().querySelectorAll(".note")).toHaveLength(0);
    app.stop();
  });

  it("says the wave is gone when its detail answers 404", async () => {
    let second = false;
    const flaky = fetchStub((path) => {
      const rail = railAnswer(path);
      if (rail !== undefined) {
        return rail;
      }
      if (path.endsWith("/waves")) {
        return { status: 200, body: [waveSummary({ wave: "w-3" })] };
      }
      return second ? { status: 404 } : { status: 200, body: waveView() };
    });
    const { app, timers } = harness({ pathname: "/p/alpha", fetchImpl: flaky });
    app.start();
    await flush();
    expect(textsOf(root(), "tbody tr")).toHaveLength(2);

    second = true;
    timers.runLast();
    await flush();

    expect(timers.scheduled).toHaveLength(1);
    expect(textsOf(root(), ".empty")).toStrictEqual([
      "That wave is no longer stored.",
    ]);
    expect(root().querySelectorAll("tbody")).toHaveLength(0);
    expect(root().querySelectorAll(".note")).toHaveLength(0);
    app.stop();
  });

  it("keeps the last good waves when a later wave list holds none it can show", async () => {
    let second = false;
    const flaky = fetchStub((path) => {
      const rail = railAnswer(path);
      if (rail !== undefined) {
        return rail;
      }
      if (path.endsWith("/waves")) {
        return second
          ? { status: 200, body: [{}] }
          : { status: 200, body: [waveSummary({ wave: "w-3" })] };
      }
      return { status: 200, body: waveView() };
    });
    const { app, timers } = harness({ pathname: "/p/alpha", fetchImpl: flaky });
    app.start();
    await flush();
    expect(textsOf(root(), ".wave code")).toStrictEqual(["w-3"]);

    second = true;
    timers.runLast();
    await flush();

    expect(timers.scheduled).toHaveLength(1);
    expect(textsOf(root(), ".wave code")).toStrictEqual(["w-3"]);
    expect(textOf(root().querySelector(".note"))).toBe("offline, retrying");
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
    expect(textsOf(root(), ".card-name")).toStrictEqual(["Alpha"]);

    second = true;
    timers.runLast();
    await flush();

    expect(timers.scheduled).toHaveLength(1);
    expect(textsOf(root(), ".card-name")).toStrictEqual(["Alpha"]);
    expect(textOf(root().querySelector(".note"))).toBe("offline, retrying");
    app.stop();
  });

  it("asks for no wave at all when every wave is past retention", async () => {
    const fetchImpl = fetchStub((path) => {
      const rail = railAnswer(path);
      if (rail !== undefined) {
        return rail;
      }
      return path === "/api/v1/projects/alpha/waves"
        ? { status: 200, body: [waveSummary({ retained: false })] }
        : { status: 200, body: waveView() };
    });
    const { app } = harness({ pathname: "/p/alpha", fetchImpl });
    app.start();
    await flush();
    expect(fetchImpl.calls).toStrictEqual([
      "/api/v1/projects",
      "/api/v1/attention",
      "/api/v1/projects/alpha/waves",
    ]);
    expect(textsOf(root(), ".empty")).toStrictEqual([
      "Every wave is past retention.",
      "That wave is no longer stored.",
    ]);
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
      fetchImpl: fetchStub(projectWaves),
      withoutRoot: true,
    });
    app.start();
    await flush();
    expect(document.getElementById("root")).toBeNull();
    expect(document.title).toBe("waves — alpha");
    app.stop();
  });
});
