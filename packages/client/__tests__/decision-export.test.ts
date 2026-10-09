import { describe, expect, it } from "vitest";

import {
  readHeads,
  readRecord,
  isReportedAnswer,
  matchesSince,
  escapeCell,
  formatRow,
  buildMarkdown,
  type HeadInfo,
  type EntryInfo,
} from "../src/domain/decision-export.js";

describe("readHeads", () => {
  it("reads the heads of a decisions list", () => {
    const bodies = JSON.stringify({
      project: "waves-demo",
      counts: { approved: 1 },
      decisions: [
        {
          id: "d1",
          question: "What should we do?",
          state: "approved",
          source: "reported",
          at: "2026-10-08T10:00:00Z",
          revision: 1,
          textSha256: "a".repeat(64),
          entries: 1,
        },
      ],
    });
    const heads = readHeads(bodies);
    expect(heads).toHaveLength(1);
    expect(heads?.[0]?.id).toBe("d1");
  });

  it("skips heads with the wrong field types", () => {
    const bodies = JSON.stringify({
      decisions: [
        { id: "d1", question: "q", state: 7, revision: 1, textSha256: "a" },
        {
          id: "d2",
          question: "q",
          state: "approved",
          revision: 1,
          textSha256: "a",
        },
      ],
    });
    const heads = readHeads(bodies);
    expect(heads).toHaveLength(1);
    expect(heads?.[0]?.id).toBe("d2");
  });

  it("returns undefined for a body that is not the list", () => {
    expect(readHeads("not json")).toBeUndefined();
    expect(readHeads("{}")).toBeUndefined();
    expect(readHeads("[1,2]")).toBeUndefined();
    expect(readHeads('{"decisions":"x"}')).toBeUndefined();
  });

  it("refuses a list whose head has an id that is not a lane id", () => {
    const body = JSON.stringify({
      decisions: [
        {
          id: "..",
          question: "q",
          state: "approved",
          source: "reported",
          at: "2026-10-08T10:00:00Z",
          revision: 1,
          textSha256: "a".repeat(64),
        },
      ],
    });
    expect(readHeads(body)).toBeUndefined();
  });

  it("skips heads that belong to another project via a from key", () => {
    const bodies = JSON.stringify({
      decisions: [
        {
          id: "d1",
          from: "waves-other",
          question: "q",
          state: "approved",
          source: "reported",
          revision: 1,
          textSha256: "a".repeat(64),
        },
        {
          id: "d2",
          question: "q",
          state: "approved",
          source: "reported",
          revision: 1,
          textSha256: "b".repeat(64),
        },
      ],
    });
    const heads = readHeads(bodies);
    expect(heads).toHaveLength(1);
    expect(heads?.[0]?.id).toBe("d2");
  });
});

describe("readRecord", () => {
  it("reads the current entry, the one matching the head's hash", () => {
    const body = JSON.stringify({
      head: {
        id: "d1",
        question: "q",
        state: "approved",
        source: "reported",
        at: "2026-10-08T10:00:00Z",
        revision: 1,
        textSha256: "sha-current",
      },
      entries: [
        {
          state: "approved",
          source: "reported",
          at: "2026-10-08T10:00:00Z",
          receivedAt: "2026-10-08T10:00:01Z",
          words: "yes",
          option: "a",
          textSha256: "sha-current",
        },
        {
          state: "open",
          source: undefined,
          textSha256: "sha-old",
        },
      ],
    });
    const record = readRecord(body);
    expect(record?.head.id).toBe("d1");
    expect(record?.entry?.option).toBe("a");
    expect(record?.entry?.words).toBe("yes");
    expect(record?.entry?.receivedAt).toBe("2026-10-08T10:00:01Z");
  });

  it("returns undefined when the body is not a decision", () => {
    expect(readRecord("not json")).toBeUndefined();
    expect(readRecord("{}")).toBeUndefined();
    expect(readRecord('{"head":"x"}')).toBeUndefined();
  });

  it("returns no current entry when entries is not an array", () => {
    const body = JSON.stringify({
      head: {
        id: "d1",
        question: "q",
        state: "approved",
        source: "reported",
        at: "2026-10-08T00:00:00Z",
        revision: 1,
        textSha256: "current",
      },
      entries: "not an array",
    });
    const record = readRecord(body);
    expect(record?.head.id).toBe("d1");
    expect(record?.entry).toBeUndefined();
  });

  it("ignores a words field that is not a string", () => {
    const body = JSON.stringify({
      head: {
        id: "d1",
        question: "q",
        state: "approved",
        source: "reported",
        at: "2026-10-08T00:00:00Z",
        revision: 1,
        textSha256: "sha",
      },
      entries: [
        {
          state: "approved",
          source: "reported",
          textSha256: "sha",
          words: 7,
          option: "a",
        },
      ],
    });
    const record = readRecord(body);
    expect(record?.entry?.words).toBeUndefined();
  });

  it("returns no current entry when none match the hash", () => {
    const body = JSON.stringify({
      head: {
        id: "d1",
        question: "q",
        state: "approved",
        source: "reported",
        at: "2026-10-08T00:00:00Z",
        revision: 1,
        textSha256: "current",
      },
      entries: [
        {
          state: "approved",
          source: "reported",
          textSha256: "old",
        },
        "not an entry",
      ],
    });
    const record = readRecord(body);
    expect(record?.entry).toBeUndefined();
  });
});

describe("isReportedAnswer", () => {
  const head = (overrides: Partial<HeadInfo> = {}): HeadInfo => ({
    id: "x",
    question: "q",
    state: "approved",
    source: "reported",
    at: undefined,
    revision: 1,
    textSha256: "x",
    ...overrides,
  });

  it("accepts an answer with the right state and source", () => {
    expect(isReportedAnswer(head())).toBe(true);
  });

  it("refuses a state that is not an answer", () => {
    expect(isReportedAnswer(head({ state: "open" }))).toBe(false);
  });

  it("refuses a source that is not reported", () => {
    expect(isReportedAnswer(head({ source: "session" }))).toBe(false);
  });
});

describe("matchesSince", () => {
  it("lets everything through when --since is absent", () => {
    expect(matchesSince("2026-10-01T00:00:00Z", null)).toBe(true);
    expect(matchesSince(undefined, null)).toBe(true);
  });

  it("keeps entries on or after the date, and drops earlier ones", () => {
    expect(matchesSince("2026-10-08T10:00:00Z", "2026-10-07")).toBe(true);
    expect(matchesSince("2026-10-06T23:59:59Z", "2026-10-07")).toBe(false);
  });

  it("drops an entry with no time when --since was given", () => {
    expect(matchesSince(undefined, "2026-10-07")).toBe(false);
  });
});

describe("escapeCell", () => {
  it("escapes backslash, pipes and line endings so the table stays one row", () => {
    expect(escapeCell("a\\b")).toBe("a\\\\b");
    expect(escapeCell("a|b")).toBe("a\\|b");
    expect(escapeCell("a\nb")).toBe("a b");
    expect(escapeCell("a\r\nb")).toBe("a b");
    expect(escapeCell("a\rb")).toBe("a b");
    expect(escapeCell("a\\|b\nc")).toBe("a\\\\\\|b c");
  });
});

describe("formatRow", () => {
  const head: HeadInfo = {
    id: "d1",
    question: "What should we do?",
    state: "approved",
    source: "reported",
    at: "2026-10-08T10:00:00Z",
    revision: 1,
    textSha256: "abc",
  };

  it("includes the option when there is one", () => {
    const entry: EntryInfo = {
      option: "b",
      words: "go with B",
      receivedAt: "2026-10-08T10:00:01Z",
    };
    expect(formatRow(head, entry)).toBe(
      "reported, not signed | d1 | What should we do? | approved (b) | go with B | 2026-10-08T10:00:01Z | revision 1, textSha256 abc",
    );
  });

  it("omits the option and words when there are none", () => {
    const entry: EntryInfo = {
      option: undefined,
      words: undefined,
      receivedAt: undefined,
    };
    expect(formatRow(head, entry)).toBe(
      "reported, not signed | d1 | What should we do? | approved |  |  | revision 1, textSha256 abc",
    );
  });

  it("uses the entry's receivedAt for the time cell", () => {
    const noAtHead: HeadInfo = { ...head, at: undefined };
    const entry: EntryInfo = {
      option: undefined,
      words: "yes",
      receivedAt: "2026-10-08T12:00:00Z",
    };
    expect(formatRow(noAtHead, entry)).toContain("2026-10-08T12:00:00Z");
  });

  it("uses an empty time cell when the entry has no receivedAt", () => {
    const noAtHead: HeadInfo = { ...head, at: undefined };
    expect(formatRow(noAtHead, undefined)).toContain(
      "|  | revision 1, textSha256 abc",
    );
  });
});

describe("buildMarkdown", () => {
  it("prints a heading, a header row, a separator and one row per decision", () => {
    const head: HeadInfo = {
      id: "d1",
      question: "What should we do?",
      state: "approved",
      source: "reported",
      at: "2026-10-08T10:00:00Z",
      revision: 1,
      textSha256: "abc",
    };
    const entry: EntryInfo = {
      option: "b",
      words: "go with B",
      receivedAt: "2026-10-08T10:00:01Z",
    };
    const output = buildMarkdown([{ head, entry }]);

    expect(output).toContain("## Reported answers (reported, not signed)");
    expect(output).toContain("| reported, not signed |");
    expect(output).toContain("| --- | --- | --- | --- | --- | --- | --- |");
    expect(output).toContain(
      "| reported, not signed | d1 | What should we do? | approved (b) | go with B",
    );
  });

  it("prints the heading and None. when there are no rows", () => {
    expect(buildMarkdown([])).toBe(
      "## Reported answers (reported, not signed)\n\nNone.",
    );
  });
});
