import { describe, expect, it } from "vitest";

import { validateStatus } from "../src/index.js";
import {
  BELL,
  DEL,
  errorsOf,
  expectStatusPaths,
  expectValidStatus,
  fullStatus,
  minimalStatus,
} from "./support.js";

function withPrs(skipped: unknown): Record<string, unknown> {
  return { ...minimalStatus(), prs: { skipped } };
}

// The two documents of "The project status document" in docs/waves-v1.md are
// `minimalStatus()` and `fullStatus()` in `support.ts`; changing one is changing
// both, by hand and in step.
describe("validateStatus", () => {
  it("accepts the minimal document of the docs section", () => {
    expect(expectValidStatus(minimalStatus())).toEqual(minimalStatus());
  });

  it("accepts the full document of the docs section, unchanged", () => {
    expect(expectValidStatus(fullStatus())).toEqual(fullStatus());
  });

  it("accepts a document with neither prs nor backlog", () => {
    const value = expectValidStatus(minimalStatus());

    expect(value.prs).toBeUndefined();
    expect(value.backlog).toBeUndefined();
  });

  it("rejects a null root with a single root error", () => {
    expectStatusPaths(null, [""]);
    expect(
      errorsOf(validateStatus(null)).map((issue) => issue.message),
    ).toEqual(["expected an object"]);
  });

  it("rejects an array root with a single root error", () => {
    expectStatusPaths([], [""]);
  });

  it("rejects a string root with a single root error", () => {
    expectStatusPaths("waves-status/v1", [""]);
  });

  it("requires the waves-status/v1 schema", () => {
    expectStatusPaths({ ...minimalStatus(), schema: "waves/v1" }, ["/schema"]);
    expectStatusPaths({ ...minimalStatus(), schema: undefined }, ["/schema"]);
    expectStatusPaths({ ...minimalStatus(), schema: 1 }, ["/schema"]);
  });

  it("rejects an unknown key at the root", () => {
    expectStatusPaths({ ...minimalStatus(), extra: true }, ["/extra"]);
    expectStatusPaths({ ...minimalStatus(), wave: "wv6" }, ["/wave"]);
    expectStatusPaths({ ...minimalStatus(), "a~/b": true }, ["/a~0~1b"]);
  });

  it("requires a project id", () => {
    expectStatusPaths({ ...minimalStatus(), project: undefined }, ["/project"]);
    expectStatusPaths({ ...minimalStatus(), project: 3 }, ["/project"]);
    expectStatusPaths({ ...minimalStatus(), project: "Apollo" }, ["/project"]);
    expectStatusPaths({ ...minimalStatus(), project: "a".repeat(64) }, [
      "/project",
    ]);
  });

  it("requires a UTC generatedAt", () => {
    expectStatusPaths({ ...minimalStatus(), generatedAt: undefined }, [
      "/generatedAt",
    ]);
    expectStatusPaths({ ...minimalStatus(), generatedAt: 1767225600000 }, [
      "/generatedAt",
    ]);
    expectStatusPaths(
      { ...minimalStatus(), generatedAt: "2026-10-03T08:00:00" },
      ["/generatedAt"],
    );
    expectStatusPaths(
      { ...minimalStatus(), generatedAt: "2026-02-30T00:00:00Z" },
      ["/generatedAt"],
    );
    expectStatusPaths(
      { ...minimalStatus(), generatedAt: `2026-10-03T08:00:00Z${BELL}` },
      ["/generatedAt"],
    );
    expectStatusPaths(
      { ...minimalStatus(), generatedAt: `2026-10-03T08:00:00Z${DEL}` },
      ["/generatedAt"],
    );
  });

  it("allows a null interval", () => {
    expect(expectValidStatus(minimalStatus()).intervalSeconds).toBeNull();
  });

  it("allows an interval of 1 to 300 seconds", () => {
    expect(
      expectValidStatus({ ...minimalStatus(), intervalSeconds: 1 })
        .intervalSeconds,
    ).toBe(1);
    expect(
      expectValidStatus({ ...minimalStatus(), intervalSeconds: 300 })
        .intervalSeconds,
    ).toBe(300);
  });

  it("rejects an interval outside 1 to 300", () => {
    expectStatusPaths({ ...minimalStatus(), intervalSeconds: 0 }, [
      "/intervalSeconds",
    ]);
    expectStatusPaths({ ...minimalStatus(), intervalSeconds: 301 }, [
      "/intervalSeconds",
    ]);
  });

  it("rejects an interval that is missing or not an integer", () => {
    expectStatusPaths({ ...minimalStatus(), intervalSeconds: undefined }, [
      "/intervalSeconds",
    ]);
    expectStatusPaths({ ...minimalStatus(), intervalSeconds: 10.5 }, [
      "/intervalSeconds",
    ]);
    expectStatusPaths({ ...minimalStatus(), intervalSeconds: "60" }, [
      "/intervalSeconds",
    ]);
  });

  it("allows skipped PR rows of 0 to 100000", () => {
    expect(expectValidStatus(withPrs(0)).prs).toEqual({ skipped: 0 });
    expect(expectValidStatus(withPrs(100_000)).prs).toEqual({
      skipped: 100_000,
    });
  });

  it("rejects a skipped count outside 0 to 100000", () => {
    expectStatusPaths(withPrs(-1), ["/prs/skipped"]);
    expectStatusPaths(withPrs(100_001), ["/prs/skipped"]);
  });

  it("requires prs.skipped", () => {
    expectStatusPaths({ ...minimalStatus(), prs: {} }, ["/prs/skipped"]);
    expectStatusPaths(withPrs(undefined), ["/prs/skipped"]);
    expectStatusPaths(withPrs("2"), ["/prs/skipped"]);
    expectStatusPaths(withPrs(2.5), ["/prs/skipped"]);
  });

  it("closes prs", () => {
    expectStatusPaths({ ...minimalStatus(), prs: 2 }, ["/prs"]);
    expectStatusPaths({ ...minimalStatus(), prs: { skipped: 2, total: 9 } }, [
      "/prs/total",
    ]);
  });

  it("collects every independent error with its own pointer", () => {
    expectStatusPaths(
      {
        ...minimalStatus(),
        schema: "waves/v1",
        project: "Apollo",
        generatedAt: "yesterday",
        prs: { skipped: -1 },
      },
      ["/schema", "/project", "/generatedAt", "/prs/skipped"],
    );
  });

  it("rejects undefined with one root error", () => {
    expect(
      errorsOf(validateStatus(undefined)).map((issue) => [
        issue.path,
        issue.message,
      ]),
    ).toEqual([["", "input is not serialisable JSON"]]);
  });

  it("rejects a status larger than 1 MiB with one root error", () => {
    const huge = {
      ...minimalStatus(),
      backlog: {
        state: "recorded",
        premises: [{ lane: "p".repeat(1_048_576) }],
      },
    };

    expect(
      errorsOf(validateStatus(huge)).map((issue) => [
        issue.path,
        issue.message,
      ]),
    ).toEqual([["", "status larger than 1 MiB"]]);
  });
});
