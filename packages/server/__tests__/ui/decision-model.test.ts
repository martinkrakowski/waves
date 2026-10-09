import { describe, expect, it } from "vitest";

import {
  changesBetween,
  decisionModel,
} from "../../public/views/decision-model.js";

import {
  decisionEntry,
  decisionRevision,
  decisionResponse,
  HASH,
  inboxHead,
  storedRevision,
} from "./fixtures.js";

describe("changesBetween", () => {
  it("reports nothing when the two revisions are identical", () => {
    expect(
      changesBetween(decisionRevision(), decisionRevision()),
    ).toStrictEqual([]);
  });

  it("reports the one field that differs", () => {
    expect(
      changesBetween(
        decisionRevision(),
        decisionRevision({ question: "Different?" }),
      ),
    ).toStrictEqual(["question"]);
  });

  it("reports several fields that differ, in the page's order", () => {
    expect(
      changesBetween(
        decisionRevision({ question: "A?", commits: ["x"] }),
        decisionRevision({ question: "B?", commits: ["y", "z"] }),
      ),
    ).toStrictEqual(["question", "commitments"]);
  });

  it("reports a recommendation that was added", () => {
    expect(
      changesBetween(
        decisionRevision(),
        decisionRevision({ recommended: { option: "a", reason: "best" } }),
      ),
    ).toStrictEqual(["recommendation"]);
  });

  it("reports a recommendation that was removed", () => {
    expect(
      changesBetween(
        decisionRevision({ recommended: { option: "a", reason: "best" } }),
        decisionRevision(),
      ),
    ).toStrictEqual(["recommendation"]);
  });

  it("reports a door that changed value", () => {
    expect(
      changesBetween(
        decisionRevision({ hardToUndo: { value: false } }),
        decisionRevision({ hardToUndo: { value: true, reason: "gone" } }),
      ),
    ).toStrictEqual(["door"]);
  });

  it("reports a shape change as a changed field", () => {
    expect(
      changesBetween(
        decisionRevision({ shape: "choice" }),
        decisionRevision({ shape: "action" }),
      ),
    ).toStrictEqual(["shape"]);
  });

  it("reports act-elsewhere that was added and applies-to that changed", () => {
    expect(
      changesBetween(
        decisionRevision(),
        decisionRevision({
          actElsewhere: { where: "terminal", what: "run" },
          appliesTo: ["beta"],
        }),
      ),
    ).toStrictEqual(["applies-to", "act-elsewhere"]);
  });
});

describe("decisionModel", () => {
  it("gives the last revision as the current one", () => {
    const model = decisionModel(
      decisionResponse({
        head: inboxHead({ revision: 2, revisions: 2 }),
        revisions: [
          storedRevision({ revision: 1 }),
          storedRevision({
            revision: 2,
            receivedAt: "2026-10-09T12:00:00Z",
          }),
        ],
      }),
    );
    expect(model.currentRevision.revision).toBe(2);
  });

  it("splits entries by the current text run", () => {
    const OTHER_HASH = "b".repeat(64);
    const model = decisionModel(
      decisionResponse({
        head: inboxHead({ revision: 2, revisions: 2, entries: 2 }),
        revisions: [
          storedRevision({ revision: 1 }),
          storedRevision({
            revision: 2,
            textSha256: OTHER_HASH,
            receivedAt: "2026-10-09T12:00:00Z",
          }),
        ],
        entries: [
          decisionEntry({ index: 0, revision: 1, textSha256: HASH }),
          decisionEntry({ index: 1, revision: 2, textSha256: OTHER_HASH }),
        ],
      }),
    );
    expect(model.currentEntries).toHaveLength(1);
    expect(model.currentEntries[0]?.revision).toBe(2);
    expect(model.earlierEntries).toHaveLength(1);
    expect(model.earlierEntries[0]?.revision).toBe(1);
  });

  it("puts entries on revisions that share the hash in the current text", () => {
    const model = decisionModel(
      decisionResponse({
        head: inboxHead({ revision: 2, revisions: 2, entries: 2 }),
        revisions: [
          storedRevision({ revision: 1 }),
          storedRevision({ revision: 2, receivedAt: "2026-10-09T12:00:00Z" }),
        ],
        entries: [
          decisionEntry({ index: 0, revision: 1 }),
          decisionEntry({ index: 1, revision: 2 }),
        ],
      }),
    );
    expect(model.currentEntries).toHaveLength(2);
    expect(model.earlierEntries).toHaveLength(0);
  });

  it("gives each earlier revision its changes and change note", () => {
    const model = decisionModel(
      decisionResponse({
        head: inboxHead({ revision: 2, revisions: 2 }),
        revisions: [
          storedRevision({
            revision: 1,
            decision: decisionRevision({
              question: "Old question?",
              changeNote: "narrowed after the session reported a window",
            }),
          }),
          storedRevision({
            revision: 2,
            decision: decisionRevision({ question: "New question?" }),
            receivedAt: "2026-10-09T12:00:00Z",
          }),
        ],
      }),
    );
    expect(model.revisionChanges).toHaveLength(1);
    expect(model.revisionChanges[0]?.revision).toBe(1);
    expect(model.revisionChanges[0]?.changed).toStrictEqual(["question"]);
    expect(model.revisionChanges[0]?.changeNote).toBe(
      "narrowed after the session reported a window",
    );
  });

  it("has no revision changes for a single revision", () => {
    const model = decisionModel(decisionResponse());
    expect(model.revisionChanges).toHaveLength(0);
  });

  it("reports no changes for revisions that share the same text", () => {
    const model = decisionModel(
      decisionResponse({
        head: inboxHead({ revision: 2, revisions: 2, entries: 0 }),
        revisions: [
          storedRevision({ revision: 1, receivedAt: "2026-10-08T12:00:00Z" }),
          storedRevision({ revision: 2, receivedAt: "2026-10-09T12:00:00Z" }),
        ],
      }),
    );
    expect(model.revisionChanges[0]?.changed).toStrictEqual([]);
  });

  it("names each earlier revision in order", () => {
    const model = decisionModel(
      decisionResponse({
        head: inboxHead({ revision: 3, revisions: 3, entries: 0 }),
        revisions: [
          storedRevision({ revision: 1 }),
          storedRevision({ revision: 2, receivedAt: "2026-10-09T12:00:00Z" }),
          storedRevision({ revision: 3, receivedAt: "2026-10-10T12:00:00Z" }),
        ],
      }),
    );
    expect(model.revisionChanges).toHaveLength(2);
    expect(model.revisionChanges.map((c) => c.revision)).toStrictEqual([1, 2]);
  });
});
