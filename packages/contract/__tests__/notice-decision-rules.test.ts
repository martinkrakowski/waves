import { describe, expect, it } from "vitest";

import { validateDecision, type DecisionRevision } from "../src/index.js";
import { errorsOf } from "./support.js";

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

function expectValidDecision(input: unknown): DecisionRevision {
  const result = validateDecision(input);
  if (!result.ok) {
    throw new Error(
      `expected valid decision, got ${JSON.stringify(result.errors)}`,
    );
  }
  return result.value;
}

function expectDecisionPaths(
  input: unknown,
  expected: readonly string[],
): void {
  const result = validateDecision(input);
  expect(errorsOf(result).map((e) => e.path)).toEqual(expected);
}

describe("validateDecision — remaining refusals", () => {
  it("rejects a non-object root", () => {
    expectDecisionPaths("hello", [""]);
    expectDecisionPaths([], [""]);
    expectDecisionPaths(null, [""]);
  });

  it("requires actElsewhere for an action", () => {
    expectDecisionPaths({ ...minimalChoice(), shape: "action", options: [] }, [
      "/actElsewhere",
    ]);
  });

  it("requires appliesTo for an instruction", () => {
    expectDecisionPaths(
      { ...minimalChoice(), shape: "instruction", options: [] },
      ["/appliesTo"],
    );
  });

  it("rejects a null optional", () => {
    expectDecisionPaths({ ...minimalChoice(), actElsewhere: null }, [
      "/actElsewhere",
    ]);
  });

  it("rejects a recommended on a non-choice shape", () => {
    expectDecisionPaths(
      {
        ...minimalChoice(),
        shape: "action",
        options: [],
        actElsewhere: { where: "w", what: "d" },
        recommended: { option: "a", reason: "r" },
      },
      ["/recommended/option", "/recommended"],
    );
  });

  it("rejects options on a non-choice shape", () => {
    expectDecisionPaths(
      {
        ...minimalChoice(),
        shape: "action",
        options: [{ key: "a", text: "A", cost: "C" }],
        actElsewhere: { where: "w", what: "d" },
      },
      ["/options"],
    );
    expectDecisionPaths(
      {
        ...minimalChoice(),
        shape: "instruction",
        options: [{ key: "a", text: "A", cost: "C" }],
        appliesTo: ["alpha"],
      },
      ["/options"],
    );
  });

  it("rejects a string that is not NFC", () => {
    expectDecisionPaths({ ...minimalChoice(), question: "cafe\u0301" }, [
      "/question",
    ]);
  });

  it("rejects a string with trailing white space", () => {
    expectDecisionPaths({ ...minimalChoice(), question: "What? " }, [
      "/question",
    ]);
  });

  it("requires raisedBy of 1 to 80 characters", () => {
    expectValidDecision({ ...minimalChoice(), raisedBy: "b".repeat(80) });
    expectDecisionPaths({ ...minimalChoice(), raisedBy: "b".repeat(81) }, [
      "/raisedBy",
    ]);
  });

  it("requires the question at 1 to 300 characters", () => {
    expectValidDecision({ ...minimalChoice(), question: "a".repeat(300) });
    expectDecisionPaths({ ...minimalChoice(), question: "a".repeat(301) }, [
      "/question",
    ]);
  });

  it("requires text fields at 1 to 2000 characters", () => {
    expectValidDecision({ ...minimalChoice(), commits: ["c".repeat(2000)] });
    expectDecisionPaths({ ...minimalChoice(), commits: ["c".repeat(2001)] }, [
      "/commits/0",
    ]);
  });

  it("requires evidence labels at 1 to 80 characters", () => {
    expectValidDecision({
      ...minimalChoice(),
      evidence: [{ label: "l".repeat(80), href: "https://x.com" }],
    });
    expectDecisionPaths(
      {
        ...minimalChoice(),
        evidence: [{ label: "l".repeat(81), href: "https://x.com" }],
      },
      ["/evidence/0/label"],
    );
  });

  it("requires a lane id for the decision id", () => {
    expectDecisionPaths({ ...minimalChoice(), id: "Bad Id" }, ["/id"]);
    expectDecisionPaths({ ...minimalChoice(), id: "a".repeat(81) }, ["/id"]);
    expectDecisionPaths({ ...minimalChoice(), id: 123 }, ["/id"]);
  });

  it("requires a project id", () => {
    expectDecisionPaths({ ...minimalChoice(), project: "Apollo" }, [
      "/project",
    ]);
    expectDecisionPaths({ ...minimalChoice(), project: "a".repeat(64) }, [
      "/project",
    ]);
  });

  it("requires a valid raisedAt", () => {
    expectDecisionPaths({ ...minimalChoice(), raisedAt: "yesterday" }, [
      "/raisedAt",
    ]);
  });

  it('requires hardToUndo.value to be true, false or "partly"', () => {
    expectDecisionPaths({ ...minimalChoice(), hardToUndo: { value: "yes" } }, [
      "/hardToUndo/value",
    ]);
    expectDecisionPaths({ ...minimalChoice(), hardToUndo: { value: 1 } }, [
      "/hardToUndo/value",
    ]);
  });

  it("requires the recommended option and reason", () => {
    expectDecisionPaths({ ...minimalChoice(), recommended: { option: "a" } }, [
      "/recommended/reason",
    ]);
    expectDecisionPaths({ ...minimalChoice(), recommended: { reason: "r" } }, [
      "/recommended/option",
    ]);
  });

  it("closes nested objects", () => {
    expectDecisionPaths(
      {
        ...minimalChoice(),
        options: [
          { key: "a", text: "A", cost: "C", extra: true },
          { key: "b", text: "B", cost: "C2" },
        ],
      },
      ["/options/0/extra"],
    );
    expectDecisionPaths(
      {
        ...minimalChoice(),
        recommended: { option: "a", reason: "r", extra: true },
      },
      ["/recommended/extra"],
    );
    expectDecisionPaths(
      { ...minimalChoice(), hardToUndo: { value: false, extra: true } },
      ["/hardToUndo/extra"],
    );
    expectDecisionPaths({ ...minimalChoice(), refs: { pr: 1, extra: true } }, [
      "/refs/extra",
    ]);
  });

  it("rejects non-array options", () => {
    expectDecisionPaths({ ...minimalChoice(), options: "not-array" }, [
      "/options",
    ]);
  });

  it("rejects non-array commits", () => {
    expectDecisionPaths({ ...minimalChoice(), commits: {} }, ["/commits"]);
  });

  it("rejects missing required fields", () => {
    expectDecisionPaths(
      {
        schema: "waves-notice/v1",
        kind: "decision",
        project: "alpha",
        id: "d1",
        shape: "choice",
        options: [],
      },
      [
        "/question",
        "/hardToUndo",
        "/commits",
        "/decider",
        "/appliesTo",
        "/evidence",
        "/raisedBy",
        "/raisedAt",
        "/options",
      ],
    );
  });

  it("collects every independent error with its own pointer", () => {
    expectDecisionPaths(
      {
        ...minimalChoice(),
        schema: "waves/v1",
        project: "Apollo",
        question: "What? ",
        committed: [],
      },
      ["/committed", "/schema", "/project", "/question"],
    );
  });

  it("rejects an undefined root", () => {
    expectDecisionPaths(undefined, [""]);
  });

  it("rejects refs with an invalid wave or lane id", () => {
    expectDecisionPaths({ ...minimalChoice(), refs: { wave: "bad id" } }, [
      "/refs/wave",
    ]);
    expectDecisionPaths({ ...minimalChoice(), refs: { wave: 42 } }, [
      "/refs/wave",
    ]);
    expectDecisionPaths({ ...minimalChoice(), refs: { lane: "bad id" } }, [
      "/refs/lane",
    ]);
    expectDecisionPaths({ ...minimalChoice(), refs: { lane: 42 } }, [
      "/refs/lane",
    ]);
  });

  it("rejects an href with white space", () => {
    expectDecisionPaths(
      {
        ...minimalChoice(),
        evidence: [{ label: "L", href: "https://bad url.com" }],
      },
      ["/evidence/0/href"],
    );
  });

  it("rejects an option missing a field", () => {
    expectDecisionPaths(
      {
        ...minimalChoice(),
        options: [
          { key: "a", text: "A" },
          { key: "b", text: "B", cost: "C2" },
        ],
      },
      ["/options/0/cost"],
    );
  });

  it("rejects duplicate project ids in appliesTo", () => {
    expectDecisionPaths({ ...minimalChoice(), appliesTo: ["alpha", "alpha"] }, [
      "/appliesTo/1",
    ]);
  });

  it("rejects an invalid project id in appliesTo", () => {
    expectDecisionPaths({ ...minimalChoice(), appliesTo: ["Alpha"] }, [
      "/appliesTo/0",
    ]);
  });

  it("rejects a non-object evidence entry", () => {
    expectDecisionPaths({ ...minimalChoice(), evidence: ["not-an-object"] }, [
      "/evidence/0",
    ]);
  });

  it("rejects actElsewhere missing a field", () => {
    expectDecisionPaths({ ...minimalChoice(), actElsewhere: { what: "d" } }, [
      "/actElsewhere/where",
    ]);
    expectDecisionPaths({ ...minimalChoice(), actElsewhere: { where: "w" } }, [
      "/actElsewhere/what",
    ]);
  });

  it("rejects an option missing key or text", () => {
    expectDecisionPaths(
      {
        ...minimalChoice(),
        options: [
          { text: "A", cost: "C1" },
          { key: "b", text: "B", cost: "C2" },
        ],
      },
      ["/options/0/key"],
    );
    expectDecisionPaths(
      {
        ...minimalChoice(),
        options: [
          { key: "a", cost: "C1" },
          { key: "b", text: "B", cost: "C2" },
        ],
      },
      ["/options/0/text"],
    );
  });

  it("rejects a non-string href", () => {
    expectDecisionPaths(
      { ...minimalChoice(), evidence: [{ label: "L", href: 123 }] },
      ["/evidence/0/href"],
    );
  });

  it("rejects a non-object option entry", () => {
    expectDecisionPaths(
      {
        ...minimalChoice(),
        options: ["not-an-object", { key: "b", text: "B", cost: "C2" }],
      },
      ["/options/0"],
    );
  });

  it("rejects a non-object recommended", () => {
    expectDecisionPaths({ ...minimalChoice(), recommended: "not-an-object" }, [
      "/recommended",
    ]);
  });
});
