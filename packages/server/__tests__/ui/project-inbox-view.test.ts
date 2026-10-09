import { describe, expect, it } from "vitest";

import { drawableProjectInbox } from "../../public/project-inbox.js";
import { drawableProjectEvents } from "../../public/project-events.js";
import { renderProjectInbox } from "../../public/views/project-inbox.js";

import type { StoredEvent } from "../../src/application/ports/notice-store.js";
import type {
  Head,
  ProjectInboxView,
} from "../../src/application/notice-read-model.js";
import {
  INBOX_NOW_MS,
  inboxEvent,
  inboxHead,
  projectInboxView,
} from "./fixtures.js";
import {
  assertNoInjectedMarkup,
  freshRoot,
  textOf,
  textsOf,
} from "./helpers.js";

/**
 * Draws one project's inbox from a checked view and events, asserts the markup
 * invariants, and asserts that no element's text contains undefined, null, NaN
 * or Invalid Date — the helper the decision view tests call on every draw,
 * called here the same way.
 */
function draw(
  view: ProjectInboxView,
  name = "Alpha",
  events: readonly StoredEvent[] = [],
  nowMs = INBOX_NOW_MS,
): HTMLElement {
  if (!drawableProjectInbox(view, view.project)) {
    throw new Error("not a drawable project inbox");
  }
  if (!drawableProjectEvents({ events }, view.project)) {
    throw new Error("not drawable events");
  }
  const host = freshRoot();
  host.append(renderProjectInbox(view, name, events, nowMs));
  assertNoInjectedMarkup();
  const text = host.textContent ?? "";
  for (const word of ["undefined", "null", "NaN", "Invalid Date"]) {
    expect(text).not.toContain(word);
  }
  return host;
}

describe("renderProjectInbox", () => {
  it("shows the breadcrumb, heading, counts and footer", () => {
    const host = draw(
      projectInboxView({
        counts: { waiting: 1, oneWay: 0, reported: 0, closed: 0 },
        decisions: [inboxHead({ id: "d1", question: "Go?", group: "waiting" })],
      }),
    );
    const crumb = host.querySelector(".project-inbox-breadcrumbs");
    const links = crumb?.querySelectorAll("a");
    expect(textOf(crumb)).toBe("Inbox · Alpha");
    expect(links?.[0]?.getAttribute("href")).toBe("/inbox");
    expect(links?.[1]?.getAttribute("href")).toBe("/p/alpha");
    expect(textsOf(host, "h1")).toStrictEqual(["Alpha · decisions"]);
    expect(textsOf(host, ".inbox-counts")).toStrictEqual([
      "1 waiting (0 one-way doors) · 0 reported · 0 closed by a session",
    ]);
    expect(textsOf(host, ".inbox-footer")).toStrictEqual([
      "This page shows decisions; it does not take answers. A session's own permission prompt can only be cleared in that session.",
    ]);
  });

  it("draws the project id when the listing has no such project", () => {
    const host = draw(
      projectInboxView({
        counts: { waiting: 1, oneWay: 0, reported: 0, closed: 0 },
        decisions: [
          inboxHead({
            id: "d1",
            group: "waiting",
            state: "open",
            decider: "owner",
          }),
        ],
      }),
      "alpha",
    );
    const crumb = host.querySelector(".project-inbox-breadcrumbs");
    expect(textOf(crumb)).toBe("Inbox · alpha");
    expect(textsOf(host, "h1")).toStrictEqual(["alpha · decisions"]);
  });

  it("draws each of the three groups under the inbox's own headings", () => {
    const host = draw(
      projectInboxView({
        counts: { waiting: 1, oneWay: 0, reported: 1, closed: 1 },
        decisions: [
          inboxHead({
            id: "w",
            group: "waiting",
            state: "open",
            decider: "owner",
          }),
          inboxHead({
            id: "r",
            group: "reported",
            state: "approved",
            source: "reported",
          }),
          inboxHead({
            id: "c",
            group: "closed",
            state: "withdrawn",
            entries: 2,
          }),
        ],
      }),
    );
    expect(textsOf(host, ".inbox-group h3")).toStrictEqual([
      "Waiting on you",
      "Reported as answered",
      "Closed by a session",
    ]);
    expect(host.querySelectorAll(".inbox-card")).toHaveLength(3);
  });

  it("draws a from card and links it to the raising project's decision page", () => {
    const host = draw(
      projectInboxView({
        counts: { waiting: 1, oneWay: 0, reported: 0, closed: 0 },
        decisions: [
          inboxHead({
            project: "fleet",
            from: "fleet",
            id: "d-from",
            question: "Standing?",
            group: "waiting",
            state: "open",
            decider: "owner",
          }),
          inboxHead({ id: "d1", question: "Own?", group: "waiting" }),
        ],
      }),
    );
    expect(textOf(host)).toContain(
      "From fleet: a standing instruction that applies to this project.",
    );
    const fromLink = host.querySelector('a[href="/p/fleet/d/d-from"]');
    expect(fromLink).not.toBeNull();
    expect(fromLink?.getAttribute("data-key")).toBe("nav");
    // The own head still links home, not to the rasing project.
    expect(host.querySelector('a[href="/p/alpha/d/d1"]')).not.toBeNull();
  });

  it("counts the waiting cards as own waiting plus from heads in that group", () => {
    const host = draw(
      projectInboxView({
        counts: { waiting: 2, oneWay: 0, reported: 0, closed: 0 },
        decisions: [
          inboxHead({
            id: "w1",
            group: "waiting",
            state: "open",
            decider: "owner",
          }),
          inboxHead({
            id: "w2",
            group: "waiting",
            state: "open",
            decider: "owner",
          }),
          inboxHead({
            project: "fleet",
            from: "fleet",
            id: "w3",
            group: "waiting",
            state: "open",
            decider: "owner",
          }),
        ],
      }),
    );
    expect(
      host.querySelectorAll(".inbox-group.inbox-waiting .inbox-card"),
    ).toHaveLength(3);
  });

  describe("the history block", () => {
    it("draws nothing when there are no history heads", () => {
      const host = draw(
        projectInboxView({
          counts: { waiting: 0, oneWay: 0, reported: 0, closed: 0 },
          decisions: [
            inboxHead({
              id: "d1",
              group: "waiting",
              state: "open",
              decider: "owner",
            }),
          ],
        }),
      );
      expect(host.querySelector(".project-inbox-history")).toBeNull();
    });

    it("draws the singular summary for one history head", () => {
      const host = draw(
        projectInboxView({
          counts: { waiting: 0, oneWay: 0, reported: 0, closed: 0 },
          decisions: [
            inboxHead({ id: "h1", group: "history", state: "answered" }),
          ],
        }),
      );
      expect(textsOf(host, ".project-inbox-history summary")).toStrictEqual([
        "1 decision left the inbox after 14 days.",
      ]);
    });

    it("draws the plural summary for three history heads", () => {
      const host = draw(
        projectInboxView({
          counts: { waiting: 0, oneWay: 0, reported: 0, closed: 0 },
          decisions: [
            inboxHead({ id: "h1", group: "history", state: "answered" }),
            inboxHead({ id: "h2", group: "history", state: "answered" }),
            inboxHead({ id: "h3", group: "history", state: "answered" }),
          ],
        }),
      );
      expect(textsOf(host, ".project-inbox-history summary")).toStrictEqual([
        "3 decisions left the inbox after 14 days.",
      ]);
    });

    it("orders history heads newest at first", () => {
      const host = draw(
        projectInboxView({
          counts: { waiting: 0, oneWay: 0, reported: 0, closed: 0 },
          decisions: [
            inboxHead({
              id: "old",
              question: "Old?",
              group: "history",
              state: "answered",
              at: "2026-10-01T10:00:00.000Z",
            }),
            inboxHead({
              id: "mid",
              question: "Mid?",
              group: "history",
              state: "answered",
              at: "2026-10-04T10:00:00.000Z",
            }),
            inboxHead({
              id: "new",
              question: "New?",
              group: "history",
              state: "answered",
              at: "2026-10-08T10:00:00.000Z",
            }),
          ],
        }),
      );
      expect(textsOf(host, ".project-inbox-history-line")).toStrictEqual([
        "New? · reported as answered · 2026-10-08 at 10:00 UTC",
        "Mid? · reported as answered · 2026-10-04 at 10:00 UTC",
        "Old? · reported as answered · 2026-10-01 at 10:00 UTC",
      ]);
    });

    it("links a from history head to the raiser's decision page", () => {
      const host = draw(
        projectInboxView({
          counts: { waiting: 0, oneWay: 0, reported: 0, closed: 0 },
          decisions: [
            inboxHead({
              project: "fleet",
              from: "fleet",
              id: "h-from",
              question: "From?",
              group: "history",
              state: "answered",
            }),
          ],
        }),
      );
      expect(textsOf(host, ".project-inbox-history-line")).toStrictEqual([
        "From? · reported as answered · 2026-04-01 at 12:00 UTC",
      ]);
      const link = host.querySelector('a[href="/p/fleet/d/h-from"]');
      expect(link).not.toBeNull();
      expect(link?.getAttribute("data-key")).toBe("nav");
    });

    it("uses each state's words in the card's voice", () => {
      const cases: [Head["state"], string][] = [
        ["approved", "reported as approved"],
        ["declined", "reported as declined"],
        ["answered", "reported as answered"],
        ["withdrawn", "withdrawn by a session"],
        ["superseded", "replaced by a later decision"],
      ];
      for (const [state, word] of cases) {
        const host = draw(
          projectInboxView({
            counts: { waiting: 0, oneWay: 0, reported: 0, closed: 0 },
            decisions: [
              inboxHead({
                id: "h",
                question: "Go?",
                group: "history",
                state,
              }),
            ],
          }),
        );
        expect(textsOf(host, ".project-inbox-history-line")).toStrictEqual([
          `Go? · ${word} · 2026-04-01 at 12:00 UTC`,
        ]);
      }
    });
  });

  it("shows the empty line for a project with nothing in the three groups", () => {
    const host = draw(
      projectInboxView({
        counts: { waiting: 0, oneWay: 0, reported: 0, closed: 0 },
        decisions: [],
      }),
    );
    expect(textsOf(host, ".project-inbox-empty")).toStrictEqual([
      "Nothing is waiting on you in this project.",
    ]);
    expect(host.querySelector(".inbox-group")).toBeNull();
    expect(host.querySelector(".project-inbox-history")).toBeNull();
    expect(textsOf(host, ".inbox-counts")).toStrictEqual([
      "0 waiting (0 one-way doors) · 0 reported · 0 closed by a session",
    ]);
  });

  it("names no instructions from other projects when none carry from", () => {
    const host = draw(
      projectInboxView({
        counts: { waiting: 1, oneWay: 0, reported: 0, closed: 0 },
        decisions: [
          inboxHead({
            id: "d1",
            group: "waiting",
            state: "open",
            decider: "owner",
          }),
        ],
      }),
    );
    expect(textsOf(host, ".inbox-counts")).toStrictEqual([
      "1 waiting (0 one-way doors) · 0 reported · 0 closed by a session",
    ]);
  });

  it("names one instruction from another project on the count line", () => {
    const host = draw(
      projectInboxView({
        counts: { waiting: 2, oneWay: 0, reported: 0, closed: 0 },
        decisions: [
          inboxHead({
            id: "d1",
            group: "waiting",
            state: "open",
            decider: "owner",
          }),
          inboxHead({
            project: "fleet",
            from: "fleet",
            id: "d2",
            question: "Standing?",
            group: "waiting",
            state: "open",
            decider: "owner",
          }),
        ],
      }),
    );
    expect(textsOf(host, ".inbox-counts")).toStrictEqual([
      "2 waiting (0 one-way doors) · 0 reported · 0 closed by a session · 1 from another project",
    ]);
  });

  it("names two instructions from other projects on the count line", () => {
    const host = draw(
      projectInboxView({
        counts: { waiting: 1, oneWay: 0, reported: 0, closed: 0 },
        decisions: [
          inboxHead({
            id: "d1",
            group: "waiting",
            state: "open",
            decider: "owner",
          }),
          inboxHead({
            project: "fleet",
            from: "fleet",
            id: "d2",
            question: "First?",
            group: "reported",
            state: "approved",
            source: "reported",
          }),
          inboxHead({
            project: "fleet",
            from: "fleet",
            id: "d3",
            question: "Second?",
            group: "closed",
            state: "withdrawn",
            entries: 2,
          }),
        ],
      }),
    );
    expect(textsOf(host, ".inbox-counts")).toStrictEqual([
      "1 waiting (0 one-way doors) · 0 reported · 0 closed by a session · 2 from other projects",
    ]);
  });

  it("does not count a from head in the history group", () => {
    const host = draw(
      projectInboxView({
        counts: { waiting: 0, oneWay: 0, reported: 0, closed: 0 },
        decisions: [
          inboxHead({
            project: "fleet",
            from: "fleet",
            id: "h",
            question: "Old?",
            group: "history",
            state: "answered",
          }),
        ],
      }),
    );
    expect(textsOf(host, ".inbox-counts")).toStrictEqual([
      "0 waiting (0 one-way doors) · 0 reported · 0 closed by a session",
    ]);
  });

  it("contains no button, input, select, textarea or form", () => {
    const host = draw(
      projectInboxView({
        counts: { waiting: 1, oneWay: 0, reported: 0, closed: 0 },
        decisions: [
          inboxHead({
            id: "d1",
            group: "waiting",
            state: "open",
            decider: "owner",
          }),
          inboxHead({
            project: "fleet",
            from: "fleet",
            id: "d2",
            group: "reported",
            state: "approved",
            source: "reported",
          }),
        ],
      }),
      "Alpha",
      [inboxEvent()],
    );
    for (const tag of ["BUTTON", "INPUT", "SELECT", "TEXTAREA", "FORM"]) {
      expect(host.querySelectorAll(tag)).toHaveLength(0);
    }
  });

  describe("the events list", () => {
    it("says no events when the list is empty", () => {
      const host = draw(
        projectInboxView({
          counts: { waiting: 0, oneWay: 0, reported: 0, closed: 0 },
          decisions: [],
        }),
      );
      expect(textsOf(host, ".inbox-events h3")).toStrictEqual(["Events"]);
      expect(textsOf(host, ".project-inbox-events-empty")).toStrictEqual([
        "No events.",
      ]);
    });

    it("draws one event as date, topic and text", () => {
      const host = draw(
        projectInboxView({
          counts: { waiting: 0, oneWay: 0, reported: 0, closed: 0 },
          decisions: [],
        }),
        "Alpha",
        [inboxEvent()],
      );
      expect(textsOf(host, ".project-event")).toStrictEqual([
        "2026-04-01 at 12:00 UTC · relay · Round 3 sent to five sessions",
      ]);
    });

    it("draws the detail on its own line beneath", () => {
      const host = draw(
        projectInboxView({
          counts: { waiting: 0, oneWay: 0, reported: 0, closed: 0 },
          decisions: [],
        }),
        "Alpha",
        [
          inboxEvent({
            event: { ...inboxEvent().event, detail: "with more context" },
          }),
        ],
      );
      expect(textsOf(host, ".project-event")).toStrictEqual([
        "2026-04-01 at 12:00 UTC · relay · Round 3 sent to five sessions",
      ]);
      expect(textsOf(host, ".project-event-detail")).toStrictEqual([
        "with more context",
      ]);
    });

    it("draws a wave ref as plain text", () => {
      const host = draw(
        projectInboxView({
          counts: { waiting: 0, oneWay: 0, reported: 0, closed: 0 },
          decisions: [],
        }),
        "Alpha",
        [
          inboxEvent({
            event: { ...inboxEvent().event, refs: { wave: "w-1" } },
          }),
        ],
      );
      expect(textsOf(host, ".project-event")).toStrictEqual([
        "2026-04-01 at 12:00 UTC · relay · Round 3 sent to five sessions · wave w-1",
      ]);
    });

    it("draws a lane ref as plain text", () => {
      const host = draw(
        projectInboxView({
          counts: { waiting: 0, oneWay: 0, reported: 0, closed: 0 },
          decisions: [],
        }),
        "Alpha",
        [
          inboxEvent({
            event: { ...inboxEvent().event, refs: { lane: "l-1" } },
          }),
        ],
      );
      expect(textsOf(host, ".project-event")).toStrictEqual([
        "2026-04-01 at 12:00 UTC · relay · Round 3 sent to five sessions · lane l-1",
      ]);
    });

    it("draws a PR ref as plain text", () => {
      const host = draw(
        projectInboxView({
          counts: { waiting: 0, oneWay: 0, reported: 0, closed: 0 },
          decisions: [],
        }),
        "Alpha",
        [
          inboxEvent({
            event: { ...inboxEvent().event, refs: { pr: 42 } },
          }),
        ],
      );
      expect(textsOf(host, ".project-event")).toStrictEqual([
        "2026-04-01 at 12:00 UTC · relay · Round 3 sent to five sessions · PR #42",
      ]);
    });

    it("draws no refs text when the refs object is empty", () => {
      const host = draw(
        projectInboxView({
          counts: { waiting: 0, oneWay: 0, reported: 0, closed: 0 },
          decisions: [],
        }),
        "Alpha",
        [
          inboxEvent({
            event: { ...inboxEvent().event, refs: {} },
          }),
        ],
      );
      expect(textsOf(host, ".project-event")).toStrictEqual([
        "2026-04-01 at 12:00 UTC · relay · Round 3 sent to five sessions",
      ]);
    });

    it("shows the cap line when exactly 200 events are shown", () => {
      const events = Array.from({ length: 200 }, () => inboxEvent());
      const host = draw(
        projectInboxView({
          counts: { waiting: 0, oneWay: 0, reported: 0, closed: 0 },
          decisions: [],
        }),
        "Alpha",
        events,
      );
      expect(textsOf(host, ".project-inbox-events-limit")).toStrictEqual([
        "Showing the newest 200.",
      ]);
    });
  });

  it("never prints undefined, null, NaN or Invalid Date", () => {
    const host = draw(
      projectInboxView({
        counts: { waiting: 0, oneWay: 0, reported: 0, closed: 0 },
        decisions: [
          inboxHead({
            project: "fleet",
            from: "fleet",
            id: "d",
            question: "Standing?",
            group: "waiting",
            state: "open",
            decider: "owner",
          }),
        ],
      }),
    );
    expect(textOf(host)).not.toContain("undefined");
    expect(textOf(host)).not.toContain("null");
    expect(textOf(host)).not.toContain("NaN");
    expect(textOf(host)).not.toContain("Invalid Date");
  });
});
