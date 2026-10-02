import { describe, expect, it } from "vitest";

import type {
  CheckStatus,
  LaneEvent,
  PullRequestState,
} from "@hexagen-monaco/waves-contract";

import type { AppGlobals } from "../../public/app.js";
import { createApp } from "../../public/app.js";
import type { ProjectCard } from "../../public/api.js";
import { el } from "../../public/dom.js";
import { shell } from "../../public/shell.js";
import { renderFleet } from "../../public/views/fleet.js";
import { wavePanel } from "../../public/wave.js";

import type { LaneView } from "../../src/application/read-model.js";
import {
  attentionLane,
  attentionView,
  lane,
  NOW_ISO,
  NOW_MS,
  projectCard,
  waveSummary,
} from "./fixtures.js";
import {
  assertNoInjectedMarkup,
  browserGlobals,
  fetchStub,
  flush,
  freshRoot,
  oneOf,
  root,
  textOf,
  textsOf,
  timerStub,
} from "./helpers.js";

const IMG = "<img src=x onerror=alert(1)>";
const SCRIPT = '"><script>alert(1)</script>';
const HANDLER = '" onmouseover="alert(1)';
const CLOSING_DETAILS = "</details><img src=x onerror=alert(1)>";
const CREDENTIALS = "https://user:pass@evil.example/repo";
const REPO_PAYLOADS = [
  "javascript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  CREDENTIALS,
] as const;

const TEXT_PAYLOADS = [IMG, SCRIPT, HANDLER, CLOSING_DETAILS] as const;

/**
 * How many times one payload appears in the rendered *text* of a project card:
 * the name, the id and the repository. `lastPush` is fed the payload too, and
 * reaches the document as a `title` attribute instead, which `CARD_TITLES`
 * counts; `assertNoInjectedMarkup` only checks attribute *names*. The payload is
 * also the project's id here, which is why the card links nothing at all.
 */
const CARD_OCCURRENCES = 3;

/** The `title` attributes in that card that hold the payload: `lastPush`. */
const CARD_TITLES = 1;

/**
 * How many times one payload appears in the rendered text of a wave panel: the
 * project in the heading, the wave id in the wave list, the wave id again in the
 * lane-panel heading, the lane id, the seat, the stage, the event, the one
 * detail value, the pull-request state, the pull-request checks, the plan
 * review, the risk, the one disagreement, the `generatedAt` in the tail label
 * and the tail. The three timestamps reach the document as attributes, not as
 * text, and `LANE_TITLES` counts those.
 */
const LANE_OCCURRENCES = 15;

/**
 * The `title` attributes holding the payload: the wave's `receivedAt` in the
 * wave list, the view's `receivedAt` in the lane-panel heading, and the lane's
 * reported `ts` in its reported cell.
 */
const LANE_TITLES = 3;

function documentText(): string {
  return document.body.textContent ?? "";
}

/** How many times the payload appears in the rendered text, exactly. */
function occurrencesOf(payload: string): number {
  return documentText().split(payload).length - 1;
}

/** How many `title` attributes hold the payload verbatim, exactly. */
function titledWith(payload: string): number {
  return Array.from(document.querySelectorAll("[title]")).filter(
    (element) => element.getAttribute("title") === payload,
  ).length;
}

function expectVerbatim(
  payload: string,
  textTimes: number,
  titleTimes: number,
): void {
  expect(occurrencesOf(payload)).toBe(textTimes);
  expect(titledWith(payload)).toBe(titleTimes);
}

/**
 * Boots the app on the fleet route over the given projects, so the rail and the
 * card draw the same strings and the whole chain is walked, not one view. The
 * attention view is a parameter because a payload in one of its ids has to
 * reach the app as a failed load, not as a page.
 */
async function bootFleet(
  projects: readonly ProjectCard[],
  pathname = "/",
  search = "",
  attention: unknown = attentionView(),
): Promise<ReturnType<typeof createApp>> {
  freshRoot();
  const timers = timerStub();
  const browser = browserGlobals(pathname, search);
  const app = createApp({
    doc: document,
    location: browser.location,
    history: browser.history,
    win: browser.win,
    fetch: fetchStub((path) =>
      path === "/api/v1/projects"
        ? { status: 200, body: projects }
        : path === "/api/v1/attention"
          ? { status: 200, body: attention }
          : { status: 404 },
    ),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    clock: () => NOW_MS,
  } satisfies AppGlobals);
  app.start();
  await flush();
  return app;
}

/** Every attribute value in the document, one flat list, names not checked. */
function attributeValues(): string[] {
  return Array.from(document.querySelectorAll("*")).flatMap((element) =>
    element.getAttributeNames().map((name) => element.getAttribute(name) ?? ""),
  );
}

/** Every field that reaches the DOM, each carrying the payload it was given. */
function projectWith(payload: string): ProjectCard {
  return projectCard({
    id: payload,
    name: payload,
    repo: payload,
    lastPush: payload,
  });
}

/**
 * Every lane field that reaches the DOM, each carrying the payload. The event,
 * the pull-request state and the pull-request checks are contract values, so
 * the payload is cast in: the point of the test is that the UI renders whatever
 * arrives rather than leaning on the server having validated it.
 */
function laneWith(payload: string): LaneView {
  return lane({
    id: payload,
    seat: payload,
    reported: {
      stage: payload,
      event: payload as LaneEvent,
      ts: payload,
      pr: 1,
      round: 1,
      detail: { note: payload },
    },
    derived: {
      alive: true,
      pr: {
        number: 1,
        state: payload as PullRequestState,
        checks: payload as CheckStatus,
        unresolvedThreads: 1,
      },
      planReview: payload,
      risk: payload,
      log: { bytes: 1, mtimeMs: 0, tail: payload },
    },
    disagreements: [payload],
  });
}

function hostileView(payload: string) {
  return {
    envelope: {
      schema: "waves/v1" as const,
      project: payload,
      wave: payload,
      generatedAt: payload,
      intervalSeconds: 30,
      lanes: [laneWith(payload)],
    },
    receivedAt: payload,
    stale: true,
    staleAfterMs: 1,
  };
}

describe("the fleet page against stored markup", () => {
  it("renders every field of every card as text", () => {
    for (const payload of TEXT_PAYLOADS) {
      freshRoot();
      const host = document.getElementById("root") as HTMLElement;
      host.append(
        renderFleet(
          { projects: [projectWith(payload)], attention: attentionView() },
          NOW_MS,
        ),
      );
      assertNoInjectedMarkup();
      expect(host.querySelectorAll("img")).toHaveLength(0);
      expect(host.querySelectorAll("script")).toHaveLength(0);
      // The id is not one the app owns, so there is nothing to link to and the
      // name is plain text: a card a reader can read and cannot click.
      expect(host.querySelectorAll("h3 a")).toHaveLength(0);
      const heading = oneOf(host, "h3");
      expect(textOf(heading?.firstChild as Element)).toBe(payload);
      expect(textsOf(host, ".facts dd code")).toStrictEqual([payload]);
      expect(textsOf(host, ".facts dd span[title]")).toStrictEqual(["unknown"]);
      expectVerbatim(payload, CARD_OCCURRENCES, CARD_TITLES);
    }
  });

  it("never turns a hostile repository into a link", () => {
    for (const payload of REPO_PAYLOADS) {
      freshRoot();
      const host = document.getElementById("root") as HTMLElement;
      host.append(
        renderFleet(
          {
            projects: [projectCard({ repo: payload })],
            attention: attentionView(),
          },
          NOW_MS,
        ),
      );
      assertNoInjectedMarkup();
      expect(host.querySelectorAll("a[href^='javascript:']")).toHaveLength(0);
      expect(host.querySelectorAll("a[href^='data:']")).toHaveLength(0);
      expect(host.querySelectorAll("a[href*='@']")).toHaveLength(0);
      expect(textsOf(host, ".facts dd")[1]).toBe(payload);
      expectVerbatim(payload, 1, 0);
    }
  });

  it("keeps a hostile project id out of every link and every attribute", () => {
    freshRoot();
    const host = document.getElementById("root") as HTMLElement;
    host.append(
      renderFleet(
        { projects: [projectCard({ id: SCRIPT })], attention: attentionView() },
        NOW_MS,
      ),
    );
    assertNoInjectedMarkup();
    expect(host.querySelectorAll("h3 a")).toHaveLength(0);
    for (const value of attributeValues()) {
      expect(value).not.toContain(SCRIPT);
    }
    expectVerbatim(SCRIPT, 1, 0);
  });

  it("renders a lane's seat as text", () => {
    for (const payload of TEXT_PAYLOADS) {
      freshRoot();
      const host = document.getElementById("root") as HTMLElement;
      host.append(
        renderFleet(
          {
            projects: [projectCard()],
            attention: attentionView({
              lanes: [attentionLane({ seat: payload })],
            }),
          },
          NOW_MS,
        ),
      );
      assertNoInjectedMarkup();
      expect(host.querySelectorAll("img")).toHaveLength(0);
      expect(host.querySelectorAll("script")).toHaveLength(0);
      expect(textsOf(host, ".seat")).toStrictEqual([payload]);
      expectVerbatim(payload, 1, 0);
    }
  });
});

describe("the wave panel against stored markup", () => {
  it("renders every field of a lane as text", () => {
    for (const payload of TEXT_PAYLOADS) {
      freshRoot();
      const host = document.getElementById("root") as HTMLElement;
      host.append(
        wavePanel(
          {
            project: payload,
            waves: [waveSummary({ wave: payload, receivedAt: payload })],
            showAll: true,
            selected: payload,
            view: hostileView(payload),
          },
          NOW_MS,
          { onSelect: () => undefined, onToggleAll: () => undefined },
        ),
      );
      assertNoInjectedMarkup();
      expect(host.querySelectorAll("img")).toHaveLength(0);
      expect(host.querySelectorAll("script")).toHaveLength(0);
      expect(host.querySelectorAll("details").length).toBe(1);
      expectVerbatim(payload, LANE_OCCURRENCES, LANE_TITLES);
    }
  });

  it("renders the pull request and the reported stage and event as text", () => {
    for (const payload of TEXT_PAYLOADS) {
      freshRoot();
      const host = document.getElementById("root") as HTMLElement;
      host.append(
        wavePanel(
          {
            project: "alpha",
            waves: [waveSummary()],
            showAll: false,
            selected: "w-3",
            view: hostileView(payload),
          },
          NOW_MS,
          { onSelect: () => undefined, onToggleAll: () => undefined },
        ),
      );
      assertNoInjectedMarkup();
      expect(textsOf(host, "td[data-label='pr']")).toStrictEqual([
        `#1 ${payload} · checks ${payload} · 1 open thread`,
      ]);
      const reported = textsOf(host, "td[data-label='reported']")[0] ?? "";
      expect(reported.startsWith(`${payload} · ${payload}`)).toBe(true);
      expect(reported).toContain(`note: ${payload}`);
    }
  });

  it("keeps a payload in the tail from closing the details element", () => {
    freshRoot();
    const host = document.getElementById("root") as HTMLElement;
    host.append(
      wavePanel(
        {
          project: "alpha",
          waves: [waveSummary()],
          showAll: false,
          selected: "w-3",
          view: {
            envelope: {
              schema: "waves/v1",
              project: "alpha",
              wave: "w-3",
              generatedAt: NOW_ISO,
              intervalSeconds: 30,
              lanes: [
                lane({
                  derived: {
                    alive: true,
                    log: { bytes: 1, mtimeMs: 0, tail: CLOSING_DETAILS },
                  },
                }),
              ],
            },
            receivedAt: NOW_ISO,
            stale: false,
            staleAfterMs: 1,
          },
        },
        NOW_MS,
        { onSelect: () => undefined, onToggleAll: () => undefined },
      ),
    );
    assertNoInjectedMarkup();
    expect(host.querySelectorAll("details")).toHaveLength(1);
    expect(host.querySelectorAll("details > *")).toHaveLength(2);
    expect(textsOf(host, "pre")).toStrictEqual([CLOSING_DETAILS]);
    expectVerbatim(CLOSING_DETAILS, 1, 0);
  });
});

/**
 * How many times a payload name reaches the document text on the fleet route:
 * once as the rail link's own text, and once as the card's link text. The card
 * also shows the id, the wave count and the last push, none of which carry it.
 */
const RAIL_AND_CARD_OCCURRENCES = 2;

/** And with the payload in the id: the rail skips it, the card shows it once. */
const CARD_ONLY_OCCURRENCES = 1;

describe("the rail against stored markup", () => {
  it("renders a project's name as text in the rail and in the card", async () => {
    for (const payload of TEXT_PAYLOADS) {
      const app = await bootFleet([projectCard({ name: payload })]);
      assertNoInjectedMarkup();
      expect(root().querySelectorAll("img")).toHaveLength(0);
      expect(root().querySelectorAll("script")).toHaveLength(0);
      expect(textsOf(root(), ".projects a")).toStrictEqual([payload]);
      expect(root().querySelector(".projects a")?.getAttribute("href")).toBe(
        "/p/alpha",
      );
      expectVerbatim(payload, RAIL_AND_CARD_OCCURRENCES, 0);
      app.stop();
    }
  });

  it("keeps a payload project id out of the rail and out of every attribute", async () => {
    for (const payload of TEXT_PAYLOADS) {
      const app = await bootFleet([
        projectCard({ id: payload, name: "Alpha" }),
      ]);
      assertNoInjectedMarkup();
      expect(root().querySelectorAll(".projects")).toHaveLength(0);
      expect(textsOf(root(), ".rail-nav p")).toStrictEqual([
        "No projects registered yet.",
      ]);
      for (const value of attributeValues()) {
        expect(value).not.toContain(payload);
      }
      expectVerbatim(payload, CARD_ONLY_OCCURRENCES, 0);
      app.stop();
    }
  });

  it("never puts a payload name in the breadcrumb either", async () => {
    for (const payload of TEXT_PAYLOADS) {
      const host = freshRoot();
      host.append(
        shell(
          {
            route: { kind: "project", id: "alpha", wave: "wv1" },
            projects: [projectCard({ name: payload })],
            attention: undefined,
            all: false,
            note: "",
          },
          el("p", { text: "the page" }),
        ),
      );
      assertNoInjectedMarkup();
      const crumbs = host.querySelector(".crumbs") as Element;
      expect(textOf(host.querySelector(".crumbs") as Element)).toBe(
        "waves / alpha / wv1",
      );
      expect(crumbs.querySelectorAll("img")).toHaveLength(0);
      expect(crumbs.querySelectorAll("script")).toHaveLength(0);
      expect(textOf(crumbs)).not.toContain(payload);
    }
  });
});

describe("the attention ids against stored markup", () => {
  /**
   * The three ids of one lane are what the attention panel builds its link
   * from, so a payload in any of them has to make the whole response
   * undrawable rather than be encoded into a path.
   */
  const IDS = ["project", "wave", "lane"] as const;

  it.each(IDS)(
    "refuses the whole attention view when its %s carries a payload",
    async (field) => {
      for (const payload of TEXT_PAYLOADS) {
        const app = await bootFleet([projectCard()], "/", "", {
          lanes: [{ ...attentionLane(), [field]: payload }],
          projects: [{ id: "alpha", attention: 1 }],
          truncated: false,
        });
        assertNoInjectedMarkup();
        // A failed load: the note, once, and nothing drawn from the view.
        expect(root().querySelectorAll(".note")).toHaveLength(1);
        expect(textOf(root().querySelector(".note"))).toBe("offline, retrying");
        expect(root().querySelectorAll(".attention")).toHaveLength(0);
        expect(documentText()).not.toContain(payload);
        for (const value of attributeValues()) {
          expect(value).not.toContain(payload);
        }
        app.stop();
      }
    },
  );
});

describe("the query string against stored markup", () => {
  const KEYS = ["reason", "stage", "seat", "q", "lane", "all"] as const;

  it.each(KEYS)("keeps a payload in %s out of the document", async (key) => {
    for (const payload of TEXT_PAYLOADS) {
      const app = await bootFleet(
        [projectCard()],
        "/",
        `?${key}=${encodeURIComponent(payload)}`,
      );
      assertNoInjectedMarkup();
      expect(root().querySelectorAll("img")).toHaveLength(0);
      expect(root().querySelectorAll("script")).toHaveLength(0);
      expect(documentText()).not.toContain(payload);
      expect(textsOf(root(), ".project-card h3 a")).toStrictEqual(["Alpha"]);
      app.stop();
    }
  });
});
