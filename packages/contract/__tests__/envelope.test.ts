import { describe, expect, it } from "vitest";

import { validateEnvelope } from "../src/index.js";
import {
  BELL,
  DEL,
  errorsOf,
  expectEnvelopePaths,
  expectValidEnvelope,
  fullEnvelope,
  minimalEnvelope,
  minimalLane,
  oneLane,
} from "./support.js";

describe("validateEnvelope", () => {
  it("accepts a minimal envelope", () => {
    expect(expectValidEnvelope(minimalEnvelope())).toEqual(minimalEnvelope());
  });

  it("accepts a full envelope and returns it unchanged", () => {
    expect(expectValidEnvelope(fullEnvelope())).toEqual(fullEnvelope());
  });

  it("rejects a null root with a single root error", () => {
    expectEnvelopePaths(null, [""]);
  });

  it("rejects an array root with a single root error", () => {
    expectEnvelopePaths([], [""]);
  });

  it("rejects a string root with a single root error", () => {
    expectEnvelopePaths("waves/v1", [""]);
  });

  it("reports a message for every error", () => {
    const issues = errorsOf(validateEnvelope(null));
    expect(issues.map((issue) => issue.message)).toEqual([
      "expected an object",
    ]);
  });

  it("requires the waves/v1 schema", () => {
    expectEnvelopePaths({ ...minimalEnvelope(), schema: "waves/v2" }, [
      "/schema",
    ]);
    expectEnvelopePaths({ ...minimalEnvelope(), schema: undefined }, [
      "/schema",
    ]);
    expectEnvelopePaths({ ...minimalEnvelope(), schema: 7 }, ["/schema"]);
  });

  it("rejects an unknown key at the root", () => {
    expectEnvelopePaths({ ...minimalEnvelope(), extra: true }, ["/extra"]);
  });

  it("escapes a slash and a tilde in an unknown key", () => {
    expectEnvelopePaths({ ...minimalEnvelope(), "a~/b": true }, ["/a~0~1b"]);
  });

  it("requires a project id", () => {
    expectEnvelopePaths({ ...minimalEnvelope(), project: undefined }, [
      "/project",
    ]);
    expectEnvelopePaths({ ...minimalEnvelope(), project: 3 }, ["/project"]);
    expectEnvelopePaths({ ...minimalEnvelope(), project: "Alpha" }, [
      "/project",
    ]);
    expectEnvelopePaths({ ...minimalEnvelope(), project: "a".repeat(64) }, [
      "/project",
    ]);
  });

  it("requires a wave id", () => {
    expectEnvelopePaths({ ...minimalEnvelope(), wave: undefined }, ["/wave"]);
    expectEnvelopePaths({ ...minimalEnvelope(), wave: true }, ["/wave"]);
    expectEnvelopePaths({ ...minimalEnvelope(), wave: "wv/1" }, ["/wave"]);
    expectEnvelopePaths({ ...minimalEnvelope(), wave: "a".repeat(81) }, [
      "/wave",
    ]);
  });

  it("requires a UTC generatedAt", () => {
    expectEnvelopePaths({ ...minimalEnvelope(), generatedAt: undefined }, [
      "/generatedAt",
    ]);
    expectEnvelopePaths({ ...minimalEnvelope(), generatedAt: 1767225600000 }, [
      "/generatedAt",
    ]);
    expectEnvelopePaths(
      { ...minimalEnvelope(), generatedAt: "2026-10-01T12:00:00" },
      ["/generatedAt"],
    );
  });

  it.each([
    "2026-10-01 12:00Z",
    "2026-10-01Z",
    "Oct 1 2026Z",
    "2026-10-01t12:00:00z",
    "2026-10-01T12:00:00.1234Z",
    "2026-13-45T99:99:99Z",
    "2026-99-99T99:99:99Z",
    "2026-02-30T00:00:00Z",
  ])("rejects the non UTC timestamp %j", (generatedAt) => {
    expectEnvelopePaths({ ...minimalEnvelope(), generatedAt }, [
      "/generatedAt",
    ]);
  });

  it.each([
    "2026-10-01T12:00:00Z",
    "2026-10-01T12:00:00.123Z",
    "2026-02-28T23:59:59Z",
  ])("accepts the UTC timestamp %j", (generatedAt) => {
    expect(
      expectValidEnvelope({ ...minimalEnvelope(), generatedAt }).generatedAt,
    ).toBe(generatedAt);
  });

  it("checks the timestamp length before its characters", () => {
    expectEnvelopePaths(
      { ...minimalEnvelope(), generatedAt: `2026-10-01T12:00:00Z${BELL}pad` },
      ["/generatedAt"],
    );
  });

  it("rejects a control character in generatedAt", () => {
    expectEnvelopePaths(
      { ...minimalEnvelope(), generatedAt: `2026-10-01T12:00:00Z${BELL}` },
      ["/generatedAt"],
    );
    expectEnvelopePaths(
      { ...minimalEnvelope(), generatedAt: `2026-10-01T12:00:00Z${DEL}` },
      ["/generatedAt"],
    );
  });

  it("allows a null interval", () => {
    expect(
      expectValidEnvelope({ ...minimalEnvelope(), intervalSeconds: null })
        .intervalSeconds,
    ).toBeNull();
  });

  it("allows an interval of 1 to 300 seconds", () => {
    expect(
      expectValidEnvelope({ ...minimalEnvelope(), intervalSeconds: 1 })
        .intervalSeconds,
    ).toBe(1);
    expect(
      expectValidEnvelope({ ...minimalEnvelope(), intervalSeconds: 300 })
        .intervalSeconds,
    ).toBe(300);
  });

  it("rejects an interval outside 1 to 300", () => {
    expectEnvelopePaths({ ...minimalEnvelope(), intervalSeconds: 0 }, [
      "/intervalSeconds",
    ]);
    expectEnvelopePaths({ ...minimalEnvelope(), intervalSeconds: 301 }, [
      "/intervalSeconds",
    ]);
  });

  it("rejects an interval that is not an integer", () => {
    expectEnvelopePaths({ ...minimalEnvelope(), intervalSeconds: 10.5 }, [
      "/intervalSeconds",
    ]);
  });

  it("rejects a missing interval", () => {
    expectEnvelopePaths({ ...minimalEnvelope(), intervalSeconds: undefined }, [
      "/intervalSeconds",
    ]);
    expectEnvelopePaths({ ...minimalEnvelope(), intervalSeconds: "10" }, [
      "/intervalSeconds",
    ]);
  });

  it("requires the lanes to be an array", () => {
    expectEnvelopePaths({ ...minimalEnvelope(), lanes: undefined }, ["/lanes"]);
    expectEnvelopePaths({ ...minimalEnvelope(), lanes: {} }, ["/lanes"]);
  });

  it("allows 200 lanes", () => {
    const lanes = Array.from({ length: 200 }, (_unused, index) =>
      minimalLane({ id: `lane-${index}` }),
    );
    expect(
      expectValidEnvelope({ ...minimalEnvelope(), lanes }).lanes,
    ).toHaveLength(200);
  });

  it("rejects more than 200 lanes", () => {
    const lanes = Array.from({ length: 201 }, (_unused, index) =>
      minimalLane({ id: `lane-${index}` }),
    );
    expectEnvelopePaths({ ...minimalEnvelope(), lanes }, ["/lanes"]);
  });

  it("rejects a lane that is not an object", () => {
    expectEnvelopePaths({ ...minimalEnvelope(), lanes: ["lane-1"] }, [
      "/lanes/0",
    ]);
  });

  it("requires a lane id", () => {
    expectEnvelopePaths(oneLane({ id: undefined }), ["/lanes/0/id"]);
    expectEnvelopePaths(oneLane({ id: 4 }), ["/lanes/0/id"]);
    expectEnvelopePaths(oneLane({ id: "lane 1" }), ["/lanes/0/id"]);
    expectEnvelopePaths(oneLane({ id: "a".repeat(81) }), ["/lanes/0/id"]);
  });

  it("collects every independent error with its own pointer", () => {
    expectEnvelopePaths(
      {
        ...minimalEnvelope(),
        schema: "waves/v2",
        project: "Alpha",
        wave: "wv/1",
        lanes: [minimalLane({ id: "bad id" })],
      },
      ["/schema", "/project", "/wave", "/lanes/0/id"],
    );
  });

  it("collects at most 50 errors", () => {
    const lanes = Array.from({ length: 60 }, () =>
      minimalLane({ id: "not a lane id" }),
    );
    expect(
      errorsOf(validateEnvelope({ ...minimalEnvelope(), lanes })),
    ).toHaveLength(50);
  });
});
