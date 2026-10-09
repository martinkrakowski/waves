import { describe, expect, it } from "vitest";

import { drawableProjectInbox } from "../../public/project-inbox.js";
import { renderProjectInbox } from "../../public/views/project-inbox.js";

import type { ProjectInboxView } from "../../src/application/notice-read-model.js";
import { INBOX_NOW_MS, inboxHead, projectInboxView } from "./fixtures.js";
import {
  assertNoInjectedMarkup,
  freshRoot,
  textOf,
  textsOf,
} from "./helpers.js";

/**
 * Draws one project's inbox from a checked view, asserts the markup invariants,
 * and asserts that no element's text contains undefined, null, NaN or Invalid
 * Date — the helper the decision view tests call on every draw, called here the
 * same way.
 */
function draw(view: ProjectInboxView, nowMs = INBOX_NOW_MS): HTMLElement {
  if (!drawableProjectInbox(view, view.project.id)) {
    throw new Error("not a drawable project inbox");
  }
  const host = freshRoot();
  host.append(renderProjectInbox(view, nowMs));
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
        project: { id: "alpha", name: "Alpha" },
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

  it("draws each of the three groups under the inbox's own headings", () => {
    const host = draw(
      projectInboxView({
        project: { id: "alpha", name: "Alpha" },
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
        project: { id: "alpha", name: "Alpha" },
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
        project: { id: "alpha", name: "Alpha" },
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

  describe("the history line", () => {
    it("draws nothing when there are no history heads", () => {
      const host = draw(
        projectInboxView({
          project: { id: "alpha", name: "Alpha" },
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

    it("draws the singular line for one history head", () => {
      const host = draw(
        projectInboxView({
          project: { id: "alpha", name: "Alpha" },
          counts: { waiting: 0, oneWay: 0, reported: 0, closed: 0 },
          decisions: [
            inboxHead({ id: "h1", group: "history", state: "answered" }),
          ],
        }),
      );
      expect(textsOf(host, ".project-inbox-history")).toStrictEqual([
        "1 decision left the inbox after 14 days.",
      ]);
    });

    it("draws the plural line for three history heads", () => {
      const host = draw(
        projectInboxView({
          project: { id: "alpha", name: "Alpha" },
          counts: { waiting: 0, oneWay: 0, reported: 0, closed: 0 },
          decisions: [
            inboxHead({ id: "h1", group: "history", state: "answered" }),
            inboxHead({ id: "h2", group: "history", state: "answered" }),
            inboxHead({ id: "h3", group: "history", state: "answered" }),
          ],
        }),
      );
      expect(textsOf(host, ".project-inbox-history")).toStrictEqual([
        "3 decisions left the inbox after 14 days.",
      ]);
    });
  });

  it("shows the empty line for a project with nothing in the three groups", () => {
    const host = draw(
      projectInboxView({
        project: { id: "alpha", name: "Alpha" },
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

  it("contains no button, input, select, textarea or form", () => {
    const host = draw(
      projectInboxView({
        project: { id: "alpha", name: "Alpha" },
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
    );
    for (const tag of ["BUTTON", "INPUT", "SELECT", "TEXTAREA", "FORM"]) {
      expect(host.querySelectorAll(tag)).toHaveLength(0);
    }
  });

  it("never prints undefined, null, NaN or Invalid Date", () => {
    const host = draw(
      projectInboxView({
        project: { id: "alpha", name: "Alpha" }, // no repo: the optional field is absent
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
