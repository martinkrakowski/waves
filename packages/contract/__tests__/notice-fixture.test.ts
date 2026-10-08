import { describe, expect, it } from "vitest";

import { validateDecision, validateStateEntry } from "../src/index.js";
import { NOTICE_DECISIONS } from "./fixtures/notice-decisions.js";

describe("the fourteen fixture decisions", () => {
  it.each(NOTICE_DECISIONS)("validates decision $id ($project)", (fixture) => {
    const result = validateDecision(fixture.revision);
    if (!result.ok) {
      throw new Error(`expected valid, got ${JSON.stringify(result.errors)}`);
    }
  });

  it("validates all fixture state entries", () => {
    for (const fixture of NOTICE_DECISIONS) {
      for (const entry of fixture.states) {
        const result = validateStateEntry(entry);
        if (!result.ok) {
          throw new Error(
            `${fixture.id}: expected valid state, got ${JSON.stringify(result.errors)}`,
          );
        }
      }
    }
  });

  it("has exactly fourteen decisions", () => {
    expect(NOTICE_DECISIONS).toHaveLength(14);
  });

  it("has states only for decisions that need them", () => {
    const withStates = NOTICE_DECISIONS.filter((f) => f.states.length > 0);
    expect(withStates.map((f) => f.id)).toEqual([
      "d12-document-owner",
      "erase-user-prints-id",
      "give-up-bound",
      "test-db-switch-hold",
      "clean-merged-worktrees",
    ]);
  });

  it("has two state entries for decision 8", () => {
    const decision8 = NOTICE_DECISIONS.find(
      (f) => f.id === "test-db-switch-hold",
    );
    expect(decision8?.states).toHaveLength(2);
  });

  it("has no states for decision 13 (open)", () => {
    const decision13 = NOTICE_DECISIONS.find(
      (f) => f.id === "backup-job-in-freeze",
    );
    expect(decision13?.states).toHaveLength(0);
  });

  it("has an instruction for decision 14", () => {
    const decision14 = NOTICE_DECISIONS.find(
      (f) => f.id === "clean-merged-worktrees",
    );
    expect((decision14?.revision as Record<string, unknown>).shape).toBe(
      "instruction",
    );
  });
});
