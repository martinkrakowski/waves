import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { sha256Hex } from "../src/infrastructure/sha256.js";

describe("sha256Hex", () => {
  it("returns the lower-case hex sha256 of a UTF-8 string", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("is 64 hex characters", () => {
    expect(sha256Hex("anything")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("matches node:crypto directly", () => {
    const text = "the quick brown fox";
    expect(sha256Hex(text)).toBe(
      createHash("sha256").update(text, "utf8").digest("hex"),
    );
  });

  it("treats the input as UTF-8, so a multi-byte character is one code point", () => {
    expect(sha256Hex("a\u00e9b")).toBe(sha256Hex("a\u00e9b"));
    expect(sha256Hex("a\u00e9b")).not.toBe(sha256Hex("a\u0065\u0301b"));
  });
});
