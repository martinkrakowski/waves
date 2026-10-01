import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppGlobals } from "../../public/app.js";
import { createApp, REFRESH_MS } from "../../public/app.js";

import type { Answer, FetchStub, TimerStub } from "./helpers.js";
import { NOW_MS, projectCard, waveSummary, waveView } from "./fixtures.js";
import {
  fetchStub,
  flush,
  freshRoot,
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
}

function harness(options: {
  pathname?: string;
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
  const app = createApp({
    doc: document,
    location: { pathname: options.pathname ?? "/" },
    fetch: options.fetchImpl,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    clock: () => NOW_MS,
    refreshMs: options.refreshMs ?? REFRESH_MS,
  } satisfies AppGlobals);
  return { app, timers };
}

function listing(...projects: unknown[]): (path: string) => Answer {
  return (path) =>
    path === "/api/v1/projects"
      ? { status: 200, body: projects }
      : { status: 404 };
}

function projectWaves(path: string): Answer {
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
    expect(textsOf(root(), ".empty")).toStrictEqual(["offline, retrying"]);
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
  it("loads the newest wave and its lanes", async () => {
    const fetchImpl = fetchStub(projectWaves);
    const { app } = harness({ pathname: "/p/alpha", fetchImpl });
    app.start();
    await flush();
    expect(fetchImpl.calls).toStrictEqual([
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

  it("asks for no wave at all when every wave is past retention", async () => {
    const fetchImpl = fetchStub((path) =>
      path === "/api/v1/projects/alpha/waves"
        ? { status: 200, body: [waveSummary({ retained: false })] }
        : { status: 200, body: waveView() },
    );
    const { app } = harness({ pathname: "/p/alpha", fetchImpl });
    app.start();
    await flush();
    expect(fetchImpl.calls).toStrictEqual(["/api/v1/projects/alpha/waves"]);
    expect(textsOf(root(), ".empty")).toStrictEqual([
      "Every wave is past retention.",
      "That wave is no longer stored.",
    ]);
    app.stop();
  });

  it("says so when the project is not registered", async () => {
    const { app } = harness({
      pathname: "/p/nope",
      fetchImpl: fetchStub(() => ({ status: 404 })),
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
