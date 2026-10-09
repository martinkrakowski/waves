import { describe, expect, it } from "vitest";

import { decisionModel } from "../../public/views/decision-model.js";
import {
  earlierTextsBlock,
  historyBlock,
} from "../../public/views/decision-history.js";

import {
  decisionEntry,
  decisionRevision,
  decisionResponse,
  HASH,
  inboxHead,
  storedRevision,
} from "./fixtures.js";
import { assertNoInjectedMarkup, freshRoot, textsOf } from "./helpers.js";
import type { DecisionModel } from "../../public/views/decision-model.js";

/** Draws a model's history section and returns the host. */
function drawHistory(model: DecisionModel): HTMLElement {
  const host = freshRoot();
  host.append(historyBlock(model));
  assertNoInjectedMarkup();
  return host;
}

/** Draws a model's earlier texts and returns the host. */
function drawEarlier(model: DecisionModel): HTMLElement {
  const host = freshRoot();
  const node = earlierTextsBlock(model);
  if (node !== undefined) {
    host.append(node);
  }
  assertNoInjectedMarkup();
  return host;
}

describe("historyBlock", () => {
  it("says Raised by on revision 1 with no changes", () => {
    const host = drawHistory(decisionModel(decisionResponse()));
    expect(textsOf(host, ".history-event")).toStrictEqual([
      "Raised by session on 2026-04-01 at 12:00 UTC.",
    ]);
  });

  it("lists a revision change with what changed", () => {
    const OTHER_HASH = "b".repeat(64);
    const host = drawHistory(
      decisionModel(
        decisionResponse({
          head: inboxHead({ revision: 2, revisions: 2, entries: 2 }),
          revisions: [
            storedRevision({
              revision: 1,
              receivedAt: "2026-10-08T12:00:00Z",
            }),
            storedRevision({
              revision: 2,
              textSha256: OTHER_HASH,
              decision: decisionRevision({ question: "New question?" }),
              receivedAt: "2026-10-09T12:00:00Z",
            }),
          ],
          entries: [
            decisionEntry({
              index: 0,
              revision: 1,
              textSha256: HASH,
              receivedAt: "2026-10-08T13:00:00Z",
              state: "approved",
              source: "reported",
              option: "a",
              words: "yes",
            }),
            decisionEntry({
              index: 1,
              revision: 2,
              textSha256: OTHER_HASH,
              receivedAt: "2026-10-09T13:00:00Z",
              state: "approved",
              source: "reported",
              option: "b",
              words: "yes",
            }),
          ],
        }),
      ),
    );
    expect(textsOf(host, ".history-event")).toStrictEqual([
      'owner recorded that you approved (b) on 2026-10-09 at 13:00 UTC: "yes" reported, not signed',
      "Revision 2 on 2026-10-09 at 12:00 UTC: question changed. The wording an answer was given to is no longer current.",
      'owner recorded that you approved (a) on 2026-10-08 at 13:00 UTC: "yes" reported, not signed (on an earlier text)',
      "Raised by session on 2026-10-08 at 12:00 UTC.",
    ]);
  });

  it("appends the change note when there is one", () => {
    const host = drawHistory(
      decisionModel(
        decisionResponse({
          head: inboxHead({ revision: 2, revisions: 2, entries: 0 }),
          revisions: [
            storedRevision({
              revision: 1,
              decision: decisionRevision({ question: "Old?" }),
              receivedAt: "2026-10-08T12:00:00Z",
            }),
            storedRevision({
              revision: 2,
              decision: decisionRevision({
                question: "New?",
                changeNote: "narrowed after the session reported a window",
              }),
              receivedAt: "2026-10-09T12:00:00Z",
            }),
          ],
        }),
      ),
    );
    expect(textsOf(host, ".history-event")[0]).toBe(
      "Revision 2 on 2026-10-09 at 12:00 UTC: question changed. narrowed after the session reported a window.",
    );
  });

  it("says the wording was given to is no longer current", () => {
    const OTHER_HASH = "b".repeat(64);
    const host = drawHistory(
      decisionModel(
        decisionResponse({
          head: inboxHead({ revision: 2, revisions: 2, entries: 1 }),
          revisions: [
            storedRevision({ revision: 1, textSha256: HASH }),
            storedRevision({
              revision: 2,
              textSha256: OTHER_HASH,
              decision: decisionRevision({ question: "Changed?" }),
              receivedAt: "2026-10-09T12:00:00Z",
            }),
          ],
          entries: [
            decisionEntry({
              index: 0,
              revision: 1,
              textSha256: HASH,
              state: "approved",
              source: "reported",
            }),
          ],
        }),
      ),
    );
    expect(textsOf(host, ".history-event")).toContain(
      "Revision 2 on 2026-10-09 at 12:00 UTC: question changed. The wording an answer was given to is no longer current.",
    );
  });

  it("reports a shape change in the history", () => {
    const OTHER_HASH = "b".repeat(64);
    const host = drawHistory(
      decisionModel(
        decisionResponse({
          head: inboxHead({ revision: 2, revisions: 2, entries: 1 }),
          revisions: [
            storedRevision({ revision: 1, textSha256: HASH }),
            storedRevision({
              revision: 2,
              textSha256: OTHER_HASH,
              decision: decisionRevision({ shape: "action" }),
              receivedAt: "2026-10-09T12:00:00Z",
            }),
          ],
          entries: [
            decisionEntry({
              revision: 1,
              textSha256: HASH,
              state: "approved",
              source: "reported",
            }),
          ],
        }),
      ),
    );
    expect(textsOf(host, ".history-event")).toContain(
      "Revision 2 on 2026-10-09 at 12:00 UTC: shape changed. The wording an answer was given to is no longer current.",
    );
  });

  it("renders a superseded entry as a link to the decision page", () => {
    const host = drawHistory(
      decisionModel(
        decisionResponse({
          head: inboxHead({ revision: 1, revisions: 1, entries: 1 }),
          entries: [
            decisionEntry({
              state: "superseded",
              source: "session",
              supersededBy: "other-decision",
            }),
          ],
        }),
      ),
    );
    const link = host.querySelector(".history-event a");
    expect(link).not.toBeNull();
    expect(link?.textContent).toBe("other-decision");
    expect(link?.getAttribute("href")).toBe("/p/alpha/d/other-decision");
  });

  it("renders a withdrawn entry with its reason", () => {
    const host = drawHistory(
      decisionModel(
        decisionResponse({
          head: inboxHead({ revision: 1, revisions: 1, entries: 1 }),
          entries: [
            decisionEntry({
              state: "withdrawn",
              source: "session",
              reason: "fixed another way",
            }),
          ],
        }),
      ),
    );
    expect(textsOf(host, ".history-event")).toContain(
      "owner withdrew this question: fixed another way",
    );
  });

  it("says no text changed for a revision with the same text", () => {
    const host = drawHistory(
      decisionModel(
        decisionResponse({
          head: inboxHead({ revision: 2, revisions: 2, entries: 0 }),
          revisions: [
            storedRevision({ revision: 1, receivedAt: "2026-10-08T12:00:00Z" }),
            storedRevision({ revision: 2, receivedAt: "2026-10-09T12:00:00Z" }),
          ],
        }),
      ),
    );
    expect(textsOf(host, ".history-event")).toContain(
      "Revision 2 on 2026-10-09 at 12:00 UTC: no text changed.",
    );
  });

  it("renders a delegated entry with an option", () => {
    const host = drawHistory(
      decisionModel(
        decisionResponse({
          head: inboxHead({ state: "delegated" }),
          entries: [
            decisionEntry({
              state: "delegated",
              source: "session",
              option: "a",
            }),
          ],
        }),
      ),
    );
    expect(textsOf(host, ".history-event")).toContain(
      "owner decided under delegation: a",
    );
  });

  it("shows a delegated entry with words instead of option", () => {
    const host = drawHistory(
      decisionModel(
        decisionResponse({
          head: inboxHead({ revision: 1, revisions: 1, entries: 1 }),
          entries: [
            decisionEntry({
              state: "delegated",
              source: "session",
              words: "do this",
            }),
          ],
        }),
      ),
    );
    expect(textsOf(host, ".history-event")).toContain(
      "owner decided under delegation: do this",
    );
  });

  it("does not mark a session answer as reported, not signed", () => {
    const host = drawHistory(
      decisionModel(
        decisionResponse({
          head: inboxHead({ revision: 1, revisions: 1, entries: 1 }),
          entries: [
            decisionEntry({
              state: "approved",
              source: "session",
              words: "yes",
            }),
          ],
        }),
      ),
    );
    const lines = textsOf(host, ".history-event");
    const reportedLine = lines.find((l) =>
      l.includes("recorded that you approved"),
    );
    expect(reportedLine).toBeDefined();
    expect(reportedLine).not.toContain("reported, not signed");
  });

  it("marks a reported answer as reported, not signed", () => {
    const host = drawHistory(
      decisionModel(
        decisionResponse({
          head: inboxHead({ revision: 1, revisions: 1, entries: 1 }),
          entries: [
            decisionEntry({
              state: "declined",
              source: "reported",
              words: "no",
            }),
          ],
        }),
      ),
    );
    expect(textsOf(host, ".history-event")).toContain(
      'owner recorded that you declined on 2026-04-01 at 12:00 UTC: "no" reported, not signed',
    );
  });

  it("renders an answer entry without words as the verb alone", () => {
    const host = drawHistory(
      decisionModel(
        decisionResponse({
          head: inboxHead({ revision: 1, revisions: 1, entries: 1 }),
          entries: [
            { ...decisionEntry(), words: undefined, option: undefined },
          ],
        }),
      ),
    );
    expect(textsOf(host, ".history-event")).toContain(
      "owner recorded that you approved on 2026-04-01 at 12:00 UTC reported, not signed",
    );
  });
});

describe("earlierTextsBlock", () => {
  it("shows one details per earlier revision", () => {
    const OTHER_HASH = "b".repeat(64);
    const host = drawEarlier(
      decisionModel(
        decisionResponse({
          head: inboxHead({ revision: 3, revisions: 3, entries: 0 }),
          revisions: [
            storedRevision({
              revision: 1,
              decision: decisionRevision({ question: "Old Q?" }),
              receivedAt: "2026-10-08T12:00:00Z",
            }),
            storedRevision({
              revision: 2,
              textSha256: OTHER_HASH,
              decision: decisionRevision({ question: "Mid Q?" }),
              receivedAt: "2026-10-09T12:00:00Z",
            }),
            storedRevision({
              revision: 3,
              textSha256: "c".repeat(64),
              decision: decisionRevision({ question: "New Q?" }),
              receivedAt: "2026-10-10T12:00:00Z",
            }),
          ],
        }),
      ),
    );
    expect(host.querySelectorAll("details.earlier-text")).toHaveLength(2);
    expect(textsOf(host, "details.earlier-text summary")).toStrictEqual([
      "Revision 1, as it read",
      "Revision 2, as it read",
    ]);
    expect(textsOf(host, ".earlier-question")).toStrictEqual([
      "Old Q?",
      "Mid Q?",
    ]);
  });

  it("shows the door band, recommendation and commits in an earlier text", () => {
    const OTHER_HASH = "b".repeat(64);
    const host = drawEarlier(
      decisionModel(
        decisionResponse({
          head: inboxHead({ revision: 2, revisions: 2, entries: 0 }),
          revisions: [
            storedRevision({
              revision: 1,
              decision: decisionRevision({
                question: "Old?",
                options: [
                  { key: "a", text: "Yes", cost: "C1" },
                  { key: "b", text: "No", cost: "C2" },
                ],
                recommended: { option: "a", reason: "best" },
                hardToUndo: { value: true, reason: "gone" },
                commits: ["do this", "do that"],
              }),
              receivedAt: "2026-10-08T12:00:00Z",
            }),
            storedRevision({
              revision: 2,
              textSha256: OTHER_HASH,
              decision: decisionRevision({
                question: "New?",
                changeNote: "narrowed",
              }),
              receivedAt: "2026-10-09T12:00:00Z",
            }),
          ],
        }),
      ),
    );
    expect(textsOf(host, ".earlier-recommended")).toStrictEqual([
      "Recommended: a — best",
    ]);
    expect(textsOf(host, ".earlier-commits li")).toStrictEqual([
      "do this",
      "do that",
    ]);
    expect(textsOf(host, ".door-band")).toContain("ONE-WAY DOOR: gone");
  });

  it("shows the shape, decider and appliesTo in an earlier text", () => {
    const OTHER_HASH = "b".repeat(64);
    const host = drawEarlier(
      decisionModel(
        decisionResponse({
          head: inboxHead({ revision: 2, revisions: 2, entries: 0 }),
          revisions: [
            storedRevision({
              revision: 1,
              decision: decisionRevision({
                shape: "instruction",
                question: "Old?",
                options: [],
                appliesTo: ["beta", "gamma"],
              }),
              receivedAt: "2026-10-08T12:00:00Z",
            }),
            storedRevision({
              revision: 2,
              textSha256: OTHER_HASH,
              decision: decisionRevision({
                question: "New?",
                changeNote: "narrowed",
              }),
              receivedAt: "2026-10-09T12:00:00Z",
            }),
          ],
        }),
      ),
    );
    expect(textsOf(host, ".earlier-facts")).toStrictEqual([
      "standing instruction · yours to decide",
    ]);
    expect(textsOf(host, ".earlier-applies-to")).toStrictEqual([
      "Applies to: beta, gamma",
    ]);
  });

  it("shows an earlier action's act-elsewhere line", () => {
    const host = drawEarlier(
      decisionModel(
        decisionResponse({
          head: inboxHead({ revision: 2, revisions: 2, entries: 0 }),
          revisions: [
            storedRevision({
              revision: 1,
              decision: decisionRevision({
                shape: "action",
                question: "Old?",
                options: [],
                actElsewhere: { where: "your terminal", what: "run it" },
              }),
              receivedAt: "2026-10-08T12:00:00Z",
            }),
            storedRevision({
              revision: 2,
              textSha256: "b".repeat(64),
              decision: decisionRevision({ question: "New?" }),
              receivedAt: "2026-10-09T12:00:00Z",
            }),
          ],
        }),
      ),
    );
    expect(textsOf(host, ".earlier-text .card-elsewhere")).toStrictEqual([
      "Cannot be answered here. Act in: your terminal: run it.",
    ]);
  });

  it("returns undefined when there is only one revision", () => {
    const host = drawEarlier(decisionModel(decisionResponse()));
    expect(host.querySelector(".decision-earlier-texts")).toBeNull();
  });

  it("shows an earlier text with no options as a choice without options", () => {
    const host = drawEarlier(
      decisionModel(
        decisionResponse({
          revisions: [
            storedRevision({
              revision: 1,
              decision: decisionRevision({
                question: "Old?",
                options: [],
                hardToUndo: { value: false },
              }),
              receivedAt: "2026-10-08T12:00:00Z",
            }),
            storedRevision({
              revision: 2,
              decision: decisionRevision({
                question: "New?",
                changeNote: "changed",
              }),
              receivedAt: "2026-10-09T12:00:00Z",
            }),
          ],
          head: inboxHead({ revision: 2, revisions: 2 }),
        }),
      ),
    );
    expect(textsOf(host, ".earlier-question")).toStrictEqual(["Old?"]);
  });
});
