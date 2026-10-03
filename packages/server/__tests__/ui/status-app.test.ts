import { describe, expect, it } from "vitest";

import type { AppGlobals } from "../../public/app.js";
import { createApp } from "../../public/app.js";

import type { Answer } from "./helpers.js";
import {
  attentionView,
  laneRow,
  NOW_MS,
  projectCard,
  projectLanes,
  statusView,
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

const STATUS_PATH = "/api/v1/projects/alpha/status";

/**
 * The whole of a project pass — the rail's two reads, the listing and the
 * status — with the status answered however the test asks for. Everything else is
 * a real answer, so a test about the status is not also a test about a listing
 * that never arrived.
 */
function answering(status: Answer): (path: string) => Answer {
  return (path) => {
    if (path === "/api/v1/projects") {
      return { status: 200, body: [projectCard()] };
    }
    if (path === "/api/v1/attention") {
      return { status: 200, body: attentionView() };
    }
    if (path === STATUS_PATH) {
      return status;
    }
    return {
      status: 200,
      body: projectLanes({
        project: { id: "alpha", name: "Alpha" },
        waves: [waveSummary()],
        lanes: [laneRow()],
      }),
    };
  };
}

/** Boots the app on a project route and hands back the app and its fetch stub. */
function boot(status: Answer) {
  freshRoot();
  const timers = timerStub();
  const browser = browserGlobals("/p/alpha", "");
  const fetchImpl = fetchStub(answering(status));
  const app = createApp({
    doc: document,
    location: browser.location,
    history: browser.history,
    win: browser.win,
    fetch: fetchImpl,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    clock: () => NOW_MS,
  } satisfies AppGlobals);
  app.start();
  return { app, fetchImpl, timers };
}

describe("the project's own status", () => {
  it("asks for it in the same pass as the listing", async () => {
    const { app, fetchImpl } = boot({ status: 200, body: statusView() });
    await flush();

    expect(fetchImpl.calls).toStrictEqual([
      "/api/v1/projects",
      "/api/v1/attention",
      "/api/v1/projects/alpha/lanes",
      STATUS_PATH,
    ]);
    app.stop();
  });

  it("draws the panel under the counters", async () => {
    const { app } = boot({ status: 200, body: statusView() });
    await flush();

    const panel = root().querySelector("section.panel.status");
    expect(panel).not.toBeNull();
    expect(textsOf(panel as Element, "h2")).toStrictEqual(["Status"]);
    expect(textsOf(root(), ".panel.status p.prs")).toStrictEqual([
      "2 PR rows could not be read",
    ]);
    expect(textsOf(root(), ".panel.status .premises tbody tr")).toHaveLength(2);
    // The lane table is still there, and the panel sits between the counters and
    // the panels that are about lanes. The table is on the glass card the page
    // draws it in, so the card is what the order is read off.
    const order = Array.from(
      root().querySelector(".view.project")?.children ?? [],
    );
    const counters = order.findIndex((node) => node.classList.contains("kpis"));
    const status = order.findIndex((node) => node.classList.contains("status"));
    const table = order.findIndex((node) =>
      node.classList.contains("lanes-card"),
    );
    expect(counters).toBeGreaterThanOrEqual(0);
    expect(status).toBeGreaterThan(counters);
    expect(table).toBeGreaterThan(status);
    app.stop();
  });

  it("draws nothing at all for a 404, which is how a project says nothing", async () => {
    const { app, fetchImpl } = boot({ status: 404 });
    await flush();

    expect(fetchImpl.calls).toContain(STATUS_PATH);
    expect(root().querySelectorAll(".panel.status")).toHaveLength(0);
    // The page itself is fine: the listing drew and there is no note.
    expect(root().querySelectorAll(".note")).toHaveLength(0);
    expect(textsOf(root(), "tbody tr")).toHaveLength(1);
    app.stop();
  });

  it("keeps the page when a later pass finds the status has gone", async () => {
    freshRoot();
    const timers = timerStub();
    const browser = browserGlobals("/p/alpha", "");
    let gone = false;
    const fetchImpl = fetchStub((path) =>
      answering(gone ? { status: 404 } : { status: 200, body: statusView() })(
        path,
      ),
    );
    const app = createApp({
      doc: document,
      location: browser.location,
      history: browser.history,
      win: browser.win,
      fetch: fetchImpl,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      clock: () => NOW_MS,
    } satisfies AppGlobals);
    app.start();
    await flush();
    expect(root().querySelectorAll(".panel.status")).toHaveLength(1);

    gone = true;
    timers.runLast();
    await flush();

    // A status that stopped arriving is not a failure: the panel goes and the
    // listing is still there, with no note anywhere.
    expect(root().querySelectorAll(".panel.status")).toHaveLength(0);
    expect(root().querySelectorAll(".note")).toHaveLength(0);
    expect(textsOf(root(), "tbody tr")).toHaveLength(1);
    app.stop();
  });

  it("is a failed load when the status is not a status the panel can draw", async () => {
    const { app, timers } = boot({ status: 200, body: projectLanes() });
    await flush();

    expect(root().querySelectorAll(".note")).toHaveLength(1);
    expect(textOf(root().querySelector(".note"))).toBe("offline, retrying");
    expect(root().querySelectorAll(".panel.status")).toHaveLength(0);
    expect(root().querySelectorAll("table")).toHaveLength(0);
    timers.runLast();
    await flush();
    expect(timers.scheduled).toHaveLength(1);
    app.stop();
  });

  it("is a failed load when the status names another project", async () => {
    const { app } = boot({
      status: 200,
      body: statusView({
        status: { ...statusView().status, project: "beta" },
      }),
    });
    await flush();

    expect(textOf(root().querySelector(".note"))).toBe("offline, retrying");
    expect(root().querySelectorAll(".panel.status")).toHaveLength(0);
    app.stop();
  });

  it("is a failed load when the status itself fails", async () => {
    const { app } = boot({ status: 500 });
    await flush();

    expect(textOf(root().querySelector(".note"))).toBe("offline, retrying");
    expect(root().querySelectorAll(".panel.status")).toHaveLength(0);
    app.stop();
  });
});
