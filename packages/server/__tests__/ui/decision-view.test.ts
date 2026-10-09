import { describe, expect, it } from "vitest";

import { drawableDecision } from "../../public/decision.js";
import { decisionModel } from "../../public/views/decision-model.js";
import { renderDecision } from "../../public/views/decision.js";

import type {
  DecisionView,
  Head,
} from "../../src/application/notice-read-model.js";
import {
  decisionEntry,
  decisionRevision,
  decisionResponse,
  HASH,
  inboxHead,
  storedRevision,
} from "./fixtures.js";
import {
  assertNoInjectedMarkup,
  freshRoot,
  textOf,
  textsOf,
} from "./helpers.js";

/**
 * Draws a decision from a checked response, asserts the markup invariants, and
 * asserts that no element's text contains undefined, null, NaN or Invalid Date.
 */
function draw(view: DecisionView, overrides: Partial<Head> = {}): HTMLElement {
  if (!drawableDecision(view, view.head.project, view.head.id)) {
    throw new Error("not a drawable decision");
  }
  const model = decisionModel({
    ...view,
    head: { ...view.head, ...overrides },
  });
  const host = freshRoot();
  host.append(renderDecision(model));
  assertNoInjectedMarkup();
  const text = host.textContent ?? "";
  for (const word of ["undefined", "null", "NaN", "Invalid Date"]) {
    expect(text).not.toContain(word);
  }
  return host;
}

describe("renderDecision", () => {
  it("shows the breadcrumb, door, question, facts and footer", () => {
    const host = draw(decisionResponse());
    expect(textOf(host.querySelector(".decision-breadcrumbs"))).toBe(
      "Inbox · alpha",
    );
    expect(textsOf(host, "h1")).toStrictEqual(["Go?"]);
    expect(textOf(host.querySelector(".decision-facts"))).toBe(
      "choice · yours to decide · revision 1 of 1 · raised by session on 2026-10-08 at 12:00 UTC",
    );
    expect(textOf(host.querySelector(".decision-footer"))).toBe(
      "This page shows a decision; it does not take an answer. Answer in the terminal, in the session that asked.",
    );
  });

  it("shows the earlier-text note in the state area for a head with earlierAnswer", () => {
    const host = draw(
      decisionResponse({
        head: inboxHead({
          earlierAnswer: {
            state: "approved",
            source: "reported",
            at: "2026-10-08T13:00:00Z",
            by: "owner",
            words: "yes",
          },
        }),
      }),
    );
    expect(textOf(host)).toContain(
      'An earlier text of this decision was answered: approved: "yes". That answer does not apply to the current text.',
    );
    // The note is above the Options heading, not in the history list.
    const optionsHeading = host.querySelector(".decision-options h2");
    const note = Array.from(host.querySelectorAll(".card-earlier")).find(
      (n) => n.textContent && n.textContent.includes("An earlier text"),
    );
    expect(note).toBeDefined();
    expect(optionsHeading).not.toBeNull();
  });

  it("uses the first revision's raisedAt in the facts line, with revised on", () => {
    const OTHER_HASH = "b".repeat(64);
    const host = draw(
      decisionResponse({
        head: inboxHead({ revision: 2, revisions: 2, textSha256: OTHER_HASH }),
        revisions: [
          storedRevision({
            revision: 1,
            receivedAt: "2026-10-08T06:25:00Z",
            decision: decisionRevision({ raisedAt: "2026-10-08T06:25:00Z" }),
          }),
          storedRevision({
            revision: 2,
            textSha256: OTHER_HASH,
            receivedAt: "2026-10-09T11:25:00Z",
            decision: decisionRevision({
              question: "New?",
              raisedAt: "2026-10-08T11:25:00Z",
            }),
          }),
        ],
      }),
    );
    expect(textOf(host.querySelector(".decision-facts"))).toBe(
      "choice · yours to decide · revision 2 of 2 · raised by session on 2026-10-08 at 06:25 UTC · revised on 2026-10-09 at 11:25 UTC",
    );
  });

  it("shows a choice with no recommendation, commitments or evidence", () => {
    const host = draw(decisionResponse());
    expect(textsOf(host, ".decision-options h2")).toStrictEqual(["Options"]);
    expect(textsOf(host, ".option-head")).toStrictEqual(["a: Yes", "b: No"]);
    expect(textsOf(host, ".option-cost")).toStrictEqual([
      "Cost: C1",
      "Cost: C2",
    ]);
    expect(textsOf(host, ".no-recommendation")).toStrictEqual([
      "No recommendation given.",
    ]);
    expect(host.querySelector(".decision-commits")).toBeNull();
    expect(host.querySelector(".decision-evidence")).toBeNull();
  });

  it("marks the recommended option in a choice", () => {
    const host = draw(
      decisionResponse({
        revisions: [
          storedRevision({
            decision: decisionRevision({
              recommended: { option: "a", reason: "best" },
            }),
          }),
        ],
      }),
    );
    expect(textsOf(host, ".option-head")).toStrictEqual([
      "Recommended · a: Yes",
      "b: No",
    ]);
    expect(textsOf(host, ".option-why")).toStrictEqual(["Why: best"]);
  });

  it("shows an action with What you would do", () => {
    const host = draw(
      decisionResponse({
        head: inboxHead({ shape: "action" }),
        revisions: [
          storedRevision({
            decision: decisionRevision({
              shape: "action",
              options: [],
              actElsewhere: { where: "terminal", what: "run this" },
            }),
          }),
        ],
      }),
    );
    expect(textsOf(host, ".decision-action h2")).toStrictEqual([
      "What you would do",
    ]);
    expect(textsOf(host, ".card-elsewhere")).toStrictEqual([
      "Cannot be answered here. Act in: terminal: run this.",
    ]);
  });

  it("shows an instruction with applies-to links", () => {
    const host = draw(
      decisionResponse({
        head: inboxHead({ shape: "instruction" }),
        revisions: [
          storedRevision({
            decision: decisionRevision({
              shape: "instruction",
              options: [],
              appliesTo: ["beta", "gamma"],
            }),
          }),
        ],
      }),
    );
    expect(textsOf(host, ".decision-applies-to h2")).toStrictEqual([
      "Applies to",
    ]);
    expect(textsOf(host, ".applies-to a")).toStrictEqual(["beta", "gamma"]);
  });

  it("shows the act-elsewhere line for a non-action decision with it", () => {
    const host = draw(
      decisionResponse({
        revisions: [
          storedRevision({
            decision: decisionRevision({
              actElsewhere: { where: "session x", what: "answer there" },
            }),
          }),
        ],
      }),
    );
    expect(textsOf(host, ".card-elsewhere")).toStrictEqual([
      "Cannot be answered here. Act in: session x: answer there.",
    ]);
  });

  it("shows the door band verbatim when the door is true", () => {
    const host = draw(
      decisionResponse({
        head: inboxHead({
          door: { value: "partly", reason: '<b>"x"</b> & more' },
        }),
        revisions: [
          storedRevision({
            decision: decisionRevision({
              hardToUndo: { value: "partly", reason: '<b>"x"</b> & more' },
            }),
          }),
        ],
      }),
    );
    expect(textOf(host.querySelector(".door-band"))).toBe(
      'PARTLY UNDOABLE: <b>"x"</b> & more',
    );
    expect(host.querySelectorAll("b")).toHaveLength(0);
  });

  it("shows no door band when the door is false", () => {
    const host = draw(decisionResponse());
    expect(host.querySelector(".door-band")).toBeNull();
  });

  it("shows the state sentence for a reported answer", () => {
    const host = draw(
      decisionResponse({
        head: inboxHead({
          group: "reported",
          state: "approved",
          source: "reported",
        }),
      }),
    );
    expect(textOf(host.querySelector(".card-state"))).toBe(
      "The alpha session reports you approved this on 2026-04-01 at 12:00 UTC.",
    );
    expect(textsOf(host, ".card-small")).toContain(
      "Reported by a session, not signed by you.",
    );
  });

  it("shows the history sentence for a history decision", () => {
    const host = draw(
      decisionResponse({
        head: inboxHead({
          group: "history",
          state: "approved",
          source: "reported",
        }),
      }),
    );
    expect(textOf(host.querySelector(".card-state"))).toBe(
      "The alpha session reports you approved this on 2026-04-01 at 12:00 UTC.",
    );
    expect(textsOf(host, ".card-small")).toContain(
      "This left the inbox after 14 days.",
    );
  });

  it("renders three revisions and entries on two of them", () => {
    const OTHER_HASH = "b".repeat(64);
    const THIRD_HASH = "c".repeat(64);
    const host = draw(
      decisionResponse({
        head: inboxHead({
          revision: 3,
          revisions: 3,
          entries: 2,
          textSha256: THIRD_HASH,
        }),
        revisions: [
          storedRevision({
            revision: 1,
            textSha256: HASH,
            receivedAt: "2026-10-08T12:00:00Z",
          }),
          storedRevision({
            revision: 2,
            textSha256: OTHER_HASH,
            decision: decisionRevision({ question: "Q2?" }),
            receivedAt: "2026-10-09T12:00:00Z",
          }),
          storedRevision({
            revision: 3,
            textSha256: THIRD_HASH,
            decision: decisionRevision({
              question: "Q3?",
              changeNote: "narrowed",
            }),
            receivedAt: "2026-10-10T12:00:00Z",
          }),
        ],
        entries: [
          decisionEntry({
            index: 0,
            revision: 1,
            textSha256: HASH,
            state: "approved",
            source: "reported",
            words: "yes",
          }),
          decisionEntry({
            index: 1,
            revision: 2,
            textSha256: OTHER_HASH,
            state: "approved",
            source: "reported",
            words: "yes",
          }),
        ],
      }),
    );
    expect(host.querySelectorAll("details.earlier-text")).toHaveLength(2);
    expect(textsOf(host, "details.earlier-text summary")).toStrictEqual([
      "Revision 1, as it read",
      "Revision 2, as it read",
    ]);
    expect(textOf(host.querySelector(".decision-facts"))).toContain(
      "revision 3 of 3",
    );
  });

  it("never shows a bare Approved, Declined or Answered", () => {
    const OTHER_HASH = "b".repeat(64);
    const host = draw(
      decisionResponse({
        head: inboxHead({
          revision: 2,
          revisions: 2,
          entries: 1,
          textSha256: OTHER_HASH,
        }),
        revisions: [
          storedRevision({ revision: 1, receivedAt: "2026-10-08T12:00:00Z" }),
          storedRevision({
            revision: 2,
            textSha256: OTHER_HASH,
            decision: decisionRevision({ question: "New?" }),
            receivedAt: "2026-10-09T12:00:00Z",
          }),
        ],
        entries: [
          decisionEntry({
            revision: 1,
            textSha256: HASH,
            state: "approved",
            source: "reported",
            words: "yes",
          }),
        ],
      }),
    );
    for (const el of host.querySelectorAll("p, small, span")) {
      expect(el.textContent).not.toBe("Approved");
      expect(el.textContent).not.toBe("Declined");
      expect(el.textContent).not.toBe("Answered");
    }
  });

  it("contains no button, input, select, textarea or form", () => {
    const host = draw(decisionResponse());
    for (const tag of ["BUTTON", "INPUT", "SELECT", "TEXTAREA", "FORM"]) {
      expect(host.querySelectorAll(tag)).toHaveLength(0);
    }
  });

  it("refuses to draw a response that fails the shape check", () => {
    const bad = {
      ...decisionResponse(),
      head: { ...inboxHead(), project: "beta" },
    };
    expect(() => draw(bad as DecisionView)).toThrow("not a drawable decision");
  });
});
