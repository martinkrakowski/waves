import { describe, expect, it } from "vitest";

import {
  decisionBindingText,
  validateDecision,
  validateStateEntry,
} from "../src/index.js";
import { NOTICE_DECISIONS } from "./fixtures/notice-decisions.js";

describe("the fourteen fixture decisions", () => {
  it.each(NOTICE_DECISIONS)("validates all revisions of $id", (fixture) => {
    for (const revision of fixture.revisions) {
      const result = validateDecision(revision);
      if (!result.ok) {
        throw new Error(`expected valid, got ${JSON.stringify(result.errors)}`);
      }
    }
  });

  it.each(NOTICE_DECISIONS.filter((f) => f.states.length > 0))(
    "validates all states for $id",
    (fixture) => {
      for (const entry of fixture.states) {
        const result = validateStateEntry(entry);
        if (!result.ok) {
          throw new Error(
            `expected valid state, got ${JSON.stringify(result.errors)}`,
          );
        }
      }
    },
  );

  it("has exactly fourteen decisions", () => {
    expect(NOTICE_DECISIONS).toHaveLength(14);
  });

  it("has decisions with states only where the table stores them", () => {
    const withStates = NOTICE_DECISIONS.filter((f) => f.states.length > 0);
    expect(withStates.map((f) => f.id)).toEqual([
      "d12-document-owner",
      "erase-user-prints-id",
      "give-up-bound",
      "test-db-switch-hold",
      "clean-merged-worktrees",
    ]);
  });

  it("has exactly two revisions and two states for decision 6", () => {
    const decision6 = NOTICE_DECISIONS.find((f) => f.id === "give-up-bound");
    expect(decision6?.revisions).toHaveLength(2);
    expect(decision6?.states).toHaveLength(2);
  });

  it("has different binding texts for decision 6's two revisions", () => {
    const decision6 = NOTICE_DECISIONS.find((f) => f.id === "give-up-bound");
    if (!decision6) throw new Error("decision 6 not found");
    const r1 = validateDecision(decision6.revisions[0]);
    const r2 = validateDecision(decision6.revisions[1]);
    if (!r1.ok || !r2.ok) {
      throw new Error("expected both revisions to validate");
    }
    expect(decisionBindingText(r1.value)).not.toEqual(
      decisionBindingText(r2.value),
    );
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
    expect((decision14?.revisions[0] as Record<string, unknown>).shape).toBe(
      "instruction",
    );
  });

  it("has the five projects for decision 14", () => {
    const decision14 = NOTICE_DECISIONS.find(
      (f) => f.id === "clean-merged-worktrees",
    );
    expect(
      (decision14?.revisions[0] as Record<string, unknown>).appliesTo,
    ).toEqual([
      "campaign-foundry",
      "client-portal",
      "hexagen-monaco",
      "waves",
      "gate-lock",
    ]);
  });
});
