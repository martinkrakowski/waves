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

function minimalAction(): Record<string, unknown> {
  return {
    ...minimalChoice(),
    shape: "action",
    options: [],
    actElsewhere: { where: "session a-1", what: "do it there" },
  };
}

function minimalInstruction(): Record<string, unknown> {
  return {
    ...minimalChoice(),
    shape: "instruction",
    options: [],
    appliesTo: ["alpha"],
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

const opts = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    key: `k${i}`,
    text: `opt${i}`,
    cost: `c${i}`,
  }));

describe("validateDecision — valid decisions", () => {
  it("accepts a valid choice decision", () => {
    expect(expectValidDecision(minimalChoice()).shape).toBe("choice");
  });

  it("accepts a valid action decision", () => {
    expect(expectValidDecision(minimalAction()).shape).toBe("action");
  });

  it("accepts a valid instruction decision", () => {
    expect(expectValidDecision(minimalInstruction()).shape).toBe("instruction");
  });
});

describe("validateDecision — refusals", () => {
  it("rejects an unknown key (closed object)", () => {
    expectDecisionPaths({ ...minimalChoice(), extra: true }, ["/extra"]);
  });

  it("requires the waves-notice/v1 schema", () => {
    expectDecisionPaths({ ...minimalChoice(), schema: "waves/v1" }, [
      "/schema",
    ]);
    expectDecisionPaths({ ...minimalChoice(), schema: undefined }, ["/schema"]);
  });

  it("requires kind to be decision", () => {
    expectDecisionPaths({ ...minimalChoice(), kind: "event" }, ["/kind"]);
  });

  it("requires a valid shape", () => {
    expectDecisionPaths({ ...minimalChoice(), shape: "unknown" }, ["/shape"]);
  });

  it("requires owner or delegated", () => {
    expectDecisionPaths({ ...minimalChoice(), decider: "maybe" }, ["/decider"]);
  });

  it("requires 2 to 8 options for a choice", () => {
    expectValidDecision({ ...minimalChoice(), options: opts(2) });
    expectValidDecision({ ...minimalChoice(), options: opts(8) });
    expectDecisionPaths({ ...minimalChoice(), options: opts(1) }, ["/options"]);
  });

  it("rejects more than 8 options", () => {
    expectDecisionPaths({ ...minimalChoice(), options: opts(9) }, ["/options"]);
  });

  it("rejects duplicate option keys", () => {
    expectDecisionPaths(
      {
        ...minimalChoice(),
        options: [
          { key: "a", text: "A", cost: "C1" },
          { key: "a", text: "B", cost: "C2" },
        ],
      },
      ["/options/1/key"],
    );
  });

  it("rejects a recommended option not in the decision's options", () => {
    expectDecisionPaths(
      { ...minimalChoice(), recommended: { option: "x", reason: "why" } },
      ["/recommended/option"],
    );
  });

  it("requires a reason for true and partly, allows none for false", () => {
    expectDecisionPaths({ ...minimalChoice(), hardToUndo: { value: true } }, [
      "/hardToUndo/reason",
    ]);
    expectDecisionPaths(
      { ...minimalChoice(), hardToUndo: { value: "partly" } },
      ["/hardToUndo/reason"],
    );
    expectValidDecision({ ...minimalChoice(), hardToUndo: { value: false } });
  });

  it("requires an https href in evidence", () => {
    expectDecisionPaths(
      {
        ...minimalChoice(),
        evidence: [{ label: "L", href: "http://example.com" }],
      },
      ["/evidence/0/href"],
    );
  });

  it("rejects an action with options", () => {
    expectDecisionPaths(
      { ...minimalAction(), options: [{ key: "a", text: "A", cost: "C" }] },
      ["/options"],
    );
  });

  it("rejects more than 8 commits", () => {
    expectDecisionPaths(
      {
        ...minimalChoice(),
        commits: Array.from({ length: 9 }, (_, i) => `c${i}`),
      },
      ["/commits"],
    );
  });

  it("rejects more than 8 evidence links", () => {
    expectDecisionPaths(
      {
        ...minimalChoice(),
        evidence: opts(9).map((o) => ({ label: o.key, href: "https://x.com" })),
      },
      ["/evidence"],
    );
  });

  it("rejects more than 16 appliesTo entries", () => {
    const ids = Array.from({ length: 17 }, (_, i) => `p${i}`);
    expectDecisionPaths({ ...minimalChoice(), appliesTo: ids }, ["/appliesTo"]);
  });
});
