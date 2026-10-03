import { describe, expect, it } from "vitest";

import {
  BELL,
  expectStatusPaths,
  expectValidStatus,
  minimalStatus,
  withBacklog,
} from "./support.js";

function withGit(patch: Record<string, unknown>): Record<string, unknown> {
  return {
    ...minimalStatus(),
    backlog: {
      state: "recorded",
      git: { branch: "main", head: "0a1b2c3d4e5f", ...patch },
    },
  };
}

function withScope(patch: Record<string, unknown>): Record<string, unknown> {
  return withBacklog({
    scope: { kind: "full", plans: ["plan:verify"], ...patch },
  });
}

describe("validateStatus backlog", () => {
  it("allows every backlog state and refuses another", () => {
    for (const state of ["recorded", "absent", "unknown"]) {
      expect(expectValidStatus(withBacklog({ state })).backlog?.state).toBe(
        state,
      );
    }
    expectStatusPaths(withBacklog({ state: "done" }), ["/backlog/state"]);
    expectStatusPaths(withBacklog({ state: undefined }), ["/backlog/state"]);
  });

  it("rejects a backlog that is not an object", () => {
    expectStatusPaths({ ...minimalStatus(), backlog: [] }, ["/backlog"]);
    expectStatusPaths({ ...minimalStatus(), backlog: 7 }, ["/backlog"]);
    expectStatusPaths({ ...minimalStatus(), backlog: "recorded" }, [
      "/backlog",
    ]);
  });

  it("rejects an unknown key in the backlog", () => {
    expectStatusPaths(withBacklog({ plans: [] }), ["/backlog/plans"]);
    expectStatusPaths(withBacklog({ state: "recorded", plans: ["p"] }), [
      "/backlog/plans",
    ]);
  });

  it("allows a UTC at and refuses anything else", () => {
    expect(
      expectValidStatus(withBacklog({ at: "2026-10-03T07:55:00.250Z" })).backlog
        ?.at,
    ).toBe("2026-10-03T07:55:00.250Z");
    expectStatusPaths(withBacklog({ at: "2026-10-03 07:55Z" }), [
      "/backlog/at",
    ]);
    expectStatusPaths(withBacklog({ at: 7 }), ["/backlog/at"]);
    expectStatusPaths(withBacklog({ at: "2026-10-03T07:55:00Z\n" }), [
      "/backlog/at",
    ]);
  });

  it("closes the scope and reads its kind", () => {
    for (const kind of ["full", "partial"]) {
      expect(expectValidStatus(withScope({ kind })).backlog?.scope).toEqual({
        kind,
        plans: ["plan:verify"],
      });
    }
    expectStatusPaths(withScope({ kind: "whole" }), ["/backlog/scope/kind"]);
    expectStatusPaths(withScope({ kind: undefined }), ["/backlog/scope/kind"]);
    expectStatusPaths(withBacklog({ scope: "full" }), ["/backlog/scope"]);
    expectStatusPaths(withScope({ all: true }), ["/backlog/scope/all"]);
  });

  it("allows 64 plans and rejects 65", () => {
    const at = (count: number): string[] =>
      Array.from({ length: count }, (_unused, index) => `plan-${index}`);

    expect(
      expectValidStatus(withScope({ plans: at(64) })).backlog?.scope?.plans,
    ).toHaveLength(64);
    expectStatusPaths(withScope({ plans: at(65) }), ["/backlog/scope/plans"]);
  });

  it("requires plans to be an array of 1 to 120 character names", () => {
    expectStatusPaths(withScope({ plans: undefined }), [
      "/backlog/scope/plans",
    ]);
    expectStatusPaths(withScope({ plans: {} }), ["/backlog/scope/plans"]);
    expectStatusPaths(withScope({ plans: ["", "plan"] }), [
      "/backlog/scope/plans/0",
    ]);
    expectStatusPaths(withScope({ plans: ["p".repeat(121)] }), [
      "/backlog/scope/plans/0",
    ]);
    expectStatusPaths(withScope({ plans: [7] }), ["/backlog/scope/plans/0"]);
    expectStatusPaths(withScope({ plans: ["plan\nverify"] }), [
      "/backlog/scope/plans/0",
    ]);
    expectStatusPaths(withScope({ plans: [`plan${BELL}`] }), [
      "/backlog/scope/plans/0",
    ]);
  });

  it("reads the git branch and head", () => {
    expect(
      expectValidStatus(withGit({ head: "0a1b2c3" })).backlog?.git,
    ).toEqual({ branch: "main", head: "0a1b2c3" });
    expect(
      expectValidStatus(withGit({ branch: "b".repeat(255) })).backlog?.git
        ?.branch,
    ).toBe("b".repeat(255));
  });

  it("requires a branch of 1 to 255 characters", () => {
    expectStatusPaths(withGit({ branch: undefined }), ["/backlog/git/branch"]);
    expectStatusPaths(withGit({ branch: "" }), ["/backlog/git/branch"]);
    expectStatusPaths(withGit({ branch: "b".repeat(256) }), [
      "/backlog/git/branch",
    ]);
    expectStatusPaths(withGit({ branch: `ma${BELL}in` }), [
      "/backlog/git/branch",
    ]);
    expectStatusPaths(withGit({ branch: "ma\nin" }), ["/backlog/git/branch"]);
  });

  it("requires a head of 7 to 64 lower case hexadecimal characters", () => {
    expectStatusPaths(withGit({ head: undefined }), ["/backlog/git/head"]);
    expectStatusPaths(withGit({ head: "0a1b2c3" + "A".repeat(64) }), [
      "/backlog/git/head",
    ]);
    expectStatusPaths(withGit({ head: "0a1b2c" }), ["/backlog/git/head"]);
    expectStatusPaths(withGit({ head: "0a1b2c3d".repeat(9) }), [
      "/backlog/git/head",
    ]);
    expectStatusPaths(withGit({ head: "0a1b2c3d4e5f" + "g" }), [
      "/backlog/git/head",
    ]);
  });

  it("closes git", () => {
    expectStatusPaths(withGit({ remote: "origin" }), ["/backlog/git/remote"]);
    expectStatusPaths(
      withBacklog({ git: { branch: "main", head: "0a1b2c3", worktree: 1 } }),
      ["/backlog/git/worktree"],
    );
    expectStatusPaths(withBacklog({ git: "main" }), ["/backlog/git"]);
  });
});
