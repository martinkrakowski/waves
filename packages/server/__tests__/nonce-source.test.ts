import { describe, expect, it } from "vitest";

import { randomNonce } from "../src/infrastructure/nonce-source.js";

/** The length 32 random bytes take as base64url, with no padding. */
const BASE64URL_LENGTH = 43;

describe("randomNonce", () => {
  it("answers 43 characters of the base64url alphabet", () => {
    const nonce = randomNonce();

    expect(nonce).toHaveLength(BASE64URL_LENGTH);
    expect(nonce).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("answers a different value on every call", () => {
    expect(randomNonce()).not.toBe(randomNonce());
  });
});
