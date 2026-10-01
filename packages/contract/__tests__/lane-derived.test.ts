import { describe, expect, it } from "vitest";

import {
  BELL,
  DEL,
  expectEnvelopePaths,
  expectValidEnvelope,
  oneLane,
} from "./support.js";

function derivedOf(derived: Record<string, unknown>): Record<string, unknown> {
  return oneLane({ derived: { alive: true, ...derived } });
}

function derivedValue(derived: Record<string, unknown>): unknown {
  return expectValidEnvelope(derivedOf(derived)).lanes[0]?.derived;
}

describe("validateEnvelope derived alive", () => {
  it("accepts true and false", () => {
    expect(derivedValue({ alive: true })).toEqual({ alive: true });
    expect(derivedValue({ alive: false })).toEqual({ alive: false });
  });

  it("requires a boolean", () => {
    expectEnvelopePaths(derivedOf({ alive: undefined }), [
      "/lanes/0/derived/alive",
    ]);
    expectEnvelopePaths(derivedOf({ alive: "yes" }), [
      "/lanes/0/derived/alive",
    ]);
  });
});

describe("validateEnvelope derived exit", () => {
  it("accepts any integer", () => {
    expect(derivedValue({ exit: 0 })).toEqual({ alive: true, exit: 0 });
    expect(derivedValue({ exit: -9 })).toEqual({ alive: true, exit: -9 });
  });

  it("accepts a derived block without an exit", () => {
    expect(derivedValue({})).toEqual({ alive: true });
  });

  it("rejects an exit that is not an integer", () => {
    expectEnvelopePaths(derivedOf({ exit: 0.5 }), ["/lanes/0/derived/exit"]);
    expectEnvelopePaths(derivedOf({ exit: "0" }), ["/lanes/0/derived/exit"]);
  });
});

describe("validateEnvelope derived gate", () => {
  it("accepts an exit and a full coverage block", () => {
    expect(
      derivedValue({
        gate: {
          exit: 1,
          coverage: {
            statements: 0,
            branches: 100,
            functions: 12.5,
            lines: 100,
          },
        },
      }),
    ).toEqual({
      alive: true,
      gate: {
        exit: 1,
        coverage: {
          statements: 0,
          branches: 100,
          functions: 12.5,
          lines: 100,
        },
      },
    });
  });

  it("accepts a gate without a coverage block", () => {
    expect(derivedValue({ gate: {} })).toEqual({ alive: true, gate: {} });
  });

  it("rejects a gate that is not an object", () => {
    expectEnvelopePaths(derivedOf({ gate: "green" }), [
      "/lanes/0/derived/gate",
    ]);
  });

  it("rejects an unknown gate key", () => {
    expectEnvelopePaths(derivedOf({ gate: { status: "green" } }), [
      "/lanes/0/derived/gate/status",
    ]);
  });

  it("rejects a gate exit that is not an integer", () => {
    expectEnvelopePaths(derivedOf({ gate: { exit: 1.5 } }), [
      "/lanes/0/derived/gate/exit",
    ]);
  });

  it("requires all four coverage numbers", () => {
    expectEnvelopePaths(
      derivedOf({
        gate: { coverage: { statements: 1, branches: 1, functions: 1 } },
      }),
      ["/lanes/0/derived/gate/coverage/lines"],
    );
    expectEnvelopePaths(
      derivedOf({
        gate: {
          coverage: { statements: "1", branches: 1, functions: 1, lines: 1 },
        },
      }),
      ["/lanes/0/derived/gate/coverage/statements"],
    );
  });

  it("rejects coverage outside 0 to 100", () => {
    for (const key of ["statements", "branches", "functions", "lines"]) {
      expectEnvelopePaths(
        derivedOf({
          gate: {
            coverage: {
              statements: 50,
              branches: 50,
              functions: 50,
              lines: 50,
              [key]: -1,
            },
          },
        }),
        [`/lanes/0/derived/gate/coverage/${key}`],
      );
      expectEnvelopePaths(
        derivedOf({
          gate: {
            coverage: {
              statements: 50,
              branches: 50,
              functions: 50,
              lines: 50,
              [key]: 101,
            },
          },
        }),
        [`/lanes/0/derived/gate/coverage/${key}`],
      );
    }
  });

  it("rejects a coverage block that is not an object", () => {
    expectEnvelopePaths(derivedOf({ gate: { coverage: 100 } }), [
      "/lanes/0/derived/gate/coverage",
    ]);
  });

  it("rejects an unknown coverage key", () => {
    expectEnvelopePaths(
      derivedOf({
        gate: {
          coverage: {
            statements: 1,
            branches: 1,
            functions: 1,
            lines: 1,
            branchesPct: 1,
          },
        },
      }),
      ["/lanes/0/derived/gate/coverage/branchesPct"],
    );
  });
});

describe("validateEnvelope derived pull request", () => {
  it("accepts each state and check status", () => {
    expect(
      derivedValue({
        pr: {
          number: 1,
          state: "merged",
          checks: "fail",
          unresolvedThreads: 0,
        },
      }),
    ).toEqual({
      alive: true,
      pr: { number: 1, state: "merged", checks: "fail", unresolvedThreads: 0 },
    });
    for (const state of ["open", "closed"]) {
      for (const checks of ["none", "pass", "unknown"]) {
        expect(derivedValue({ pr: { number: 7, state, checks } })).toEqual({
          alive: true,
          pr: { number: 7, state, checks },
        });
      }
    }
  });

  it("accepts an unresolved thread count or the unknown marker", () => {
    expect(
      derivedValue({
        pr: { number: 1, state: "open", checks: "none", unresolvedThreads: 3 },
      }),
    ).toEqual({
      alive: true,
      pr: { number: 1, state: "open", checks: "none", unresolvedThreads: 3 },
    });
    expect(
      derivedValue({
        pr: {
          number: 1,
          state: "open",
          checks: "none",
          unresolvedThreads: "unknown",
        },
      }),
    ).toEqual({
      alive: true,
      pr: {
        number: 1,
        state: "open",
        checks: "none",
        unresolvedThreads: "unknown",
      },
    });
  });

  it("rejects a pull request that is not an object", () => {
    expectEnvelopePaths(derivedOf({ pr: 7 }), ["/lanes/0/derived/pr"]);
  });

  it("rejects an unknown pull request key", () => {
    expectEnvelopePaths(
      derivedOf({
        pr: { number: 1, state: "open", checks: "none", draft: true },
      }),
      ["/lanes/0/derived/pr/draft"],
    );
  });

  it("rejects a number below one", () => {
    expectEnvelopePaths(
      derivedOf({ pr: { number: 0, state: "open", checks: "none" } }),
      ["/lanes/0/derived/pr/number"],
    );
  });

  it("rejects an unknown state", () => {
    expectEnvelopePaths(
      derivedOf({ pr: { number: 1, state: "draft", checks: "none" } }),
      ["/lanes/0/derived/pr/state"],
    );
  });

  it("rejects an unknown check status", () => {
    expectEnvelopePaths(
      derivedOf({ pr: { number: 1, state: "open", checks: "green" } }),
      ["/lanes/0/derived/pr/checks"],
    );
  });

  it("rejects a negative or non integer thread count", () => {
    expectEnvelopePaths(
      derivedOf({
        pr: { number: 1, state: "open", checks: "none", unresolvedThreads: -1 },
      }),
      ["/lanes/0/derived/pr/unresolvedThreads"],
    );
    expectEnvelopePaths(
      derivedOf({
        pr: {
          number: 1,
          state: "open",
          checks: "none",
          unresolvedThreads: 1.5,
        },
      }),
      ["/lanes/0/derived/pr/unresolvedThreads"],
    );
    expectEnvelopePaths(
      derivedOf({
        pr: {
          number: 1,
          state: "open",
          checks: "none",
          unresolvedThreads: "many",
        },
      }),
      ["/lanes/0/derived/pr/unresolvedThreads"],
    );
  });
});

describe("validateEnvelope derived diff", () => {
  it("accepts zero counts", () => {
    expect(
      derivedValue({ diff: { files: 0, insertions: 0, deletions: 0 } }),
    ).toEqual({ alive: true, diff: { files: 0, insertions: 0, deletions: 0 } });
  });

  it("rejects a diff that is not an object", () => {
    expectEnvelopePaths(derivedOf({ diff: 3 }), ["/lanes/0/derived/diff"]);
  });

  it("rejects an unknown diff key", () => {
    expectEnvelopePaths(
      derivedOf({ diff: { files: 1, insertions: 1, deletions: 1, binary: 1 } }),
      ["/lanes/0/derived/diff/binary"],
    );
  });

  it("requires each count", () => {
    expectEnvelopePaths(derivedOf({ diff: { files: 1, insertions: 1 } }), [
      "/lanes/0/derived/diff/deletions",
    ]);
  });

  it("rejects a negative count", () => {
    expectEnvelopePaths(
      derivedOf({ diff: { files: -1, insertions: 1, deletions: 1 } }),
      ["/lanes/0/derived/diff/files"],
    );
  });

  it("rejects a count that is not an integer", () => {
    expectEnvelopePaths(
      derivedOf({ diff: { files: 1, insertions: 1.5, deletions: 1 } }),
      ["/lanes/0/derived/diff/insertions"],
    );
  });
});

describe("validateEnvelope derived log", () => {
  it("accepts byte counts, mtimes and a tail with line breaks", () => {
    expect(
      derivedValue({ log: { bytes: 0, mtimeMs: 0, tail: "one\ntwo\tthree" } }),
    ).toEqual({
      alive: true,
      log: { bytes: 0, mtimeMs: 0, tail: "one\ntwo\tthree" },
    });
  });

  it("accepts a log without a tail", () => {
    expect(derivedValue({ log: { bytes: 10, mtimeMs: 1 } })).toEqual({
      alive: true,
      log: { bytes: 10, mtimeMs: 1 },
    });
  });

  it("rejects a log that is not an object", () => {
    expectEnvelopePaths(derivedOf({ log: "tail" }), ["/lanes/0/derived/log"]);
  });

  it("rejects an unknown log key", () => {
    expectEnvelopePaths(
      derivedOf({ log: { bytes: 1, mtimeMs: 1, lines: 1 } }),
      ["/lanes/0/derived/log/lines"],
    );
  });

  it("rejects a negative byte count", () => {
    expectEnvelopePaths(derivedOf({ log: { bytes: -1, mtimeMs: 1 } }), [
      "/lanes/0/derived/log/bytes",
    ]);
  });

  it("rejects a negative or non finite mtime", () => {
    expectEnvelopePaths(derivedOf({ log: { bytes: 1, mtimeMs: -1 } }), [
      "/lanes/0/derived/log/mtimeMs",
    ]);
    expectEnvelopePaths(
      derivedOf({ log: { bytes: 1, mtimeMs: Number.POSITIVE_INFINITY } }),
      ["/lanes/0/derived/log/mtimeMs"],
    );
  });

  it("accepts a tail of exactly 4096 bytes", () => {
    const tail = "t".repeat(4096);
    expect(derivedValue({ log: { bytes: 4096, mtimeMs: 1, tail } })).toEqual({
      alive: true,
      log: { bytes: 4096, mtimeMs: 1, tail },
    });
  });

  it("rejects a tail of 4097 bytes", () => {
    expectEnvelopePaths(
      derivedOf({ log: { bytes: 4097, mtimeMs: 1, tail: "t".repeat(4097) } }),
      ["/lanes/0/derived/log/tail"],
    );
  });

  it("rejects a control character in a tail", () => {
    expectEnvelopePaths(
      derivedOf({ log: { bytes: 1, mtimeMs: 1, tail: `ok${BELL}` } }),
      ["/lanes/0/derived/log/tail"],
    );
    expectEnvelopePaths(
      derivedOf({ log: { bytes: 1, mtimeMs: 1, tail: `ok${DEL}` } }),
      ["/lanes/0/derived/log/tail"],
    );
  });

  it("rejects a tail that is not a string", () => {
    expectEnvelopePaths(derivedOf({ log: { bytes: 1, mtimeMs: 1, tail: 7 } }), [
      "/lanes/0/derived/log/tail",
    ]);
  });
});

describe("validateEnvelope derived notes", () => {
  it("accepts a plan review and a risk of 200 characters", () => {
    expect(
      derivedValue({ planReview: "p".repeat(200), risk: "r".repeat(200) }),
    ).toEqual({
      alive: true,
      planReview: "p".repeat(200),
      risk: "r".repeat(200),
    });
  });

  it("rejects a plan review of 201 characters", () => {
    expectEnvelopePaths(derivedOf({ planReview: "p".repeat(201) }), [
      "/lanes/0/derived/planReview",
    ]);
  });

  it("rejects a risk of 201 characters", () => {
    expectEnvelopePaths(derivedOf({ risk: "r".repeat(201) }), [
      "/lanes/0/derived/risk",
    ]);
  });

  it("rejects a line feed or control character in a note", () => {
    expectEnvelopePaths(derivedOf({ planReview: "a\nb" }), [
      "/lanes/0/derived/planReview",
    ]);
    expectEnvelopePaths(derivedOf({ risk: `a${BELL}` }), [
      "/lanes/0/derived/risk",
    ]);
  });

  it("rejects a note that is not a string", () => {
    expectEnvelopePaths(derivedOf({ planReview: 7 }), [
      "/lanes/0/derived/planReview",
    ]);
    expectEnvelopePaths(derivedOf({ risk: {} }), ["/lanes/0/derived/risk"]);
  });
});
