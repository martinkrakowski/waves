import { describe, expect, it } from "vitest";

import type { AppGlobals } from "../../public/app.js";
import { createApp, REFRESH_MS } from "../../public/app.js";
import type { ApiResponse } from "../../public/api.js";

import type {
  LaneRow,
  ProjectLanesView,
  WaveView,
} from "../../src/application/read-model.js";
import {
  attentionView,
  envelope,
  lane,
  laneRow,
  NOW_ISO,
  NOW_MS,
  projectCard,
  projectLanes,
  waveSummary,
  waveView,
} from "./fixtures.js";
import type { Answer, FetchStub, GatedFetch, TimerStub } from "./helpers.js";
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

/** The waves alpha's listing answers with, newest first. */
const WAVES = ["w-3", "w-2"];

const REPO = "https://github.com/acme/waves";

/**
 * Alpha's whole answer: two waves, and both lanes of the newest one beside the
 * second lane of the older one. A drawer test needs a listing that holds the lane
 * it opens, in the wave it opens it in, because the reasons it shows and the pull
 * request it links come from there.
 */
function listing(overrides: Partial<ProjectLanesView> = {}): ProjectLanesView {
  return projectLanes({
    project: { id: "alpha", name: "Alpha", repo: REPO },
    waves: WAVES.map((wave, at) =>
      waveSummary({
        wave,
        receivedAt: at === 0 ? NOW_ISO : "2026-04-01T11:50:00.000Z",
      }),
    ),
    lanes: [
      laneRow({ wave: "w-3" }),
      laneRow({ wave: "w-3", id: "wv-b", seat: "s2" }),
      laneRow({ wave: "w-2", id: "wv-b", seat: "s2" }),
    ],
    ...overrides,
  });
}

/** One lane of the listing, for a test that opens it. */
function row(overrides: Partial<LaneRow> = {}): LaneRow {
  return laneRow({ wave: "w-3", ...overrides });
}

/** The wave the drawer gets for any wave it asks for, holding both its lanes. */
function answerFor(wave: string, lanes = undefined): WaveView {
  return waveView({
    envelope: envelope({
      wave,
      ...(lanes === undefined ? {} : { lanes }),
    }),
  });
}

/**
 * The rail's two lists, alpha's lanes, and one wave per wave the test names. A
 * wave it names nothing for answers with that wave's own envelope, so a test that
 * opens `wv-b` finds it.
 */
function answering(
  waves: Readonly<Record<string, Answer>> = {},
  lanes: ProjectLanesView = listing(),
): (path: string) => Answer {
  return (path) => {
    if (path === "/api/v1/projects") {
      return { status: 200, body: [projectCard({ repo: REPO })] };
    }
    if (path === "/api/v1/attention") {
      return { status: 200, body: attentionView() };
    }
    if (/^\/api\/v1\/projects\/[^/]+\/lanes(?:\?all=1)?$/.test(path)) {
      return { status: 200, body: lanes };
    }
    const wave = /^\/api\/v1\/projects\/[^/]+\/waves\/([^/]+)$/.exec(path);
    if (wave !== null) {
      const id = wave[1] ?? "";
      return waves[id] ?? { status: 200, body: answerFor(id) };
    }
    return { status: 404 };
  };
}

/** Everything answers except the one wave the drawer asks for, which fails. */
function waveRefused(
  handler: (path: string) => Answer = answering(),
): FetchStub {
  const inner = fetchStub(handler);
  const calls: string[] = [];
  const impl = async (path: string): Promise<ApiResponse> => {
    if (/\/waves\//.test(path)) {
      calls.push(path);
      throw new Error(`network is down for ${path}`);
    }
    return inner(path);
  };
  return Object.assign(impl, { calls });
}

/** Everything answers except the first wave the drawer asks for, which fails late. */
function lateFailure(handler: (path: string) => Answer = answering()): {
  readonly impl: FetchStub;
  readonly release: () => void;
} {
  const inner = fetchStub(handler);
  const calls: string[] = [];
  let fail = (): void => undefined;
  let first = true;
  const impl = (path: string): Promise<ApiResponse> => {
    calls.push(path);
    if (!/\/waves\//.test(path)) {
      return inner(path);
    }
    if (first) {
      first = false;
      return new Promise((_resolve, reject) => {
        fail = () => {
          reject(new Error(`network is down for ${path}`));
        };
      });
    }
    return inner(path);
  };
  return { impl: Object.assign(impl, { calls }), release: () => fail() };
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

interface Harness {
  readonly app: ReturnType<typeof createApp>;
  readonly browser: ReturnType<typeof browserGlobals>;
  readonly timers: TimerStub;
}

function harness(options: {
  readonly pathname?: string;
  readonly search?: string;
  readonly fetchImpl?: FetchStub | GatedFetch;
  readonly withoutRoot?: boolean;
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
    fetch: options.fetchImpl ?? fetchStub(answering()),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    clock: () => NOW_MS,
    refreshMs: REFRESH_MS,
  } satisfies AppGlobals);
  return { app, browser, timers };
}

/** The one dialog in the document, which is the drawer's. */
function dialog(): HTMLDialogElement {
  const found = document.querySelector("dialog");
  expect(found).not.toBeNull();
  return found as HTMLDialogElement;
}

/** The dialog's own Close control. */
function closeButton(): HTMLElement {
  return dialog().querySelector('[data-key="close"]') as HTMLElement;
}

/** Every path asked for that names one wave. */
function wavesAskedFor(calls: readonly string[]): string[] {
  return calls.filter((path) => /\/waves\//.test(path));
}

/** The lane links in the table, in the order the table drew them. */
function laneLinks(): HTMLElement[] {
  return Array.from(root().querySelectorAll("td[data-label='Lane'] a"));
}

function escape(node: HTMLElement): void {
  node.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", cancelable: true }),
  );
}

/**
 * The four ways a reader closes the drawer, each one the page's own code: the
 * Close control, the event a browser fires for `Esc`, `Esc` itself, and a click
 * on the backdrop — which is a click whose target is the dialog itself.
 */
const CLOSERS: Readonly<Record<string, (node: HTMLDialogElement) => void>> = {
  "the Close control": (node) => close(node),
  "a cancel event": (node) =>
    node.dispatchEvent(new Event("cancel", { cancelable: true })),
  "an Escape keydown": (node) => escape(node),
  "a click on the dialog itself": (node) =>
    node.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    ),
};

function close(node: HTMLElement): void {
  (node.querySelector('[data-key="close"]') as HTMLElement).click();
}

describe("a lane's own address", () => {
  it("opens the drawer on it, asks for its wave once, and keeps Close focused", async () => {
    const fetchImpl = fetchStub(answering());
    const { app } = harness({
      pathname: "/p/alpha/w/w-3",
      search: "?lane=wv-b",
      fetchImpl,
    });
    app.start();
    await flush();

    expect(dialog().getAttribute("class")).toBe("lane-drawer");
    expect(dialog().getAttribute("aria-labelledby")).toBe("drawer-title");
    expect(dialog().open).toBe(true);
    expect(wavesAskedFor(fetchImpl.calls)).toStrictEqual([
      "/api/v1/projects/alpha/waves/w-3",
    ]);
    expect(textsOf(dialog(), "#drawer-title")).toStrictEqual(["wv-b"]);
    expect(textsOf(dialog(), "header code")).toStrictEqual(["w-3"]);
    expect(textsOf(dialog(), "h3")).toContain("Log tail");
    // The reader has not moved, so the repaint that replaced the button leaves the
    // focus on the button that replaced it.
    expect(document.activeElement).toBe(closeButton());
    app.stop();
  });

  it("opens when a lane link in the table is clicked", async () => {
    const fetchImpl = fetchStub(answering());
    const { app, browser } = harness({
      pathname: "/p/alpha/w/w-3",
      fetchImpl,
    });
    app.start();
    await flush();
    // The dialog is beside the page the whole time; what the address decides is
    // whether it is open.
    expect(dialog().open).toBe(false);

    const link = laneLinks()[0] as HTMLElement;
    expect(link.getAttribute("href")).toBe("/p/alpha/w/w-3?lane=wv-a");
    link.click();
    await flush();

    expect(browser.pushes).toStrictEqual(["/p/alpha/w/w-3?lane=wv-a"]);
    expect(dialog().open).toBe(true);
    expect(textsOf(dialog(), "#drawer-title")).toStrictEqual(["wv-a"]);
    expect(wavesAskedFor(fetchImpl.calls)).toStrictEqual([
      "/api/v1/projects/alpha/waves/w-3",
    ]);
    app.stop();
  });

  it("shows the reasons the listing holds for the lane", async () => {
    const fetchImpl = fetchStub(
      answering({}, listing({ lanes: [row({ reasons: ["gate", "failed"] })] })),
    );
    const { app } = harness({
      pathname: "/p/alpha/w/w-3",
      search: "?lane=wv-a",
      fetchImpl,
    });
    app.start();
    await flush();

    expect(textsOf(dialog(), ".badge")).toStrictEqual(["gate", "failed"]);
    app.stop();
  });

  it("opens nothing for a route with no listing drawn on it", async () => {
    const fetchImpl = fetchStub((path) =>
      path === "/api/v1/projects"
        ? { status: 200, body: [projectCard()] }
        : path === "/api/v1/attention"
          ? { status: 200, body: attentionView() }
          : { status: 404 },
    );
    const { app } = harness({
      pathname: "/p/nope/w/w-1",
      search: "?lane=wv-b",
      fetchImpl,
    });
    app.start();
    await flush();

    expect(textOf(root().querySelector(".empty"))).toBe("No such project.");
    expect(dialog().open).toBe(false);
    expect(wavesAskedFor(fetchImpl.calls)).toStrictEqual([]);
    app.stop();
  });

  it("opens nothing for a lane on the project's own page", async () => {
    const fetchImpl = fetchStub(answering());
    const { app } = harness({
      pathname: "/p/alpha",
      search: "?lane=wv-b",
      fetchImpl,
    });
    app.start();
    await flush();

    // A lane id recurs across waves, so without a wave the query marks both rows
    // that carry it and opens nothing: it names no single lane.
    expect(root().querySelectorAll("tbody tr.current")).toHaveLength(2);
    expect(dialog().open).toBe(false);
    expect(wavesAskedFor(fetchImpl.calls)).toStrictEqual([]);
    app.stop();
  });
});

describe("closing the drawer", () => {
  it.each(Object.entries(CLOSERS))(
    "closes on %s, takes lane out of the address and puts the focus on the row",
    async (_which, closeIt) => {
      const { app, browser } = harness({
        pathname: "/p/alpha/w/w-3",
        search: "?lane=wv-a",
      });
      app.start();
      await flush();
      expect(dialog().open).toBe(true);

      closeIt(dialog());

      expect(dialog().open).toBe(false);
      expect(browser.pushes).toStrictEqual(["/p/alpha/w/w-3"]);
      expect(laneLinks()[0]?.getAttribute("href")).toBe(
        "/p/alpha/w/w-3?lane=wv-a",
      );
      expect(document.activeElement).toBe(laneLinks()[0]);
      app.stop();
    },
  );

  it("keeps nothing of the lane in the document once it is closed", async () => {
    const { app } = harness({
      pathname: "/p/alpha/w/w-3",
      search: "?lane=wv-a",
    });
    app.start();
    await flush();
    expect(dialog().children.length).toBeGreaterThan(0);

    closeButton().click();

    expect(dialog().children).toHaveLength(0);
    expect(textOf(dialog())).toBe("");
    app.stop();
  });

  it("leaves the drawer alone for a click inside it", async () => {
    const { app, browser } = harness({
      pathname: "/p/alpha/w/w-3",
      search: "?lane=wv-a",
    });
    app.start();
    await flush();

    (dialog().querySelector("#drawer-title") as HTMLElement).dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    (dialog().querySelector("pre") as HTMLElement).dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );

    expect(dialog().open).toBe(true);
    expect(browser.pushes).toStrictEqual([]);
    app.stop();
  });

  it("pushes one address for two escapes", async () => {
    const { app, browser } = harness({
      pathname: "/p/alpha/w/w-3",
      search: "?lane=wv-a",
    });
    app.start();
    await flush();

    escape(dialog());
    escape(dialog());

    expect(browser.pushes).toStrictEqual(["/p/alpha/w/w-3"]);
    expect(dialog().open).toBe(false);
    app.stop();
  });

  it("leaves every other key to the page", async () => {
    const { app, browser } = harness({
      pathname: "/p/alpha/w/w-3",
      search: "?lane=wv-a",
    });
    app.start();
    await flush();

    dialog().dispatchEvent(
      new KeyboardEvent("keydown", { key: "a", cancelable: true }),
    );

    expect(dialog().open).toBe(true);
    expect(browser.pushes).toStrictEqual([]);
    app.stop();
  });

  it("takes lane out of the address when the browser closes the dialog", async () => {
    const { app, browser } = harness({
      pathname: "/p/alpha/w/w-3",
      search: "?lane=wv-a",
    });
    app.start();
    await flush();

    dialog().close();

    expect(browser.pushes).toStrictEqual(["/p/alpha/w/w-3"]);
    expect(dialog().open).toBe(false);
    expect(document.activeElement).toBe(laneLinks()[0]);
    app.stop();
  });

  it("focuses nothing when the filter hides the row", async () => {
    const { app, browser } = harness({
      pathname: "/p/alpha/w/w-3",
      search: "?reason=gate&lane=wv-a",
    });
    app.start();
    await flush();
    // No row in this scope carries that reason, so the table says so rather than
    // showing one, and there is no lane link to put the focus back on.
    expect(textsOf(root(), ".empty")).toStrictEqual(["No lanes match."]);
    expect(laneLinks()).toHaveLength(0);

    closeButton().click();

    expect(dialog().open).toBe(false);
    expect(browser.pushes).toStrictEqual(["/p/alpha/w/w-3?reason=gate"]);
    expect(document.activeElement?.getAttribute("href")).toBeNull();
    app.stop();
  });
});

describe("the address while the drawer is open", () => {
  it("closes on Back and opens again on the way forward", async () => {
    const fetchImpl = fetchStub(answering());
    const { app, browser } = harness({
      pathname: "/p/alpha/w/w-3",
      search: "?lane=wv-a",
      fetchImpl,
    });
    app.start();
    await flush();
    expect(dialog().open).toBe(true);

    // Where Back would have gone, and the event it would have fired.
    browser.history.replaceState(null, "", "/p/alpha/w/w-3");
    browser.popstate();

    expect(dialog().open).toBe(false);
    expect(browser.pushes).toStrictEqual([]);

    browser.history.replaceState(null, "", "/p/alpha/w/w-3?lane=wv-a");
    browser.popstate();
    await flush();

    expect(dialog().open).toBe(true);
    expect(wavesAskedFor(fetchImpl.calls)).toStrictEqual([
      "/api/v1/projects/alpha/waves/w-3",
      "/api/v1/projects/alpha/waves/w-3",
    ]);
    app.stop();
  });

  it("asks for nothing else on a refresh pass, and leaves the focus in the drawer", async () => {
    const fetchImpl = fetchStub(answering());
    const { app } = harness({
      pathname: "/p/alpha/w/w-3",
      search: "?lane=wv-a",
      fetchImpl,
    });
    app.start();
    await flush();
    const shown = dialog().querySelector("pre") as HTMLElement;

    await app.refresh();

    expect(wavesAskedFor(fetchImpl.calls)).toStrictEqual([
      "/api/v1/projects/alpha/waves/w-3",
    ]);
    // The drawer is not part of `#root`, so the redraw cannot take the focus with
    // it, and the drawer is not repainted: it shows the snapshot it opened on.
    expect(dialog().contains(document.activeElement)).toBe(true);
    expect(dialog().querySelector("pre")).toBe(shown);
    app.stop();
  });

  it("does not send `/` to the search box while the drawer is open", async () => {
    const { app } = harness({
      pathname: "/p/alpha/w/w-3",
      search: "?lane=wv-a",
    });
    app.start();
    await flush();
    const before = document.activeElement;

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "/", cancelable: true }),
    );

    expect(document.activeElement).toBe(before);
    expect(document.activeElement).toBe(closeButton());
    app.stop();
  });
});

describe("what the wave route answered", () => {
  const FAILED =
    "This lane could not be read. Close and open it again to retry.";

  it("says a wave this project no longer holds is gone", async () => {
    const { app } = harness({
      pathname: "/p/alpha/w/w-3",
      search: "?lane=wv-a",
      fetchImpl: fetchStub(answering({ "w-3": { status: 404 } })),
    });
    app.start();
    await flush();

    expect(textsOf(dialog(), "p.panel-empty")).toStrictEqual([
      "This wave is no longer held by the service.",
    ]);
    app.stop();
  });

  it("says an answer that is not a wave could not be read", async () => {
    const { app } = harness({
      pathname: "/p/alpha/w/w-3",
      search: "?lane=wv-a",
      fetchImpl: fetchStub(
        answering({ "w-3": { status: 200, body: { nope: 1 } } }),
      ),
    });
    app.start();
    await flush();

    expect(textsOf(dialog(), "p.panel-empty")).toStrictEqual([FAILED]);
    app.stop();
  });

  it("says another wave's answer could not be read", async () => {
    const { app } = harness({
      pathname: "/p/alpha/w/w-2",
      search: "?lane=wv-b",
      fetchImpl: fetchStub(
        answering({ "w-2": { status: 200, body: answerFor("w-3") } }),
      ),
    });
    app.start();
    await flush();

    expect(textsOf(dialog(), "p.panel-empty")).toStrictEqual([FAILED]);
    app.stop();
  });

  it("says a fetch that failed could not be read", async () => {
    const { app } = harness({
      pathname: "/p/alpha/w/w-3",
      search: "?lane=wv-a",
      fetchImpl: waveRefused(),
    });
    app.start();
    await flush();

    expect(textsOf(dialog(), "p.panel-empty")).toStrictEqual([FAILED]);
    expect(root().querySelectorAll(".note")).toHaveLength(0);
    app.stop();
  });

  it("says a wave that holds no such lane holds no lane with this id", async () => {
    const { app } = harness({
      pathname: "/p/alpha/w/w-3",
      search: "?lane=wv-z",
    });
    app.start();
    await flush();

    expect(textsOf(dialog(), "p.panel-empty")).toStrictEqual([
      "This wave holds no lane with this id.",
    ]);
    app.stop();
  });

  it("draws a lane the view could not read as a read that failed", async () => {
    // The fixture's own reported block with `detail` set to `null`: the contract
    // does not allow it and the drawer cannot read it, which is a failed read
    // rather than a half-drawn drawer.
    const unreadable = waveView({
      envelope: envelope({
        lanes: [
          lane({
            reported: {
              stage: "review",
              event: "settled",
              ts: NOW_ISO,
              pr: 42,
              round: 2,
              detail: null as unknown as Record<string, unknown>,
            },
          }),
          lane({ id: "wv-b", seat: undefined }),
        ],
      }),
    });
    const { app } = harness({
      pathname: "/p/alpha/w/w-3",
      search: "?lane=wv-a",
      fetchImpl: fetchStub(
        answering({ "w-3": { status: 200, body: unreadable } }),
      ),
    });
    app.start();
    await flush();

    expect(textsOf(dialog(), "p.panel-empty")).toStrictEqual([FAILED]);
    app.stop();
  });
});

describe("two lanes in flight", () => {
  it("paints nothing for an answer that arrives after the reader chose again", async () => {
    const gate = holding(
      answering(),
      (path) => path === "/api/v1/projects/alpha/waves/w-3",
    );
    const { app } = harness({
      pathname: "/p/alpha/w/w-3",
      search: "?lane=wv-a",
      fetchImpl: gate,
    });
    app.start();
    await flush();
    expect(gate.pending()).toBe(1);
    expect(textsOf(dialog(), "p.panel-empty")).toStrictEqual(["Loading…"]);

    app.navigate("/p/alpha/w/w-3?lane=wv-b");
    await flush();
    expect(textsOf(dialog(), "#drawer-title")).toStrictEqual(["wv-b"]);
    expect(textsOf(dialog(), "h3")).toContain("Log tail");

    gate.release();
    await flush();

    // The first wave answered, but it answered for a drawer that is no longer on
    // screen: it says nothing about the lane the reader is reading now.
    expect(textsOf(dialog(), "#drawer-title")).toStrictEqual(["wv-b"]);
    expect(textsOf(dialog(), "p.panel-empty")).toHaveLength(0);
    expect(textsOf(dialog(), "h3")).toContain("Reported and derived");
    app.stop();
  });

  it("keeps the later lane's own answer when an earlier wave arrives late", async () => {
    const gate = holding(
      answering({ "w-2": { status: 404 } }),
      (path) => path === "/api/v1/projects/alpha/waves/w-3",
    );
    const { app } = harness({
      pathname: "/p/alpha/w/w-3",
      search: "?lane=wv-a",
      fetchImpl: gate,
    });
    app.start();
    await flush();
    expect(gate.pending()).toBe(1);

    app.navigate("/p/alpha/w/w-2?lane=wv-b");
    await flush();
    expect(textsOf(dialog(), "#drawer-title")).toStrictEqual(["wv-b"]);
    expect(textsOf(dialog(), "p.panel-empty")).toStrictEqual([
      "This wave is no longer held by the service.",
    ]);

    gate.release();
    await flush();

    expect(textsOf(dialog(), "#drawer-title")).toStrictEqual(["wv-b"]);
    expect(textsOf(dialog(), "p.panel-empty")).toStrictEqual([
      "This wave is no longer held by the service.",
    ]);
    app.stop();
  });

  it("paints nothing when a failed wave arrives after the reader chose again", async () => {
    const wave = lateFailure();
    const { app } = harness({
      pathname: "/p/alpha/w/w-3",
      search: "?lane=wv-a",
      fetchImpl: wave.impl,
    });
    app.start();
    await flush();
    expect(textsOf(dialog(), "p.panel-empty")).toStrictEqual(["Loading…"]);

    app.navigate("/p/alpha/w/w-3?lane=wv-b");
    await flush();
    expect(textsOf(dialog(), "#drawer-title")).toStrictEqual(["wv-b"]);

    wave.release();
    await flush();

    // The failure belongs to a drawer that is no longer on screen, so the lane
    // the reader is reading now is neither replaced nor marked as failed.
    expect(textsOf(dialog(), "#drawer-title")).toStrictEqual(["wv-b"]);
    expect(textsOf(dialog(), "p.panel-empty")).toHaveLength(0);
    expect(textsOf(dialog(), "h3")).toContain("Log tail");
    app.stop();
  });

  it("leaves the focus where the reader moved it when the wave answers", async () => {
    const gate = holding(
      answering(),
      (path) => path === "/api/v1/projects/alpha/waves/w-3",
    );
    const { app } = harness({
      pathname: "/p/alpha/w/w-3",
      search: "?lane=wv-a",
      fetchImpl: gate,
    });
    app.start();
    await flush();
    // The reader tabs back to the table while the wave is still on its way.
    const link = laneLinks()[1] as HTMLElement;
    link.focus();
    expect(document.activeElement).toBe(link);

    gate.release();
    await flush();

    expect(document.activeElement).toBe(link);
    expect(document.activeElement).not.toBe(closeButton());
    app.stop();
  });
});

describe("stopping", () => {
  it("closes and takes the dialog out of the document, and its listeners with it", async () => {
    const { app, browser } = harness({
      pathname: "/p/alpha/w/w-3",
      search: "?lane=wv-a",
    });
    app.start();
    await flush();
    const node = dialog();

    app.stop();

    expect(node.open).toBe(false);
    expect(document.querySelectorAll("dialog")).toHaveLength(0);
    escape(node);
    node.dispatchEvent(new Event("cancel", { cancelable: true }));
    expect(browser.pushes).toStrictEqual([]);
  });

  it("asks for the wave again when it starts on the same lane", async () => {
    const fetchImpl = fetchStub(answering());
    const { app } = harness({
      pathname: "/p/alpha/w/w-3",
      search: "?lane=wv-a",
      fetchImpl,
    });
    app.start();
    await flush();
    app.stop();

    app.start();
    await flush();

    expect(dialog().open).toBe(true);
    expect(textsOf(dialog(), "#drawer-title")).toStrictEqual(["wv-a"]);
    expect(wavesAskedFor(fetchImpl.calls)).toStrictEqual([
      "/api/v1/projects/alpha/waves/w-3",
      "/api/v1/projects/alpha/waves/w-3",
    ]);
    app.stop();
  });

  it("touches no dialog at all when the page has no root", async () => {
    const fetchImpl = fetchStub(answering());
    const { app } = harness({
      pathname: "/p/alpha/w/w-3",
      search: "?lane=wv-a",
      fetchImpl,
      withoutRoot: true,
    });
    app.start();
    await flush();

    expect(document.querySelectorAll("dialog")).toHaveLength(0);
    expect(wavesAskedFor(fetchImpl.calls)).toStrictEqual([]);
    app.stop();
  });
});
