import { describe, expect, it } from "vitest";

import {
  coveredAnswer,
  currentEntry,
  decisionState,
  earlierAnswer,
  groupOf,
  isAnswer,
  REPORTED_WINDOW_MS,
} from "../src/domain/decision-state.js";
import type { StoredEntry } from "../src/application/ports/notice-store.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function entry(overrides: Partial<StoredEntry> = {}): StoredEntry {
  return {
    index: 0,
    receivedAt: "2026-10-15T00:00:00.000Z",
    state: "approved",
    source: "reported",
    revision: 1,
    textSha256: HASH_A,
    by: "owner",
    at: "2026-10-15T00:00:00Z",
    words: "yes",
    ...overrides,
  };
}

const NOW = Date.parse("2026-10-15T00:00:00.000Z");

function rev(): {
  revision: 1;
  textSha256: string;
  receivedAt: string;
  decision: never;
} {
  return {
    revision: 1,
    textSha256: HASH_A,
    receivedAt: "2026-10-15T00:00:00.000Z",
    decision: undefined as unknown as never,
  };
}

function fresh(days: number): string {
  return new Date(NOW - days * 86_400_000).toISOString();
}

describe("isAnswer", () => {
  it.each(["approved", "declined", "answered"] as const)(
    "is true for %s",
    (state) => {
      expect(isAnswer(state as never)).toBe(true);
    },
  );
  it.each(["open", "delegated", "withdrawn", "superseded"] as const)(
    "is false for %s",
    (state) => {
      expect(isAnswer(state as never)).toBe(false);
    },
  );
});

describe("currentEntry", () => {
  it("is the last entry on the current revision's text", () => {
    const decision = {
      project: "p",
      id: "d",
      revisions: [rev()],
      entries: [
        entry({ index: 0 }),
        entry({ index: 1, receivedAt: "2026-10-10T00:00:00.000Z" }),
      ],
    };
    expect(currentEntry(decision)?.index).toBe(1);
  });

  it("is undefined when no entry is on the current text", () => {
    const decision = {
      project: "p",
      id: "d",
      revisions: [rev()],
      entries: [entry({ textSha256: HASH_B })],
    };
    expect(currentEntry(decision)).toBeUndefined();
  });

  it("is undefined when the decision has no revisions", () => {
    expect(
      currentEntry({ project: "p", id: "d", revisions: [], entries: [] }),
    ).toBeUndefined();
  });
});

describe("decisionState", () => {
  it("is the current entry's state", () => {
    const d = {
      project: "p",
      id: "d",
      revisions: [rev()],
      entries: [entry({ state: "delegated" })],
    };
    expect(decisionState(d)).toBe("delegated");
  });

  it("is open when there is no current entry", () => {
    const d = { project: "p", id: "d", revisions: [rev()], entries: [] };
    expect(decisionState(d)).toBe("open");
  });
});

describe("earlierAnswer", () => {
  it("is the last answer on a text that is not the current one", () => {
    const d = {
      project: "p",
      id: "d",
      revisions: [rev()],
      entries: [
        entry({ index: 0, textSha256: HASH_B, state: "approved" }),
        entry({ index: 1, textSha256: HASH_B, state: "declined" }),
      ],
    };
    expect(earlierAnswer(d)?.state).toBe("declined");
  });

  it("is undefined when the only answers are on the current text", () => {
    const d = {
      project: "p",
      id: "d",
      revisions: [rev()],
      entries: [entry({ textSha256: HASH_A })],
    };
    expect(earlierAnswer(d)).toBeUndefined();
  });
});

describe("groupOf", () => {
  it("is waiting for open and delegated", () => {
    expect(
      groupOf({ project: "p", id: "d", revisions: [rev()], entries: [] }, NOW),
    ).toBe("waiting");
    expect(
      groupOf(
        {
          project: "p",
          id: "d",
          revisions: [rev()],
          entries: [entry({ state: "delegated", receivedAt: fresh(1) })],
        },
        NOW,
      ),
    ).toBe("waiting");
  });

  it("is reported for a fresh answer", () => {
    const d = {
      project: "p",
      id: "d",
      revisions: [rev()],
      entries: [entry({ state: "approved", receivedAt: fresh(1) })],
    };
    expect(groupOf(d, NOW)).toBe("reported");
  });

  it("is closed for a fresh withdrawal or supersession", () => {
    for (const state of ["withdrawn", "superseded"] as const) {
      const d = {
        project: "p",
        id: "d",
        revisions: [rev()],
        entries: [entry({ state, receivedAt: fresh(1), reason: "gone" })],
      };
      expect(groupOf(d, NOW)).toBe("closed");
    }
  });

  it("is history for an answer or session-close past the window, on both edges", () => {
    const justInside = fresh(14);
    const justOutside = new Date(NOW - REPORTED_WINDOW_MS - 1).toISOString();

    const approved = (at: string) => ({
      project: "p",
      id: "d",
      revisions: [rev()],
      entries: [entry({ state: "approved", receivedAt: at })],
    });
    const withdrawn = (at: string) => ({
      project: "p",
      id: "d",
      revisions: [rev()],
      entries: [entry({ state: "withdrawn", receivedAt: at, reason: "r" })],
    });

    expect(groupOf(approved(justInside), NOW)).toBe("reported");
    expect(groupOf(approved(justOutside), NOW)).toBe("history");
    expect(groupOf(withdrawn(justInside), NOW)).toBe("closed");
    expect(groupOf(withdrawn(justOutside), NOW)).toBe("history");
  });
});

describe("coveredAnswer", () => {
  it("is undefined when the current entry is not a withdrawal or supersession", () => {
    const d = {
      project: "p",
      id: "d",
      revisions: [rev()],
      entries: [entry({ textSha256: HASH_A })],
    };
    expect(coveredAnswer(d)).toBeUndefined();
  });

  it("is undefined when there is no answer on the same text before it", () => {
    const d = {
      project: "p",
      id: "d",
      revisions: [rev()],
      entries: [
        entry({
          index: 0,
          textSha256: HASH_A,
          state: "withdrawn",
          reason: "gone",
        }),
      ],
    };
    expect(coveredAnswer(d)).toBeUndefined();
  });

  it("is the last answer on the same text before a withdrawal", () => {
    const d = {
      project: "p",
      id: "d",
      revisions: [rev()],
      entries: [
        entry({ index: 0, textSha256: HASH_A, state: "approved", words: "y" }),
        entry({
          index: 1,
          textSha256: HASH_A,
          state: "answered",
          words: "more",
        }),
        entry({
          index: 2,
          textSha256: HASH_A,
          state: "withdrawn",
          source: "session",
          reason: "gone",
        }),
      ],
    };
    expect(coveredAnswer(d)?.state).toBe("answered");
  });

  it("is undefined when there is no current entry", () => {
    expect(
      coveredAnswer({ project: "p", id: "d", revisions: [], entries: [] }),
    ).toBeUndefined();
  });
});
