import { describe, expect, it } from "vitest";

import { validateEnvelope } from "../src/index.js";
import {
  BELL,
  DEL,
  expectEnvelopePaths,
  expectValidEnvelope,
  oneLane,
} from "./support.js";

function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function detailOfBytes(total: number): Record<string, unknown> {
  let note = "x".repeat(total);
  while (serializedBytes({ note }) > total) {
    note = note.slice(0, -1);
  }
  while (serializedBytes({ note }) < total) {
    note = `${note}x`;
  }
  return { note };
}

function reported(
  patch: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    stage: "build",
    event: "started",
    ts: "2026-10-01T11:00:00Z",
    ...patch,
  };
}

function withReported(patch: Record<string, unknown>): Record<string, unknown> {
  return oneLane({ reported: reported(patch) });
}

function laneWithDerived(
  derived: Record<string, unknown>,
): Record<string, unknown> {
  return oneLane({ derived: { alive: true, ...derived } });
}

describe("validateEnvelope lane seat", () => {
  it("accepts a seat of 64 characters", () => {
    expect(
      expectValidEnvelope(oneLane({ seat: "s".repeat(64) })).lanes[0]?.seat,
    ).toBe("s".repeat(64));
  });

  it("accepts a lane without a seat", () => {
    expect(expectValidEnvelope(oneLane()).lanes[0]?.seat).toBeUndefined();
  });

  it("rejects a seat of 65 characters", () => {
    expectEnvelopePaths(oneLane({ seat: "s".repeat(65) }), ["/lanes/0/seat"]);
  });

  it("rejects an empty seat", () => {
    expectEnvelopePaths(oneLane({ seat: "" }), ["/lanes/0/seat"]);
  });

  it("rejects a seat that is not a string", () => {
    expectEnvelopePaths(oneLane({ seat: 7 }), ["/lanes/0/seat"]);
  });

  it("rejects a control character in a seat", () => {
    expectEnvelopePaths(oneLane({ seat: `alpha${BELL}` }), ["/lanes/0/seat"]);
    expectEnvelopePaths(oneLane({ seat: `alpha${DEL}` }), ["/lanes/0/seat"]);
  });

  it("rejects an unknown lane key", () => {
    expectEnvelopePaths(oneLane({ extra: "no" }), ["/lanes/0/extra"]);
  });
});

describe("validateEnvelope lane reported", () => {
  it("accepts a reported block without its optional fields", () => {
    const lane = expectValidEnvelope(withReported({})).lanes[0];
    expect(lane?.reported?.stage).toBe("build");
    expect(lane?.reported?.pr).toBeUndefined();
  });

  it("rejects a reported block that is not an object", () => {
    expectEnvelopePaths(oneLane({ reported: "started" }), [
      "/lanes/0/reported",
    ]);
    expectEnvelopePaths(oneLane({ reported: [] }), ["/lanes/0/reported"]);
  });

  it("rejects an unknown reported key", () => {
    expectEnvelopePaths(withReported({ extra: 1 }), [
      "/lanes/0/reported/extra",
    ]);
  });

  it("requires a stage", () => {
    expectEnvelopePaths(withReported({ stage: undefined }), [
      "/lanes/0/reported/stage",
    ]);
    expectEnvelopePaths(withReported({ stage: 3 }), [
      "/lanes/0/reported/stage",
    ]);
  });

  it("accepts a stage of 32 characters", () => {
    expect(
      expectValidEnvelope(withReported({ stage: `a${"b".repeat(31)}` }))
        .lanes[0]?.reported?.stage,
    ).toBe(`a${"b".repeat(31)}`);
  });

  it("accepts a stage with a trailing dash", () => {
    expect(
      expectValidEnvelope(withReported({ stage: "review-" })).lanes[0]?.reported
        ?.stage,
    ).toBe("review-");
  });

  it("rejects a stage of 33 characters", () => {
    expectEnvelopePaths(withReported({ stage: `a${"b".repeat(32)}` }), [
      "/lanes/0/reported/stage",
    ]);
  });

  it("rejects a stage that is not a lower case slug", () => {
    expectEnvelopePaths(withReported({ stage: "Review" }), [
      "/lanes/0/reported/stage",
    ]);
    expectEnvelopePaths(withReported({ stage: "1review" }), [
      "/lanes/0/reported/stage",
    ]);
    expectEnvelopePaths(withReported({ stage: "-review" }), [
      "/lanes/0/reported/stage",
    ]);
    expectEnvelopePaths(withReported({ stage: "re view" }), [
      "/lanes/0/reported/stage",
    ]);
  });

  it.each(["started", "settled", "failed"])("accepts the event %s", (event) => {
    expect(
      expectValidEnvelope(withReported({ event })).lanes[0]?.reported?.event,
    ).toBe(event);
  });

  it("rejects an unknown event", () => {
    expectEnvelopePaths(withReported({ event: "done" }), [
      "/lanes/0/reported/event",
    ]);
    expectEnvelopePaths(withReported({ event: 1 }), [
      "/lanes/0/reported/event",
    ]);
  });

  it("requires a UTC ts", () => {
    expectEnvelopePaths(withReported({ ts: undefined }), [
      "/lanes/0/reported/ts",
    ]);
    expectEnvelopePaths(withReported({ ts: "2026-10-01T11:00:00" }), [
      "/lanes/0/reported/ts",
    ]);
    expectEnvelopePaths(withReported({ ts: "yesterday" }), [
      "/lanes/0/reported/ts",
    ]);
    expectEnvelopePaths(withReported({ ts: 1767225600000 }), [
      "/lanes/0/reported/ts",
    ]);
  });

  it("accepts a pull request number of one or more", () => {
    expect(
      expectValidEnvelope(withReported({ pr: 1 })).lanes[0]?.reported?.pr,
    ).toBe(1);
    expect(
      expectValidEnvelope(withReported({ pr: 9000 })).lanes[0]?.reported?.pr,
    ).toBe(9000);
  });

  it("rejects a pull request number below one", () => {
    expectEnvelopePaths(withReported({ pr: 0 }), ["/lanes/0/reported/pr"]);
    expectEnvelopePaths(withReported({ pr: -1 }), ["/lanes/0/reported/pr"]);
  });

  it("rejects a pull request number that is not an integer", () => {
    expectEnvelopePaths(withReported({ pr: 1.5 }), ["/lanes/0/reported/pr"]);
    expectEnvelopePaths(withReported({ pr: "1" }), ["/lanes/0/reported/pr"]);
  });

  it("accepts a round of zero or more", () => {
    expect(
      expectValidEnvelope(withReported({ round: 0 })).lanes[0]?.reported?.round,
    ).toBe(0);
  });

  it("rejects a negative round", () => {
    expectEnvelopePaths(withReported({ round: -1 }), [
      "/lanes/0/reported/round",
    ]);
  });

  it("rejects a round that is not an integer", () => {
    expectEnvelopePaths(withReported({ round: 0.5 }), [
      "/lanes/0/reported/round",
    ]);
  });

  it("accepts a detail object of scalars, arrays and nested objects", () => {
    const detail = {
      counts: [1, 2, 3],
      nested: { ok: true, missing: null },
      note: "line one\nline two\tindented",
    };
    expect(
      expectValidEnvelope(withReported({ detail })).lanes[0]?.reported?.detail,
    ).toEqual(detail);
  });

  it("rejects a detail that is not an object", () => {
    expectEnvelopePaths(withReported({ detail: [] }), [
      "/lanes/0/reported/detail",
    ]);
    expectEnvelopePaths(withReported({ detail: "text" }), [
      "/lanes/0/reported/detail",
    ]);
    expectEnvelopePaths(withReported({ detail: null }), [
      "/lanes/0/reported/detail",
    ]);
  });

  it("accepts a detail of exactly 8192 serialized bytes", () => {
    const detail = detailOfBytes(8192);
    expect(serializedBytes(detail)).toBe(8192);
    expect(
      expectValidEnvelope(withReported({ detail })).lanes[0]?.reported?.detail,
    ).toEqual(detail);
  });

  it("rejects a detail of 8193 serialized bytes", () => {
    expectEnvelopePaths(withReported({ detail: detailOfBytes(8193) }), [
      "/lanes/0/reported/detail",
    ]);
  });

  it("rejects a detail that cannot be serialised", () => {
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;
    expectEnvelopePaths(withReported({ detail: circular }), [
      "/lanes/0/reported/detail",
    ]);
  });

  it("rejects a detail whose toJSON erases it", () => {
    expectEnvelopePaths(withReported({ detail: { toJSON: () => undefined } }), [
      "/lanes/0/reported/detail",
    ]);
  });

  it("rejects a control character inside a detail string", () => {
    expectEnvelopePaths(withReported({ detail: { note: `a${BELL}` } }), [
      "/lanes/0/reported/detail",
    ]);
    expectEnvelopePaths(withReported({ detail: { note: `a${DEL}` } }), [
      "/lanes/0/reported/detail",
    ]);
    expectEnvelopePaths(
      withReported({ detail: { lines: ["ok", `bad${BELL}`] } }),
      ["/lanes/0/reported/detail"],
    );
    expectEnvelopePaths(
      withReported({ detail: { nested: { note: `bad${BELL}` } } }),
      ["/lanes/0/reported/detail"],
    );
  });

  it("does not throw on adversarial input", () => {
    expect(() =>
      validateEnvelope(withReported({ detail: { toJSON: 1 } })),
    ).not.toThrow();
  });
});

describe("validateEnvelope lane disagreements", () => {
  it("accepts an empty list", () => {
    expect(expectValidEnvelope(oneLane()).lanes[0]?.disagreements).toEqual([]);
  });

  it("accepts 20 disagreements of 300 characters", () => {
    const disagreements = Array.from({ length: 20 }, () => "d".repeat(300));
    expect(
      expectValidEnvelope(oneLane({ disagreements })).lanes[0]?.disagreements,
    ).toEqual(disagreements);
  });

  it("rejects more than 20 disagreements", () => {
    expectEnvelopePaths(
      oneLane({
        disagreements: Array.from({ length: 21 }, (_u, i) => `d${i}`),
      }),
      ["/lanes/0/disagreements"],
    );
  });

  it("rejects disagreements that are not an array", () => {
    expectEnvelopePaths(oneLane({ disagreements: "none" }), [
      "/lanes/0/disagreements",
    ]);
  });

  it("rejects a disagreement of 301 characters", () => {
    expectEnvelopePaths(oneLane({ disagreements: ["d".repeat(301)] }), [
      "/lanes/0/disagreements/0",
    ]);
  });

  it("rejects a disagreement that is not a string", () => {
    expectEnvelopePaths(oneLane({ disagreements: [7] }), [
      "/lanes/0/disagreements/0",
    ]);
  });

  it("rejects a control character or a line feed in a disagreement", () => {
    expectEnvelopePaths(oneLane({ disagreements: [`a${BELL}`] }), [
      "/lanes/0/disagreements/0",
    ]);
    expectEnvelopePaths(oneLane({ disagreements: ["a\nb"] }), [
      "/lanes/0/disagreements/0",
    ]);
  });
});

describe("validateEnvelope lane derived", () => {
  it("accepts a minimal derived block", () => {
    expect(expectValidEnvelope(oneLane()).lanes[0]?.derived).toEqual({
      alive: true,
    });
  });

  it("requires the derived block", () => {
    expectEnvelopePaths(oneLane({ derived: undefined }), ["/lanes/0/derived"]);
    expectEnvelopePaths(oneLane({ derived: true }), ["/lanes/0/derived"]);
  });

  it("rejects an unknown derived key", () => {
    expectEnvelopePaths(laneWithDerived({ extra: 1 }), [
      "/lanes/0/derived/extra",
    ]);
  });
});
