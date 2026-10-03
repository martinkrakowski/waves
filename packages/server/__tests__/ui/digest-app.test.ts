import { describe, expect, it } from "vitest";

import type { AppGlobals } from "../../public/app.js";
import { createApp, REFRESH_MS } from "../../public/app.js";

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
  root,
  textOf,
  textsOf,
  timerStub,
} from "./helpers.js";

/**
 * Every wave alpha's listing answers with: one lane in each, the newest first,
 * and the newest one stale so the digest has a stale line to say.
 */
function listing() {
  return projectLanes({
    project: { id: "alpha", name: "Alpha" },
    waves: [
      waveSummary({ wave: "w-3", stale: true }),
      waveSummary({ wave: "w-2", receivedAt: "2026-04-01T11:00:00.000Z" }),
    ],
    lanes: [
      laneRow({ wave: "w-3", id: "wv-a", seat: "s1", reasons: ["gate"] }),
      laneRow({ wave: "w-2", id: "wv-a", seat: "s2", reasons: ["failed"] }),
    ],
  });
}

function answering(): (path: string) => Answer {
  return (path) => {
    if (path === "/api/v1/projects") {
      return { status: 200, body: [projectCard()] };
    }
    if (path === "/api/v1/attention") {
      return { status: 200, body: attentionView() };
    }
    return { status: 200, body: listing() };
  };
}

/** A clipboard that writes, and says whether it wrote or refused. */
interface Clipboard {
  readonly received: string[];
  /** Answers every write still waiting, all of them at once. */
  readonly release: () => void;
  writeText(text: string): Promise<void>;
}

function clipboardOf(outcome: "writes" | "refuses" | "throws"): Clipboard {
  const received: string[] = [];
  const waiting: (() => void)[] = [];
  return {
    received,
    release: () => {
      for (const answer of waiting.splice(0)) {
        answer();
      }
    },
    writeText(text: string): Promise<void> {
      received.push(text);
      if (outcome === "throws") {
        throw new Error("the browser refused synchronously");
      }
      return new Promise<void>((resolve, reject) => {
        waiting.push(() => {
          if (outcome === "refuses") {
            reject(new Error("the browser refused"));
            return;
          }
          resolve();
        });
      });
    },
  };
}

interface Harness {
  readonly app: ReturnType<typeof createApp>;
  readonly browser: ReturnType<typeof browserGlobals>;
  readonly timers: TimerStub;
}

/**
 * The app on a project's own page, with the clipboard it is handed. Without one
 * the page has no clipboard at all, which is what a browser outside a secure
 * context gives it.
 */
function harness(options: {
  readonly search?: string;
  readonly clipboard?: Clipboard | undefined;
}): Harness {
  freshRoot();
  const timers = timerStub();
  const browser = browserGlobals("/p/alpha", options.search ?? "");
  const app = createApp({
    doc: document,
    location: browser.location,
    history: browser.history,
    win: browser.win,
    fetch: fetchStub(answering()) as FetchStub,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    clock: () => NOW_MS,
    refreshMs: REFRESH_MS,
    ...(options.clipboard === undefined
      ? {}
      : { clipboard: options.clipboard }),
  } satisfies AppGlobals);
  return { app, browser, timers };
}

/** The button, and what it last said. */
function button(): HTMLElement {
  return root().querySelector('[data-key="digest"]') as HTMLElement;
}

function said(): string {
  return textOf(root().querySelector(".toolbar .copied"));
}

async function booted(
  options: {
    readonly search?: string;
    readonly clipboard?: Clipboard | undefined;
  } = { clipboard: clipboardOf("writes") },
): Promise<Harness & { readonly clipboard: Clipboard }> {
  const drawn = harness(options);
  drawn.app.start();
  await flush();
  return { ...drawn, clipboard: options.clipboard ?? clipboardOf("writes") };
}

describe("the copy digest button", () => {
  it("copies the digest and says that it did", async () => {
    const clipboard = clipboardOf("writes");
    const { app } = await booted({ search: "?reason=gate", clipboard });
    expect(said()).toBe("");

    button().click();
    clipboard.release();
    await flush();

    expect(said()).toBe("Digest copied");
    expect(clipboard.received).toHaveLength(1);
    const text = clipboard.received[0] ?? "";
    expect(text.endsWith("View: http://test/p/alpha?reason=gate\n")).toBe(true);
    // Over the rows on screen, which the filter narrowed to one.
    expect(text).toContain("1 of 2 lanes shown");
    expect(text).toContain("- w-3/wv-a: gate");
    expect(text).not.toContain("wv-a: failed");
    expect(text).toContain("View: http://test/p/alpha?reason=gate");
    app.stop();
  });

  it("copies the whole scope when nothing is filtered", async () => {
    const clipboard = clipboardOf("writes");
    const { app } = await booted({ clipboard });

    button().click();
    clipboard.release();
    await flush();

    const text = clipboard.received[0] ?? "";
    expect(text).toContain("2 of 2 lanes shown");
    expect(text).toContain("stale waves: w-3");
    expect(text).toContain("> w-3/wv-a seat: s1");
    expect(text).toContain("> w-2/wv-a seat: s2");
    expect(text.endsWith("View: http://test/p/alpha\n")).toBe(true);
    app.stop();
  });

  it("says a copy the browser refused did not happen", async () => {
    const clipboard = clipboardOf("refuses");
    const { app } = await booted({ clipboard });

    button().click();
    clipboard.release();
    await flush();

    expect(said()).toBe("Copy failed");
    expect(clipboard.received).toHaveLength(1);
    app.stop();
  });

  it("says a copy that threw at the browser did not happen either", async () => {
    const clipboard = clipboardOf("throws");
    const { app } = await booted({ clipboard });

    button().click();
    await flush();

    expect(said()).toBe("Copy failed");
    app.stop();
  });

  it("says so when the browser has no clipboard at all", async () => {
    const { app } = harness({});
    app.start();
    await flush();

    button().click();
    await flush();

    expect(said()).toBe("Copy failed");
    app.stop();
  });

  it("puts the focus back on the button after the redraw the copy causes", async () => {
    const clipboard = clipboardOf("writes");
    const { app } = await booted({ clipboard });
    const before = button();
    before.focus();
    expect(document.activeElement).toBe(before);

    before.click();
    clipboard.release();
    await flush();

    const after = button();
    expect(after).not.toBe(before);
    expect(document.activeElement).toBe(after);
    expect(textsOf(root(), ".toolbar .shown")).toHaveLength(1);
    app.stop();
  });
});

describe("a note about a copy", () => {
  it("is cleared by a navigation, in either direction", async () => {
    const clipboard = clipboardOf("writes");
    const { app, browser } = await booted({ clipboard });
    button().click();
    clipboard.release();
    await flush();
    expect(said()).toBe("Digest copied");

    // A filter, which is the branch that redraws from the data in hand.
    app.navigate("/p/alpha?seat=s2");
    await flush();

    expect(said()).toBe("");
    // And a project, which is the branch that asks again.
    app.navigate("/p/beta");
    await flush();
    app.navigate("/p/alpha");
    await flush();
    expect(said()).toBe("");
    expect(browser.pushes).toStrictEqual([
      "/p/alpha?seat=s2",
      "/p/beta",
      "/p/alpha",
    ]);
    app.stop();
  });

  it("is not written by a copy that settles after the address moved", async () => {
    const clipboard = clipboardOf("writes");
    const { app } = await booted({ clipboard });

    button().click();
    expect(said()).toBe("");

    app.navigate("/p/alpha?seat=s2");
    await flush();
    clipboard.release();
    await flush();

    // The copy was of a page the reader has left: nothing to say about this one.
    expect(said()).toBe("");
    expect(clipboard.received).toHaveLength(1);
    app.stop();
  });

  it("is not written by a copy that settles after the reader left and came back", async () => {
    const clipboard = clipboardOf("writes");
    const { app } = await booted({ clipboard });

    button().click();
    app.navigate("/p/alpha?seat=s2");
    await flush();
    app.navigate("/p/alpha");
    await flush();
    clipboard.release();
    await flush();

    // The same address, but not the same visit: this page copied nothing.
    expect(said()).toBe("");
    app.stop();
  });

  it("is cleared even when the copy that is settling will never arrive", async () => {
    const clipboard = clipboardOf("refuses");
    const { app } = await booted({ clipboard });

    button().click();
    app.navigate("/p/alpha?seat=s2");
    await flush();
    clipboard.release();
    await flush();

    expect(said()).toBe("");
    app.stop();
  });
});
