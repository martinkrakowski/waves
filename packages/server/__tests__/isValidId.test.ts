import { describe, expect, it } from "vitest";

import { isValidId } from "../src/index.js";

describe("isValidId", () => {
  it("accepts a lowercase slug", () => {
    expect(isValidId("project-alpha")).toBe(true);
  });

  it("rejects a slug longer than 63 characters", () => {
    expect(isValidId("a".repeat(64))).toBe(false);
  });

  it("rejects a slug that starts with a dash", () => {
    expect(isValidId("-nope")).toBe(false);
  });

  it("rejects a slug with upper case characters", () => {
    expect(isValidId("Nope")).toBe(false);
  });

  it("accepts a slug of exactly 63 characters", () => {
    expect(isValidId("a".repeat(63))).toBe(true);
  });
});
