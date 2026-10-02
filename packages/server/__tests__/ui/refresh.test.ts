import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  LaneDerivedView,
  LaneView,
} from "../../src/application/read-model.js";
import type { AppGlobals } from "../../public/app.js";
import { createApp, REFRESH_MS } from "../../public/app.js";

import type { Answer, FetchStub, TimerStub } from "./helpers.js";
import {
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

function listing(...projects: unknown[]): (path: string) => Answer {
  return (path) =>
    path === "/api/v1/projects"
      ? { status: 200, body: projects }
      : { status: 404 };
}

/** The rail's answer on any route: one project, so the rail has something. */
function railAnswer(path: string): Answer | undefined {
  return path === "/api/v1/projects"
    ? { status: 200, body: [projectCard()] }
    : undefined;
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
    expect(fetchImpl.calls).toStrictEqual(["/api/v1/projects"]);
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
    const fetchImpl = gatedFetch(() => ({
      status: 200,
      body: [projectCard()],
    }));
    const { app, timers } = harness({ fetchImpl });

    app.start();
    await flush();
    expect(fetchImpl.calls).toHaveLength(1);
    expect(fetchImpl.pending()).toBe(1);
    fetchImpl.release();
    await flush();
    expect(timers.scheduled).toHaveLength(1);

    timers.runLast();
    await flush();
    expect(fetchImpl.calls).toHaveLength(2);
    expect(fetchImpl.pending()).toBe(1);
    expect(timers.scheduled).toHaveLength(0);

    setHidden(true);
    visible();
    setHidden(false);
    visible();
    expect(fetchImpl.calls).toHaveLength(2);

    fetchImpl.release();
    await flush();

    expect(fetchImpl.calls).toHaveLength(2);
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
    const flaky = fetchStub(() =>
      second
        ? { status: 200, body: [null] }
        : {
            status: 200,
            body: [projectCard(), projectCard({ id: "beta", name: "Beta" })],
          },
    );
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
    expect(fetchImpl.calls).toStrictEqual(["/api/v1/projects"]);
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
    const flaky = fetchStub(() =>
      broken ? { status: 500 } : { status: 200, body: [projectCard()] },
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

describe("pausing while the page is hidden", () => {
  it("arms no timer at all when the page starts hidden", async () => {
    setHidden(true);
    const fetchImpl = fetchStub(listing(projectCard()));
    const { app, timers } = harness({ fetchImpl });
    app.start();
    await flush();
    expect(fetchImpl.calls).toHaveLength(1);
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
    expect(fetchImpl.calls).toHaveLength(1);

    setHidden(false);
    visible();
    await flush();
    expect(fetchImpl.calls).toHaveLength(2);
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
    const flaky = fetchStub(() =>
      second
        ? { status: 200, body: [{}] }
        : { status: 200, body: [projectCard()] },
    );
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

  it("says so when the page is not one of ours", async () => {
    const fetchImpl = fetchStub(() => ({ status: 200, body: [] }));
    const { app } = harness({ pathname: "/elsewhere", fetchImpl });
    app.start();
    await flush();
    expect(textsOf(root(), ".empty")).toStrictEqual(["No such page."]);
    expect(fetchImpl.calls).toStrictEqual([]);
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
