import { describe, expect, it } from "vitest";

import type { AppGlobals } from "../../public/app.js";
import { createApp } from "../../public/app.js";
import type { ProjectCard } from "../../public/api.js";
import { el } from "../../public/dom.js";
import { shell } from "../../public/shell.js";
import { renderFleet } from "../../public/views/fleet.js";
import { renderProject } from "../../public/views/project.js";

import type { ProjectLanesView } from "../../src/application/read-model.js";
import {
  attentionLane,
  attentionView,
  laneRow,
  NOW_ISO,
  NOW_MS,
  projectCard,
  projectLanes,
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
 * Every lane field the project's page renders, each carrying the payload. The
 * event, the pull-request state and the pull-request checks are contract values
 * and the shape check refuses a payload in any of them, so they are left as
 * contract values here; what is under test is what the view writes down.
 */
function rowWith(payload: string): ReturnType<typeof laneRow> {
  return laneRow({
    id: "wv-a",
    seat: payload,
    reported: { stage: payload, event: "failed", ts: NOW_ISO, pr: 9, round: 1 },
    derived: {
      alive: true,
      exit: 1,
      pr: { number: 42, state: "open", checks: "pass" },
      planReview: payload,
      risk: payload,
    },
    disagreements: 2,
    disagreement: payload,
    reasons: ["failed", "gate"],
  });
}

/** One project's whole answer, with the payload in every field that is text. */
function listingWith(payload: string): ProjectLanesView {
  return projectLanes({
    project: { id: "alpha", name: payload, repo: payload },
    lanes: [rowWith(payload)],
  });
}

/** The same answer with the payload in one of the three ids a link is built from. */
function brokenListing(field: string, payload: string): unknown {
  if (field === "a row's id") {
    return projectLanes({ lanes: [{ ...rowWith(payload), id: payload }] });
  }
  if (field === "a row's wave") {
    return projectLanes({ lanes: [{ ...rowWith(payload), wave: payload }] });
  }
  return projectLanes({ waves: [{ ...waveSummary(), wave: payload }] });
}

/**
 * Boots the app on a project route over the given listing, so the rail and the
 * page draw the same strings and the whole chain is walked, not one view. The
 * listing is a parameter because a payload in one of its ids has to reach the
 * app as a failed load, not as a page.
 */
async function bootProject(
  body: unknown,
  pathname = "/p/alpha",
  search = "",
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
        ? { status: 200, body: [projectCard()] }
        : path === "/api/v1/attention"
          ? { status: 200, body: attentionView() }
          : { status: 200, body },
    ),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    clock: () => NOW_MS,
  } satisfies AppGlobals);
  app.start();
  await flush();
  return app;
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

/**
 * How many times one payload appears in the rendered text of the project page:
 * the project's name in the heading, its repository as a line of text, the lane's
 * seat, the stage the lane reported, the first disagreement, the plan review and
 * the risk. The seat, the stage and the disagreement are each drawn a second
 * time — in the seats panel, in the stage rail and in the disagreements panel —
 * so the count of ten is ten places a reader could see it, all of them text. The
 * two timestamps reach the document as `title` attributes rather than as text,
 * and this case holds both of them to NOW_ISO.
 */
const PROJECT_OCCURRENCES = 10;

describe("the project page against stored markup", () => {
  it("renders every field of a row as text", () => {
    for (const payload of TEXT_PAYLOADS) {
      freshRoot();
      const host = document.getElementById("root") as HTMLElement;
      host.append(
        renderProject(
          {
            lanes: listingWith(payload),
            wave: undefined,
            query: { all: false },
          },
          NOW_MS,
        ),
      );
      assertNoInjectedMarkup();
      expect(host.querySelectorAll("img")).toHaveLength(0);
      expect(host.querySelectorAll("script")).toHaveLength(0);
      expect(textsOf(host, "h1")).toStrictEqual([payload]);
      expect(textsOf(host, ".repo")).toStrictEqual([payload]);
      expect(textsOf(host, "td[data-label='Lane'] small")).toStrictEqual([
        payload,
      ]);
      expect(
        textsOf(host, "td[data-label='Reported'] span:first-child")[0],
      ).toBe(`${payload} · failed · round 1 · PR #9`);
      expect(textsOf(host, "td[data-label='Notes']")).toStrictEqual([
        `${payload}+1 more${payload}${payload}`,
      ]);
      // The three that are drawn twice: once in the table, once in the roll-up
      // that says the same thing about fewer rows.
      expect(textsOf(host, ".panel.seats .name")).toStrictEqual([payload]);
      expect(textsOf(host, ".stages .name")).toStrictEqual([payload]);
      expect(textsOf(host, ".panel.disagreements .disagreement")).toStrictEqual(
        [payload],
      );
      expectVerbatim(payload, PROJECT_OCCURRENCES, 0);
    }
  });

  it("keeps a payload out of every link and every attribute", () => {
    for (const payload of TEXT_PAYLOADS) {
      freshRoot();
      const host = document.getElementById("root") as HTMLElement;
      host.append(
        renderProject(
          {
            lanes: listingWith(payload),
            wave: undefined,
            query: { all: false },
          },
          NOW_MS,
        ),
      );
      assertNoInjectedMarkup();
      expect(host.querySelectorAll("a[href^='javascript:']")).toHaveLength(0);
      expect(host.querySelectorAll("a[href*='@']")).toHaveLength(0);
      for (const value of attributeValues()) {
        expect(value).not.toContain(payload);
      }
    }
  });

  it("renders the wave's own name in the lede, and nothing else", () => {
    for (const payload of TEXT_PAYLOADS) {
      freshRoot();
      const host = document.getElementById("root") as HTMLElement;
      host.append(
        renderProject(
          { lanes: listingWith(payload), wave: "w-3", query: { all: false } },
          NOW_MS,
        ),
      );
      assertNoInjectedMarkup();
      expect(textsOf(host, ".lede")[0]).toBe(
        `One wave of ${payload}: what each lane reported, beside what the last push could derive.`,
      );
    }
  });

  /**
   * The three ids this page builds its links out of. A payload in any of them
   * has to make the whole listing undrawable rather than be encoded into a path.
   */
  const IDS = ["a row's id", "a row's wave", "a wave's id"] as const;

  it.each(IDS)(
    "makes the whole listing undrawable when %s carries a payload",
    async (field) => {
      for (const payload of TEXT_PAYLOADS) {
        const app = await bootProject(brokenListing(field, payload));
        assertNoInjectedMarkup();
        // A failed load: the note, once, and nothing drawn from the listing.
        expect(root().querySelectorAll(".note")).toHaveLength(1);
        expect(textOf(root().querySelector(".note"))).toBe("offline, retrying");
        expect(root().querySelectorAll("table")).toHaveLength(0);
        expect(documentText()).not.toContain(payload);
        for (const value of attributeValues()) {
          expect(value).not.toContain(payload);
        }
        app.stop();
      }
    },
  );
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

  /**
   * The project page is the one that reads the whole query and writes it back
   * out on every link it draws, so a payload in a parameter has to come back as
   * a percent-encoded address rather than as text, a `title` or an attribute
   * value of its own.
   */
  it.each(["seat", "q"] as const)(
    "keeps a payload in the project's %s out of the document",
    async (key) => {
      for (const payload of TEXT_PAYLOADS) {
        const app = await bootProject(
          projectLanes(),
          "/p/alpha",
          `?${key}=${encodeURIComponent(payload)}`,
        );
        assertNoInjectedMarkup();
        expect(root().querySelectorAll("img")).toHaveLength(0);
        expect(root().querySelectorAll("script")).toHaveLength(0);
        expect(root().querySelectorAll("table")).toHaveLength(1);
        expect(documentText()).not.toContain(payload);
        for (const value of attributeValues()) {
          expect(value).not.toContain(payload);
        }
        // The hrefs carry the query, and only in its encoded form.
        expect(
          Array.from(root().querySelectorAll(".wave-strip a")).every((anchor) =>
            anchor.getAttribute("href")?.startsWith("/p/alpha"),
          ),
        ).toBe(true);
        app.stop();
      }
    },
  );
});
