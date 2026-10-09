import { describe, expect, it } from "vitest";

import {
  aliveView,
  calendarDate,
  clockTime,
  detailValue,
  diffText,
  gateText,
  laneCountText,
  pullRequestText,
  relativeTime,
  reportedText,
  threadsText,
  waveCountText,
} from "../../public/format.js";

import { NOW_MS } from "./fixtures.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function ago(milliseconds: number): string {
  return new Date(NOW_MS - milliseconds).toISOString();
}

describe("relativeTime", () => {
  it("reads a missing or unparsable stamp as unknown", () => {
    expect(relativeTime(undefined, NOW_MS)).toBe("unknown");
    expect(relativeTime("not a date", NOW_MS)).toBe("unknown");
  });

  it("counts up from just now to days", () => {
    expect(relativeTime(ago(0), NOW_MS)).toBe("just now");
    expect(relativeTime(ago(4_999), NOW_MS)).toBe("just now");
    expect(relativeTime(ago(42_000), NOW_MS)).toBe("42s ago");
    expect(relativeTime(ago(5 * MINUTE), NOW_MS)).toBe("5m ago");
    expect(relativeTime(ago(3 * HOUR), NOW_MS)).toBe("3h ago");
    expect(relativeTime(ago(2 * DAY), NOW_MS)).toBe("2d ago");
  });
});

describe("aliveView", () => {
  it("names the three liveness views", () => {
    expect(aliveView(true)).toStrictEqual({
      label: "running",
      className: "running",
    });
    expect(aliveView(false)).toStrictEqual({
      label: "stopped",
      className: "stopped",
    });
    expect(aliveView("unknown")).toStrictEqual({
      label: "unknown",
      className: "unknown",
    });
  });
});

describe("gateText", () => {
  it("says when the lane reported no gate", () => {
    expect(gateText(undefined)).toBe("no gate reported");
  });

  it("reports the exit code on its own", () => {
    expect(gateText({})).toBe("exit not reported");
    expect(gateText({ exit: 2 })).toBe("exit 2");
  });

  it("adds the four coverage numbers, whole or not", () => {
    expect(
      gateText({
        exit: 0,
        coverage: {
          statements: 98,
          branches: 91.5,
          functions: 100,
          lines: 99,
        },
      }),
    ).toBe("exit 0 · 98% stmts · 91.5% br · 100% funcs · 99% lines");
  });
});

describe("diffText", () => {
  it("reports the three counts, or their absence", () => {
    expect(diffText(undefined)).toBe("no diff reported");
    expect(diffText({ files: 3, insertions: 120, deletions: 14 })).toBe(
      "3 files · +120 −14",
    );
  });
});

describe("threadsText", () => {
  it("handles every shape the contract allows", () => {
    expect(threadsText(undefined)).toBe("threads not reported");
    expect(threadsText("unknown")).toBe("threads unknown");
    expect(threadsText(0)).toBe("no open threads");
    expect(threadsText(1)).toBe("1 open thread");
    expect(threadsText(4)).toBe("4 open threads");
  });
});

describe("pullRequestText", () => {
  it("reads the number, the state, the checks and the threads", () => {
    expect(pullRequestText(undefined)).toBe("no pull request reported");
    expect(
      pullRequestText({
        number: 42,
        state: "open",
        checks: "pass",
        unresolvedThreads: 1,
      }),
    ).toBe("#42 open · checks pass · 1 open thread");
  });
});

describe("reportedText", () => {
  it("says when a lane reported nothing", () => {
    expect(reportedText(undefined)).toBe("nothing reported");
  });

  it("leaves out the round and the pull request when absent", () => {
    expect(
      reportedText({
        stage: "review",
        event: "started",
        ts: "2026-04-01T12:00:00.000Z",
      }),
    ).toBe("review · started");
  });

  it("adds the round and the pull request when present", () => {
    expect(
      reportedText({
        stage: "review",
        event: "settled",
        ts: "2026-04-01T12:00:00.000Z",
        pr: 42,
        round: 2,
      }),
    ).toBe("review · settled · round 2 · PR #42");
  });
});

describe("detailValue", () => {
  it("keeps a string as it is and serialises anything else", () => {
    expect(detailValue("ship it")).toBe("ship it");
    expect(detailValue(3)).toBe("3");
    expect(detailValue({ a: 1 })).toBe('{"a":1}');
    expect(detailValue(undefined)).toBeUndefined();
  });
});

describe("counts", () => {
  it("agree with themselves about one", () => {
    expect(laneCountText(1)).toBe("1 lane");
    expect(laneCountText(2)).toBe("2 lanes");
    expect(waveCountText(1)).toBe("1 wave");
    expect(waveCountText(2)).toBe("2 waves");
  });
});

describe("clockTime", () => {
  it("reads the reader's own wall clock, every field two digits", () => {
    // Local on purpose: the pill says when this page loaded, and the reader is
    // the one who has to recognise the time as theirs. Built from local parts so
    // the expectation holds in whatever zone the test runs in.
    expect(clockTime(new Date(2026, 3, 1, 9, 5, 7).getTime())).toBe("09:05:07");
    expect(clockTime(new Date(2026, 3, 1, 0, 0, 0).getTime())).toBe("00:00:00");
    expect(clockTime(new Date(2026, 3, 1, 23, 59, 59).getTime())).toBe(
      "23:59:59",
    );
  });

  it("pads every field that would otherwise be one digit", () => {
    expect(clockTime(new Date(2026, 11, 31, 8, 9, 4).getTime())).toBe(
      "08:09:04",
    );
  });
});

describe("calendarDate", () => {
  it("reads an ISO timestamp as a UTC date and time", () => {
    expect(calendarDate("2026-10-08T13:00:00Z")).toBe(
      "2026-10-08 at 13:00 UTC",
    );
    expect(calendarDate("2026-01-05T08:09:00Z")).toBe(
      "2026-01-05 at 08:09 UTC",
    );
  });

  it("drops seconds and pads every field to two digits", () => {
    expect(calendarDate("2026-10-08T13:00:45Z")).toBe(
      "2026-10-08 at 13:00 UTC",
    );
    expect(calendarDate("0001-01-01T00:00:00Z")).toBe(
      "0001-01-01 at 00:00 UTC",
    );
  });

  it("reads an unparsable timestamp as unknown", () => {
    expect(calendarDate("not a date")).toBe("unknown");
    expect(calendarDate("2026-13-45T99:99:99Z")).toBe("unknown");
  });
});
