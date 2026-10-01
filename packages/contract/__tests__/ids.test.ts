import { describe, expect, it } from "vitest";

import { isLaneId, isProjectId, isWaveId } from "../src/index.js";

describe("isProjectId", () => {
  it("accepts a single lowercase character", () => {
    expect(isProjectId("a")).toBe(true);
  });

  it("accepts digits and dashes after the first character", () => {
    expect(isProjectId("alpha-9")).toBe(true);
  });

  it("accepts the longest project id", () => {
    expect(isProjectId(`a${"b".repeat(62)}`)).toBe(true);
  });

  it("rejects the empty string", () => {
    expect(isProjectId("")).toBe(false);
  });

  it("rejects a project id one character too long", () => {
    expect(isProjectId("a".repeat(64))).toBe(false);
  });

  it("rejects upper case characters", () => {
    expect(isProjectId("Alpha")).toBe(false);
  });

  it("rejects a leading dash", () => {
    expect(isProjectId("-alpha")).toBe(false);
  });

  it("rejects an underscore", () => {
    expect(isProjectId("alpha_9")).toBe(false);
  });
});

describe("isWaveId", () => {
  it("accepts a lowercase slug", () => {
    expect(isWaveId("wv1")).toBe(true);
  });

  it("accepts upper case, dashes and underscores", () => {
    expect(isWaveId("WV_1-a")).toBe(true);
  });

  it("accepts the longest wave id", () => {
    expect(isWaveId(`a${"b".repeat(79)}`)).toBe(true);
  });

  it("rejects the empty string", () => {
    expect(isWaveId("")).toBe(false);
  });

  it("rejects a wave id one character too long", () => {
    expect(isWaveId("a".repeat(81))).toBe(false);
  });

  it("rejects a slash", () => {
    expect(isWaveId("wv/1")).toBe(false);
  });

  it("rejects a dot", () => {
    expect(isWaveId("..")).toBe(false);
  });

  it("rejects a leading dash", () => {
    expect(isWaveId("-wv1")).toBe(false);
  });
});

describe("isLaneId", () => {
  it("accepts an underscore separated id", () => {
    expect(isLaneId("lane_1")).toBe(true);
  });

  it("accepts the longest lane id", () => {
    expect(isLaneId(`a${"b".repeat(79)}`)).toBe(true);
  });

  it("rejects the empty string", () => {
    expect(isLaneId("")).toBe(false);
  });

  it("rejects a lane id one character too long", () => {
    expect(isLaneId("a".repeat(81))).toBe(false);
  });

  it("rejects a dot", () => {
    expect(isLaneId("lane.1")).toBe(false);
  });

  it("rejects a leading underscore", () => {
    expect(isLaneId("_lane")).toBe(false);
  });
});
