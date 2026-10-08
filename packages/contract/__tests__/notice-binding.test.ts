import { describe, expect, it } from "vitest";

import {
  decisionBindingText,
  validateDecision,
  type DecisionRevision,
} from "../src/index.js";

function minimalChoice(): Record<string, unknown> {
  return {
    schema: "waves-notice/v1",
    kind: "decision",
    project: "alpha",
    id: "d1",
    shape: "choice",
    question: "What should we do?",
    options: [
      { key: "a", text: "A", cost: "C1" },
      { key: "b", text: "B", cost: "C2" },
    ],
    hardToUndo: { value: false },
    commits: [],
    decider: "owner",
    appliesTo: [],
    evidence: [],
    raisedBy: "session",
    raisedAt: "2026-10-08T12:00:00Z",
  };
}

function baseRevision(): DecisionRevision {
  const result = validateDecision(minimalChoice());
  if (!result.ok) {
    throw new Error(`expected valid, got ${JSON.stringify(result.errors)}`);
  }
  return result.value;
}

describe("decisionBindingText", () => {
  it("produces the exact canonical text for a small decision", () => {
    const revision = baseRevision();
    expect(decisionBindingText(revision)).toBe(
      '{"question":"What should we do?","shape":"choice","options":[{"key":"a","text":"A","cost":"C1"},{"key":"b","text":"B","cost":"C2"}],"recommended":null,"hardToUndo":{"value":false,"reason":null},"commits":[],"decider":"owner","appliesTo":[],"actElsewhere":null}',
    );
  });

  it("is equal when evidence differs", () => {
    const base = baseRevision();
    const withEvidence = {
      ...base,
      evidence: [{ label: "E", href: "https://e.com" }],
    };
    expect(decisionBindingText(base)).toEqual(
      decisionBindingText(withEvidence),
    );
  });

  it("is equal when refs differs", () => {
    const base = baseRevision();
    const withRefs = { ...base, refs: { pr: 1 } };
    expect(decisionBindingText(base)).toEqual(decisionBindingText(withRefs));
  });

  it("is equal when raisedBy differs", () => {
    const base = baseRevision();
    const changed = { ...base, raisedBy: "someone else" };
    expect(decisionBindingText(base)).toEqual(decisionBindingText(changed));
  });

  it("is equal when raisedAt differs", () => {
    const base = baseRevision();
    const changed = { ...base, raisedAt: "2026-10-09T12:00:00Z" };
    expect(decisionBindingText(base)).toEqual(decisionBindingText(changed));
  });

  it("is equal when changeNote differs", () => {
    const base = baseRevision();
    const withNote = { ...base, changeNote: "narrowed after feedback" };
    expect(decisionBindingText(base)).toEqual(decisionBindingText(withNote));
  });

  it("is equal when project differs", () => {
    const base = baseRevision();
    const changed = { ...base, project: "beta" };
    expect(decisionBindingText(base)).toEqual(decisionBindingText(changed));
  });

  it("is equal when id differs", () => {
    const base = baseRevision();
    const changed = { ...base, id: "different-id" };
    expect(decisionBindingText(base)).toEqual(decisionBindingText(changed));
  });

  it("differs when question changes", () => {
    const base = baseRevision();
    const changed = { ...base, question: "Different?" };
    expect(decisionBindingText(base)).not.toEqual(decisionBindingText(changed));
  });

  it("differs when shape changes", () => {
    const base = baseRevision();
    const changed = { ...base, shape: "instruction" };
    expect(decisionBindingText(base)).not.toEqual(decisionBindingText(changed));
  });

  it("differs when an option changes", () => {
    const base = baseRevision();
    const changed = {
      ...base,
      options: [{ key: "a", text: "X", cost: "C1" }, base.options[1]],
    };
    expect(decisionBindingText(base)).not.toEqual(decisionBindingText(changed));
  });

  it("differs when recommended is added", () => {
    const base = baseRevision();
    const withRecommended = {
      ...base,
      recommended: { option: "a", reason: "r" },
    };
    expect(decisionBindingText(base)).not.toEqual(
      decisionBindingText(withRecommended),
    );
  });

  it("differs when hardToUndo.value changes", () => {
    const base = baseRevision();
    const changed = { ...base, hardToUndo: { value: true, reason: "r" } };
    expect(decisionBindingText(base)).not.toEqual(decisionBindingText(changed));
  });

  it("differs when hardToUndo.reason changes", () => {
    const base = baseRevision();
    const a = { ...base, hardToUndo: { value: true, reason: "one" } };
    const b = { ...base, hardToUndo: { value: true, reason: "two" } };
    expect(decisionBindingText(a)).not.toEqual(decisionBindingText(b));
  });

  it("differs when commits changes", () => {
    const base = baseRevision();
    const withCommits = { ...base, commits: ["a commit"] };
    expect(decisionBindingText(base)).not.toEqual(
      decisionBindingText(withCommits),
    );
  });

  it("differs when decider changes", () => {
    const base = baseRevision();
    const changed = { ...base, decider: "delegated" };
    expect(decisionBindingText(base)).not.toEqual(decisionBindingText(changed));
  });

  it("differs when appliesTo changes", () => {
    const base = baseRevision();
    const changed = { ...base, appliesTo: ["beta"] };
    expect(decisionBindingText(base)).not.toEqual(decisionBindingText(changed));
  });

  it("differs when actElsewhere is added", () => {
    const base = baseRevision();
    const withAct = { ...base, actElsewhere: { where: "w", what: "d" } };
    expect(decisionBindingText(base)).not.toEqual(decisionBindingText(withAct));
  });

  it("differs when options are swapped", () => {
    const base = baseRevision();
    const swapped = { ...base, options: [base.options[1], base.options[0]] };
    expect(decisionBindingText(base)).not.toEqual(decisionBindingText(swapped));
  });
});
