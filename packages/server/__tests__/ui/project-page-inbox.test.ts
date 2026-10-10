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
  waveSummary,
} from "./fixtures.js";
import {
  browserGlobals,
  fetchStub,
  flush,
  freshRoot,
  root,
  textsOf,
  timerStub,
} from "./helpers.js";

/**
 * The whole of a project pass — the rail's two reads, the listing and the
 * lanes — with the listing answered however the test asks for.
 */
function answering(projects: readonly unknown[]): (path: string) => Answer {
  return (path) => {
    if (path === "/api/v1/projects") {
      return { status: 200, body: projects };
    }
    if (path === "/api/v1/attention") {
      return { status: 200, body: attentionView() };
    }
    if (path === "/api/v1/projects/alpha/status") {
      return { status: 404 };
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

/** Boots the app on `/p/alpha` and hands back the app and its fetch stub. */
function boot(projects: readonly unknown[]) {
  freshRoot();
  const timers = timerStub();
  const browser = browserGlobals("/p/alpha", "");
  const fetchImpl = fetchStub(answering(projects));
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

describe("the project page's inbox line", () => {
  it("shows the counts the listing carries, and the link", async () => {
    const { app } = boot([
      projectCard({
        decisions: { waiting: 3, oneWay: 1, reported: 2, closed: 1 },
      }),
    ]);
    await flush();
    expect(textsOf(root(), ".inbox-line")).toStrictEqual([
      "3 waiting (1 one-way door) · 2 reported · 1 closed by a session · Inbox",
    ]);
    expect(root().querySelector(".inbox-line a")?.getAttribute("href")).toBe(
      "/p/alpha/inbox",
    );
    app.stop();
  });

  it("shows only the link when the listing's project carries no count", async () => {
    const { app } = boot([projectCard({ decisions: undefined })]);
    await flush();
    expect(textsOf(root(), ".inbox-line")).toStrictEqual(["Inbox"]);
    expect(root().querySelector(".inbox-line a")?.getAttribute("href")).toBe(
      "/p/alpha/inbox",
    );
    app.stop();
  });

  it("shows only the link when the listing does not have the project", async () => {
    const { app } = boot([projectCard({ id: "beta", name: "Beta" })]);
    await flush();
    expect(textsOf(root(), ".inbox-line")).toStrictEqual(["Inbox"]);
    expect(root().querySelector(".inbox-line a")?.getAttribute("href")).toBe(
      "/p/alpha/inbox",
    );
    app.stop();
  });
});
