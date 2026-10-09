import { describe, expect, it } from "vitest";
import { validateDecision } from "@hexagen-monaco/waves-contract";

import { completeDecision } from "../src/domain/decision-document.js";
import { GENERATED_AT, NOW, PROJECT } from "./support/harness.js";

const context = { project: PROJECT, now: NOW };

const MINIMAL_DECISION = {
  id: "d1",
  question: "What should we do?",
  options: [
    { key: "a", text: "A", cost: "C1" },
    { key: "b", text: "B", cost: "C2" },
  ],
  hardToUndo: { value: false },
  decider: "owner",
  raisedBy: "session",
};

describe("completeDecision", () => {
  it("fills in the keys the user did not give", () => {
    const result = completeDecision(MINIMAL_DECISION, context);
    expect(result).toEqual({
      ok: true,
      document: {
        ...MINIMAL_DECISION,
        schema: "waves-notice/v1",
        kind: "decision",
        project: PROJECT,
        shape: "choice",
        raisedAt: GENERATED_AT,
        commits: [],
        appliesTo: [],
        evidence: [],
        options: [
          { key: "a", text: "A", cost: "C1" },
          { key: "b", text: "B", cost: "C2" },
        ],
      },
    });
  });

  it("never overwrites a key the document already has", () => {
    const given = {
      ...MINIMAL_DECISION,
      schema: "waves-notice/v1",
      kind: "decision",
      project: PROJECT,
      shape: "action",
      raisedAt: "2026-01-01T00:00:00Z",
      commits: ["abc"],
      appliesTo: ["other"],
      evidence: [{ label: "L", href: "https://example.com" }],
    };
    const result = completeDecision(given, context);
    expect(result).toEqual({ ok: true, document: given });
  });

  it("refuses a document whose project is another project", () => {
    const result = completeDecision(
      { ...MINIMAL_DECISION, project: "someone-else" },
      context,
    );
    expect(result).toEqual({
      ok: false,
      reason: `project someone-else is not ${PROJECT}`,
    });
  });

  it("fills in an absent project with the session's", () => {
    const result = completeDecision(MINIMAL_DECISION, context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.project).toBe(PROJECT);
    }
  });

  it("refuses input that is not a JSON object", () => {
    expect(completeDecision([], context).ok).toBe(false);
    expect(completeDecision("not a document", context).ok).toBe(false);
    expect(completeDecision(null, context).ok).toBe(false);
    expect(completeDecision(undefined, context).ok).toBe(false);
  });

  it("produces a document the contract accepts", () => {
    const result = completeDecision(MINIMAL_DECISION, context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(validateDecision(result.document).ok).toBe(true);
    }
  });
});
