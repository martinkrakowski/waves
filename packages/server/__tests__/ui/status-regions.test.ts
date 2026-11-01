import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { AppGlobals } from "../../public/app.js";
import { createApp, REFRESH_MS } from "../../public/app.js";
import { renderDrawer } from "../../public/views/drawer.js";
import { renderFleet } from "../../public/views/fleet.js";

import type {
  LaneRow,
  ProjectLanesView,
  WaveSummary,
} from "../../src/application/read-model.js";
import {
  attentionLane,
  attentionView,
  envelope,
  lane,
  laneRow,
  NOW_MS,
  projectCard,
  projectLanes,
  waveSummary,
  waveView,
} from "./fixtures.js";
import type { Answer, FetchStub, TimerStub } from "./helpers.js";
import {
  browserGlobals,
  fetchStub,
  flush,
  freshRoot,
  oneOf,
  renderProjectView,
  root,
  textOf,
  timerStub,
} from "./helpers.js";

interface Harness {
  readonly app: ReturnType<typeof createApp>;
  readonly timers: TimerStub;
}

/** Boots the app on a fresh `#root`, with the browser globals and a stub clock. */
function boot(options: {
  pathname?: string;
  search?: string;
  fetchImpl: FetchStub;
  clock?: () => number;
  clipboard?: { writeText(text: string): Promise<void> };
}): Harness {
  freshRoot();
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
    refreshMs: REFRESH_MS,
    ...(options.clipboard === undefined
      ? {}
      : { clipboard: options.clipboard }),
  } satisfies AppGlobals);
  return { app, timers };
}

/** The rail's two lists on every route, and nothing else. */
function railAnswer(path: string): Answer | undefined {
  if (path === "/api/v1/projects") {
    return { status: 200, body: [projectCard()] };
  }
  if (path === "/api/v1/attention") {
    return { status: 200, body: attentionView() };
  }
  return undefined;
}

/** A project route that reads `getLanes()` afresh for every lanes request. */
function projectHandler(
  getLanes: () => ProjectLanesView,
): (path: string) => Answer {
  return (path) => {
    const rail = railAnswer(path);
    if (rail !== undefined) {
      return rail;
    }
    if (path.startsWith("/api/v1/projects/alpha/lanes")) {
      return { status: 200, body: getLanes() };
    }
    return { status: 404 };
  };
}

/** A project route whose answers can be made to fail and then recover. */
function flakyProject(): {
  fetch: FetchStub;
  fail(): void;
  recover(): void;
} {
  let down = false;
  const fetch = fetchStub((path) => {
    if (down) {
      return { status: 500 };
    }
    return projectHandler(() => projectLanes())(path);
  });
  return {
    fetch,
    fail: () => {
      down = true;
    },
    recover: () => {
      down = false;
    },
  };
}

/** Watches `root` for childList mutations and hands them out on demand. */
interface Observed {
  readonly observer: MutationObserver;
  /** Every mutation since the last call, and none before it. */
  since(): MutationRecord[];
}

function observeLive(rootNode: HTMLElement): Observed {
  const collected: MutationRecord[] = [];
  const observer = new MutationObserver((records) => {
    collected.push(...records);
  });
  observer.observe(rootNode, { childList: true, subtree: true });
  return {
    observer,
    since: () => {
      const pending = observer.takeRecords();
      const records = [...collected, ...pending];
      collected.length = 0;
      return records;
    },
  };
}

/** Asserts a node never appears in the removed or added nodes of these records. */
function notDetached(records: MutationRecord[], node: Element): void {
  for (const record of records) {
    expect(Array.from(record.removedNodes)).not.toContain(node);
    expect(Array.from(record.addedNodes)).not.toContain(node);
  }
}

/** The first rule block in a stylesheet whose selector matches the given one. */
function rule(sheet: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = sheet.match(new RegExp(`${escaped}\\s*\\{[^}]*\\}`));
  expect(match).not.toBeNull();
  return match?.[0] ?? "";
}

describe("the footbar live region", () => {
  it("stays mounted across poll, navigation, failure and recovery", async () => {
    const flaky = flakyProject();
    const { app } = boot({ fetchImpl: flaky.fetch });
    app.start();
    await flush();

    const status = oneOf(
      root(),
      "footer.footbar [role='status']",
    ) as HTMLElement;
    expect(status.className).toBe("status");
    expect(textOf(status)).toBe("");

    const observed = observeLive(root());

    // An online poll keeps the same node, still silent.
    await app.refresh();
    expect(oneOf(root(), "footer.footbar [role='status']")).toBe(status);
    expect(status.className).toBe("status");
    expect(textOf(status)).toBe("");
    notDetached(observed.since(), status);

    // A failed poll says so in the same node.
    flaky.fail();
    await app.refresh();
    expect(oneOf(root(), "footer.footbar [role='status']")).toBe(status);
    expect(status.className).toBe("note");
    expect(textOf(status)).toBe("offline, retrying");
    notDetached(observed.since(), status);

    // The next poll recovers, back in the same node.
    flaky.recover();
    await app.refresh();
    expect(oneOf(root(), "footer.footbar [role='status']")).toBe(status);
    expect(status.className).toBe("status");
    expect(textOf(status)).toBe("");
    notDetached(observed.since(), status);

    // Navigation to a project page keeps it, and so does navigating back.
    app.navigate("/p/alpha");
    await flush();
    expect(oneOf(root(), "footer.footbar [role='status']")).toBe(status);
    notDetached(observed.since(), status);

    app.navigate("/");
    await flush();
    expect(oneOf(root(), "footer.footbar [role='status']")).toBe(status);
    notDetached(observed.since(), status);

    observed.observer.disconnect();
    app.stop();
  });
});

describe("the project toolbar live regions", () => {
  const LONG_SEATS = [
    laneRow({ id: "wv-a", seat: "s1" }),
    laneRow({ id: "wv-b", seat: "s2" }),
    laneRow({ id: "wv-c", seat: "s3" }),
  ];

  it("keeps shown and copied mounted across filter, copy and poll while controls replace", async () => {
    const board = { writeText: () => Promise.resolve() };
    const { app } = boot({
      pathname: "/p/alpha",
      fetchImpl: fetchStub(
        projectHandler(() => projectLanes({ lanes: LONG_SEATS })),
      ),
      clipboard: board,
    });
    app.start();
    await flush();

    const shown = oneOf(root(), ".toolbar .shown") as HTMLElement;
    const copied = oneOf(root(), ".toolbar .copied") as HTMLElement;
    expect(shown.getAttribute("role")).toBe("status");
    expect(shown.getAttribute("aria-live")).toBe("polite");
    expect(copied.getAttribute("role")).toBe("status");
    expect(copied.getAttribute("aria-live")).toBe("polite");
    expect(textOf(shown)).toBe("3 of 3 shown");
    expect(textOf(copied)).toBe("");

    const observed = observeLive(root());
    const q = root().querySelector("#filter-q") as HTMLInputElement;
    const select = root().querySelector("#filter-seat") as HTMLSelectElement;
    const copyButton = root().querySelector("button.copy") as HTMLButtonElement;

    // Filter to one seat: the shown region updates, the controls are replaced.
    select.value = "s1";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(oneOf(root(), ".toolbar .shown")).toBe(shown);
    expect(textOf(shown)).toBe("1 of 3 shown");
    expect(oneOf(root(), ".toolbar .copied")).toBe(copied);
    const afterFilterQ = root().querySelector("#filter-q");
    const afterFilterSelect = root().querySelector("#filter-seat");
    const afterFilterCopy = root().querySelector("button.copy");
    expect(afterFilterQ).not.toBe(q);
    expect(afterFilterSelect).not.toBe(select);
    expect(afterFilterCopy).not.toBe(copyButton);
    notDetached(observed.since(), shown);
    notDetached(observed.since(), copied);

    // Copying the digest says so in the same copied node.
    (afterFilterCopy as HTMLButtonElement).click();
    await flush();
    expect(oneOf(root(), ".toolbar .copied")).toBe(copied);
    expect(textOf(copied)).toBe("Digest copied");
    expect(oneOf(root(), ".toolbar .shown")).toBe(shown);
    expect(textOf(shown)).toBe("1 of 3 shown");
    notDetached(observed.since(), shown);
    notDetached(observed.since(), copied);

    // A poll redraws the controls around the kept regions.
    const beforeRefreshQ = root().querySelector("#filter-q");
    const beforeRefreshSelect = root().querySelector("#filter-seat");
    const beforeRefreshCopy = root().querySelector("button.copy");
    await app.refresh();
    expect(oneOf(root(), ".toolbar .shown")).toBe(shown);
    expect(oneOf(root(), ".toolbar .copied")).toBe(copied);
    expect(textOf(shown)).toBe("1 of 3 shown");
    expect(textOf(copied)).toBe("Digest copied");
    expect(root().querySelector("#filter-q")).not.toBe(beforeRefreshQ);
    expect(root().querySelector("#filter-seat")).not.toBe(beforeRefreshSelect);
    expect(root().querySelector("button.copy")).not.toBe(beforeRefreshCopy);
    notDetached(observed.since(), shown);
    notDetached(observed.since(), copied);

    observed.observer.disconnect();
    app.stop();
  });
});

describe("the project stale banner", () => {
  const BASE = "2026-04-01T11:59:56.000Z";
  const SHIFTED = "2026-04-01T11:59:58.000Z";
  const BANNER_TEXT =
    "This wave is stale: no snapshot arrived inside its interval, so lanes last seen alive read unknown. Last received just now.";

  it("stays mounted across text, ISO-stamp and presence changes", async () => {
    let waves: WaveSummary[] = [
      waveSummary({ wave: "w-2", receivedAt: BASE, stale: true }),
    ];
    const fetchImpl = fetchStub(
      projectHandler(() => projectLanes({ waves, lanes: [laneRow()] })),
    );
    const { app } = boot({ pathname: "/p/alpha/w/w-2", fetchImpl });
    app.start();
    await flush();

    const banner = oneOf(root(), ".banner.stale") as HTMLElement;
    expect(banner.getAttribute("role")).toBe("status");
    expect(banner.getAttribute("aria-live")).toBe("polite");
    expect(textOf(banner)).toBe(BANNER_TEXT);
    const stampNode = banner.querySelector("span[title]") as HTMLElement;
    expect(stampNode.getAttribute("title")).toBe(BASE);

    const observed = observeLive(root());
    const shown = oneOf(root(), ".toolbar .shown") as HTMLElement;
    const copied = oneOf(root(), ".toolbar .copied") as HTMLElement;

    // An identical refresh leaves the banner's children untouched.
    await app.refresh();
    expect(oneOf(root(), ".banner.stale")).toBe(banner);
    expect(textOf(banner)).toBe(BANNER_TEXT);
    expect(banner.querySelector("span[title]")).toBe(stampNode);
    notDetached(observed.since(), banner);

    // A stamp-only change within "just now" replaces the children, not the banner.
    waves = [waveSummary({ wave: "w-2", receivedAt: SHIFTED, stale: true })];
    await app.refresh();
    expect(oneOf(root(), ".banner.stale")).toBe(banner);
    expect(textOf(banner)).toBe(BANNER_TEXT);
    const stampNow = banner.querySelector("span[title]") as HTMLElement;
    expect(stampNow).not.toBe(stampNode);
    expect(stampNow.getAttribute("title")).toBe(SHIFTED);
    notDetached(observed.since(), banner);

    // Stale-to-fresh removes the banner without touching the toolbar live regions.
    waves = [waveSummary({ wave: "w-2", receivedAt: BASE, stale: false })];
    await app.refresh();
    expect(oneOf(root(), ".banner.stale")).toBeNull();
    expect(oneOf(root(), ".toolbar .shown")).toBe(shown);
    expect(oneOf(root(), ".toolbar .copied")).toBe(copied);

    // Fresh-to-stale re-inserts the banner without detaching the toolbar regions.
    waves = [waveSummary({ wave: "w-2", receivedAt: BASE, stale: true })];
    await app.refresh();
    const reinserted = oneOf(root(), ".banner.stale") as HTMLElement;
    expect(reinserted).not.toBeNull();
    expect(reinserted).not.toBe(banner);
    expect(oneOf(root(), ".toolbar .shown")).toBe(shown);
    expect(oneOf(root(), ".toolbar .copied")).toBe(copied);
    notDetached(observed.since(), shown);
    notDetached(observed.since(), copied);

    observed.observer.disconnect();
    app.stop();
  });
});

describe("the toolbar across an emptied scope", () => {
  it("removes and re-inserts the toolbar, and sweeps stray root children", async () => {
    let lanes: LaneRow[] = [laneRow()];
    const { app } = boot({
      pathname: "/p/alpha",
      fetchImpl: fetchStub(projectHandler(() => projectLanes({ lanes }))),
    });
    app.start();
    await flush();

    expect(oneOf(root(), ".toolbar")).not.toBeNull();
    const appNode = oneOf(root(), ".app") as HTMLElement;
    const footStatus = oneOf(
      root(),
      "footer.footbar [role='status']",
    ) as HTMLElement;

    const observed = observeLive(root());

    // Scope empties: the toolbar is removed, the footbar region stays put.
    lanes = [];
    await app.refresh();
    expect(oneOf(root(), ".toolbar")).toBeNull();
    expect(oneOf(root(), "footer.footbar [role='status']")).toBe(footStatus);
    notDetached(observed.since(), footStatus);

    // Another empty redraw keeps it gone (no toolbar on either side).
    await app.refresh();
    expect(oneOf(root(), ".toolbar")).toBeNull();
    expect(oneOf(root(), "footer.footbar [role='status']")).toBe(footStatus);
    notDetached(observed.since(), footStatus);

    // Scope returns: the toolbar is inserted fresh around the kept footbar.
    lanes = [laneRow()];
    await app.refresh();
    expect(oneOf(root(), ".toolbar")).not.toBeNull();
    expect(textOf(oneOf(root(), ".toolbar .shown"))).toBe("1 of 1 shown");
    expect(oneOf(root(), "footer.footbar [role='status']")).toBe(footStatus);
    notDetached(observed.since(), footStatus);

    // A stray node prepended before `div.app` is swept, keeping the app and the
    // footbar live region connected.
    const stray = document.createElement("p");
    stray.textContent = "stray";
    root().prepend(stray);
    expect(root().contains(stray)).toBe(true);
    await app.refresh();
    expect(root().contains(stray)).toBe(false);
    expect(oneOf(root(), ".app")).toBe(appNode);
    expect(oneOf(root(), "footer.footbar [role='status']")).toBe(footStatus);
    notDetached(observed.since(), footStatus);
    notDetached(observed.since(), appNode);

    observed.observer.disconnect();
    app.stop();
  });
});

describe("128-character unbroken seats", () => {
  const LONG = "s".repeat(128);
  const HERE = dirname(fileURLToPath(import.meta.url));
  const DRAWER = join(HERE, "..", "..", "public", "drawer.css");
  const FLEET = join(HERE, "..", "..", "public", "fleet.css");
  const PROJECT = join(HERE, "..", "..", "public", "project.css");

  it("renders the seat beside its stale badge in every view", () => {
    const project = renderProjectView({
      lanes: projectLanes({ lanes: [laneRow({ seat: LONG })] }),
    });
    expect(textOf(oneOf(project, ".view.project .lanes .seat"))).toBe(LONG);

    const fleet = renderFleet(
      {
        projects: [],
        attention: attentionView({
          lanes: [attentionLane({ seat: LONG, stale: true })],
        }),
        query: { all: false },
        open: new Set<string>(),
      },
      NOW_MS,
      { onSearch() {} },
    );
    expect(textOf(oneOf(fleet, ".attention .seat"))).toBe(LONG);
    expect(oneOf(fleet, ".attention .badge.stale")).not.toBeNull();

    const drawer = renderDrawer(
      {
        state: "ready",
        project: "alpha",
        repo: "https://github.com/acme/waves",
        wave: "w-3",
        lane: "wv-a",
        reasons: [],
        view: waveView({
          envelope: envelope({ lanes: [lane({ seat: LONG })] }),
          stale: true,
        }),
      },
      NOW_MS,
      { onClose() {} },
    );
    expect(textOf(oneOf(drawer, ".meta.seat span:first-child"))).toBe(LONG);
    expect(oneOf(drawer, ".meta.seat .badge.stale")).not.toBeNull();
  });

  it("wraps long seats in all three stylesheets", () => {
    const drawerCss = readFileSync(DRAWER, "utf8");
    const fleetCss = readFileSync(FLEET, "utf8");
    const projectCss = readFileSync(PROJECT, "utf8");

    const drawerSeat = rule(drawerCss, ".lane-drawer .seat");
    expect(drawerSeat).toContain("overflow-wrap: anywhere");
    expect(drawerSeat).toContain("word-break: break-word");
    expect(drawerSeat).toContain("min-width: 0");
    expect(drawerSeat).not.toContain("animation:");

    const fleetSeat = rule(fleetCss, ".seat");
    expect(fleetSeat).toContain("max-width: 100%");
    expect(fleetSeat).toContain("min-width: 0");
    expect(fleetSeat).toContain("overflow-wrap: anywhere");
    expect(fleetSeat).toContain("word-break: break-word");

    const projectName = rule(projectCss, ".view.project .panel.seats .name");
    expect(projectName).toContain("min-width: 0");
    expect(projectName).toContain("overflow-wrap: anywhere");
    expect(projectName).toContain("word-break: break-word");

    const lanesSeat = rule(projectCss, ".view.project .lanes .seat");
    expect(lanesSeat).toContain("margin-right: 0");
    expect(lanesSeat).toContain("max-width: min(100%, 28rem)");
    expect(lanesSeat).toContain("min-width: 0");
    expect(lanesSeat).toContain("overflow-wrap: anywhere");
    expect(lanesSeat).toContain("word-break: break-word");
  });
});
