import { describe, expect, it } from "vitest";

import {
  BELL,
  expectStatusPaths,
  expectValidStatus,
  withBacklog,
  withPremise,
} from "./support.js";

function withPremises(premises: unknown): Record<string, unknown> {
  return withBacklog({ premises });
}

describe("validateStatus premises", () => {
  it("reads a premise with its lane, plan, status and reason", () => {
    expect(expectValidStatus(withPremise()).backlog?.premises).toEqual([
      { lane: "C1", plan: "plan-c", status: "holds" },
    ]);
    expect(
      expectValidStatus(
        withPremise({ status: "error", reason: "plan:verify failed" }),
      ).backlog?.premises,
    ).toEqual([
      {
        lane: "C1",
        plan: "plan-c",
        status: "error",
        reason: "plan:verify failed",
      },
    ]);
  });

  it("allows every premise status and refuses another", () => {
    for (const status of ["holds", "stale", "timed-out", "error"]) {
      expect(
        expectValidStatus(withPremise({ status })).backlog?.premises?.[0]
          ?.status,
      ).toBe(status);
    }
    expectStatusPaths(withPremise({ status: "held" }), [
      "/backlog/premises/0/status",
    ]);
    expectStatusPaths(withPremise({ status: undefined }), [
      "/backlog/premises/0/status",
    ]);
    expectStatusPaths(withPremise({ status: 1 }), [
      "/backlog/premises/0/status",
    ]);
  });

  it("requires a lane and a plan of 1 to 120 characters", () => {
    expectStatusPaths(withPremise({ lane: undefined }), [
      "/backlog/premises/0/lane",
    ]);
    expectStatusPaths(withPremise({ lane: "" }), ["/backlog/premises/0/lane"]);
    expectStatusPaths(withPremise({ lane: "c".repeat(121) }), [
      "/backlog/premises/0/lane",
    ]);
    expectStatusPaths(withPremise({ lane: `C${BELL}1` }), [
      "/backlog/premises/0/lane",
    ]);
    expectStatusPaths(withPremise({ lane: "C\n1" }), [
      "/backlog/premises/0/lane",
    ]);
    expectStatusPaths(withPremise({ plan: undefined }), [
      "/backlog/premises/0/plan",
    ]);
    expectStatusPaths(withPremise({ plan: "" }), ["/backlog/premises/0/plan"]);
    expectStatusPaths(withPremise({ plan: "p".repeat(121) }), [
      "/backlog/premises/0/plan",
    ]);
    expectStatusPaths(withPremise({ plan: "plan\nc" }), [
      "/backlog/premises/0/plan",
    ]);
  });

  it("allows a reason of 1 to 500 characters", () => {
    expect(
      expectValidStatus(withPremise({ reason: "r".repeat(500) })).backlog
        ?.premises?.[0]?.reason,
    ).toBe("r".repeat(500));
    expectStatusPaths(withPremise({ reason: "" }), [
      "/backlog/premises/0/reason",
    ]);
    expectStatusPaths(withPremise({ reason: "r".repeat(501) }), [
      "/backlog/premises/0/reason",
    ]);
    expectStatusPaths(withPremise({ reason: 7 }), [
      "/backlog/premises/0/reason",
    ]);
    expectStatusPaths(withPremise({ reason: `no${BELL}` }), [
      "/backlog/premises/0/reason",
    ]);
  });

  it("closes a premise", () => {
    expectStatusPaths(withPremises(["C1"]), ["/backlog/premises/0"]);
    expectStatusPaths(
      withPremises([{ lane: "C1", plan: "p", status: "holds", owner: "C3" }]),
      ["/backlog/premises/0/owner"],
    );
  });

  it("requires premises to be an array", () => {
    expectStatusPaths(withBacklog({ premises: {} }), ["/backlog/premises"]);
    expectStatusPaths(withBacklog({ premises: "C1" }), ["/backlog/premises"]);
  });

  it("allows 200 premises and rejects 201", () => {
    const premise = (index: number): Record<string, unknown> => ({
      lane: `C${index}`,
      plan: "plan-c",
      status: "holds",
    });

    expect(
      expectValidStatus(
        withPremises(
          Array.from({ length: 200 }, (_unused, index) => premise(index)),
        ),
      ).backlog?.premises,
    ).toHaveLength(200);
    expectStatusPaths(
      withPremises(
        Array.from({ length: 201 }, (_unused, index) => premise(index)),
      ),
      ["/backlog/premises"],
    );
  });
});
