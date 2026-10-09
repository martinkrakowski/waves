import { describe, expect, it } from "vitest";

import { drawableInbox } from "../../public/inbox.js";
import { inboxModel } from "../../public/views/inbox-model.js";
import { renderInbox } from "../../public/views/inbox.js";

import {
  inboxFromFixtures,
  inboxHead,
  inboxView,
  INBOX_NOW_MS,
} from "./fixtures.js";
import {
  assertNoInjectedMarkup,
  freshRoot,
  textOf,
  textsOf,
} from "./helpers.js";

/** Draws the inbox from a model and returns the host it was drawn into. */
function draw(view: unknown, nowMs = INBOX_NOW_MS): HTMLElement {
  if (!drawableInbox(view)) {
    throw new Error("not a drawable inbox");
  }
  const host = freshRoot();
  host.append(renderInbox(inboxModel(view), nowMs));
  assertNoInjectedMarkup();
  return host;
}

/** The text of all `.inbox-counts` lines, in order. */
function countLines(host: HTMLElement): string[] {
  return textsOf(host, ".inbox-counts");
}

/** The full text of the project block whose link is named `name`. */
function projectText(host: HTMLElement, name: string): string {
  const block = Array.from(host.querySelectorAll(".inbox-project")).find(
    (section) =>
      textOf(section.querySelector("h2 a") ?? section.querySelector("h2")) ===
      name,
  );
  return block !== undefined ? textOf(block) : "";
}

describe("the fourteenth fixtures", () => {
  const view = inboxFromFixtures();

  it("names the four counts for every project", () => {
    const host = draw(view);
    const lines = countLines(host);
    expect(lines).toHaveLength(6);
    expect(lines).toContain(
      "1 waiting (1 one-way door) · 1 reported · 0 closed by a session",
    );
    expect(lines).toContain(
      "3 waiting (1 one-way door) · 0 reported · 0 closed by a session",
    );
    expect(lines).toContain(
      "2 waiting (0 one-way doors) · 0 reported · 0 closed by a session",
    );
    expect(lines).toContain(
      "2 waiting (1 one-way door) · 2 reported · 0 closed by a session",
    );
  });

  it("shows the page totals naming each source, not one sum", () => {
    const host = draw(view);
    expect(textsOf(host, ".inbox-totals")).toStrictEqual([
      "11 waiting (3 one-way doors) · 3 reported · 0 closed by a session",
    ]);
  });

  it("orders projects by oneWay desc, waiting desc, then name", () => {
    const host = draw(view);
    expect(textsOf(host, ".inbox-project h2 a")).toStrictEqual([
      "Campaign Foundry",
      "Fleet",
      "Hexagen Monaco",
      "Client Portal",
      "Gate Lock",
      "Waves",
    ]);
  });

  it("puts backup-job-in-freeze under Waiting on you with its door band", () => {
    const host = draw(view);
    const fleet = projectText(host, "Fleet");
    const band = textsOf(host, ".door-band");
    expect(band).toContain("ONE-WAY DOOR: a production deployment");
    const waitingIdx = fleet.indexOf("Waiting on you");
    expect(waitingIdx).toBeGreaterThanOrEqual(0);
    const after = fleet.slice(waitingIdx);
    expect(after).toContain("backup-job-in-freeze");
    expect(after).toContain("ONE-WAY DOOR: a production deployment");
  });

  it("puts test-db-switch-hold under Reported as answered", () => {
    const host = draw(view);
    const fleet = projectText(host, "Fleet");
    expect(fleet).toContain("Reported as answered");
    const reportedIdx = fleet.indexOf("Reported as answered");
    expect(reportedIdx).toBeGreaterThanOrEqual(0);
    const after = fleet.slice(reportedIdx);
    expect(after).toContain("test-db-switch-hold");
  });

  it("reads each decision's revision", () => {
    const host = draw(view);
    const gate = projectText(host, "Gate Lock");
    expect(gate).toContain("revision 2 of 2");
  });

  it("draws clean-merged-worktrees under waves with From fleet", () => {
    const host = draw(view);
    const wavesSection = Array.from(
      host.querySelectorAll(".inbox-project"),
    ).find(
      (section) =>
        textOf(section.querySelector("h2 a") ?? section.querySelector("h2")) ===
        "Waves",
    );
    expect(wavesSection).toBeDefined();
    const wavesText = textOf(wavesSection as Element);
    expect(wavesText).toContain("clean-merged-worktrees");
    expect(wavesText).toContain(
      "From fleet: a standing instruction that applies to this project.",
    );
  });

  it("draws the footer that says the page takes no answers", () => {
    const host = draw(view);
    expect(textsOf(host, ".inbox-footer")).toStrictEqual([
      "This page shows decisions; it does not take answers. A session's own permission prompt can only be cleared in that session.",
    ]);
  });
});

describe("the inbox page rules", () => {
  const view = inboxFromFixtures();

  it("contains no button, input, select, textarea or form", () => {
    const host = draw(view);
    for (const tag of ["BUTTON", "INPUT", "SELECT", "TEXTAREA", "FORM"]) {
      expect(host.querySelectorAll(tag)).toHaveLength(0);
    }
  });

  it("never shows the bare words Approved, Declined or Answered", () => {
    const host = draw(view);
    for (const element of host.querySelectorAll("p, small, span")) {
      expect(element.textContent).not.toBe("Approved");
      expect(element.textContent).not.toBe("Declined");
      expect(element.textContent).not.toBe("Answered");
    }
  });

  it("shows the door reason as text, character for character", () => {
    const host = draw(
      inboxView({
        projects: [
          {
            id: "alpha",
            name: "Alpha",
            counts: { waiting: 1, oneWay: 1, reported: 0, closed: 0 },
            decisions: [
              inboxHead({
                question: "Test?",
                door: { value: true, reason: '<b>"x"</b> & more' },
              }),
            ],
          },
        ],
      }),
    );
    const band = host.querySelector(".door-band");
    expect(band).not.toBeNull();
    expect(band?.textContent).toBe('ONE-WAY DOOR: <b>"x"</b> & more');
    expect(host.querySelectorAll("b")).toHaveLength(0);
  });

  it("shows a waiting/open/delegated card with the delegation note", () => {
    const host = draw(
      inboxView({
        projects: [
          {
            id: "alpha",
            name: "Alpha",
            counts: { waiting: 1, oneWay: 0, reported: 0, closed: 0 },
            decisions: [
              inboxHead({
                question: "Delegate?",
                shape: "choice",
                door: { value: false },
                decider: "delegated",
                state: "open",
                group: "waiting",
              }),
            ],
          },
        ],
      }),
    );
    expect(textsOf(host, ".card-state")).toStrictEqual([
      "May be decided under delegation; not decided yet.",
    ]);
  });

  it("shows a closed decision with its covered answer beside it", () => {
    const host = draw(
      inboxView({
        projects: [
          {
            id: "alpha",
            name: "Alpha",
            counts: { waiting: 0, oneWay: 0, reported: 0, closed: 1 },
            decisions: [
              inboxHead({
                question: "Withdrawn?",
                state: "withdrawn",
                group: "closed",
                at: "2026-10-08T13:00:00Z",
                entries: 2,
                coveredAnswer: {
                  state: "approved",
                  source: "reported",
                  at: "2026-10-08T13:00:00Z",
                  by: "owner",
                  words: "Yes, go ahead",
                },
              }),
            ],
          },
        ],
      }),
    );
    const text = textOf(host);
    expect(text).toContain("The alpha session withdrew this question on");
    expect(text).toContain(
      'It had been reported that you approved: "Yes, go ahead".',
    );
  });

  it("shows an empty inbox with zero totals and the footer", () => {
    const host = draw(inboxView({ projects: [] }));
    expect(textsOf(host, ".inbox-totals")).toStrictEqual([
      "0 waiting (0 one-way doors) · 0 reported · 0 closed by a session",
    ]);
    expect(host.querySelectorAll(".inbox-project")).toHaveLength(0);
    expect(textsOf(host, ".inbox-footer")).toHaveLength(1);
  });

  it("shows a project with only closed cards under its own heading", () => {
    const host = draw(
      inboxView({
        projects: [
          {
            id: "alpha",
            name: "Alpha",
            counts: { waiting: 0, oneWay: 0, reported: 0, closed: 1 },
            decisions: [
              inboxHead({
                question: "Superseded?",
                state: "superseded",
                group: "closed",
                at: "2026-10-08T13:00:00Z",
                entries: 1,
              }),
            ],
          },
        ],
      }),
    );
    expect(textsOf(host, ".inbox-group h3")).toStrictEqual([
      "Closed by a session",
    ]);
    const state = host.querySelector(".card-state");
    expect(state).not.toBeNull();
    expect(textOf(state as Element)).toContain(
      "The alpha session replaced this with a later decision on",
    );
  });

  it("draws a waiting/open/delegated card with the delegation note", () => {
    const host = draw(
      inboxView({
        projects: [
          {
            id: "alpha",
            name: "Alpha",
            counts: { waiting: 1, oneWay: 0, reported: 0, closed: 0 },
            decisions: [
              inboxHead({
                question: "Delegate?",
                shape: "choice",
                door: { value: false },
                decider: "delegated",
                state: "open",
                group: "waiting",
              }),
            ],
          },
        ],
      }),
    );
    expect(textsOf(host, ".card-state")).toStrictEqual([
      "May be decided under delegation; not decided yet.",
    ]);
  });

  it("shows a door band with no reason as the label alone", () => {
    const host = draw(
      inboxView({
        projects: [
          {
            id: "alpha",
            name: "Alpha",
            counts: { waiting: 1, oneWay: 1, reported: 0, closed: 0 },
            decisions: [
              inboxHead({
                question: "No reason?",
                door: { value: true },
              }),
            ],
          },
        ],
      }),
    );
    expect(textsOf(host, ".door-band")).toStrictEqual(["ONE-WAY DOOR:"]);
  });

  it("shows a covered answer with no words as the verb alone", () => {
    const host = draw(
      inboxView({
        projects: [
          {
            id: "alpha",
            name: "Alpha",
            counts: { waiting: 0, oneWay: 0, reported: 0, closed: 1 },
            decisions: [
              inboxHead({
                question: "Withdrawn?",
                state: "withdrawn",
                group: "closed",
                at: "2026-10-08T13:00:00Z",
                entries: 2,
                coveredAnswer: {
                  state: "declined",
                  source: "reported",
                  at: "2026-10-08T13:00:00Z",
                  by: "owner",
                },
              }),
            ],
          },
        ],
      }),
    );
    expect(textOf(host)).toContain("It had been reported that you declined.");
  });

  it("shows an earlier answer with no words as the verb alone", () => {
    const host = draw(
      inboxView({
        projects: [
          {
            id: "alpha",
            name: "Alpha",
            counts: { waiting: 1, oneWay: 0, reported: 0, closed: 0 },
            decisions: [
              inboxHead({
                question: "Changed?",
                state: "open",
                group: "waiting",
                earlierAnswer: {
                  state: "declined",
                  source: "reported",
                  at: "2026-10-08T13:00:00Z",
                  by: "owner",
                },
              }),
            ],
          },
        ],
      }),
    );
    expect(textOf(host)).toContain(
      "An earlier text of this decision was answered: declined. That answer does not apply to the current text.",
    );
  });
});
