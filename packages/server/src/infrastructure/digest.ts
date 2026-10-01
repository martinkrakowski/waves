import { randomBytes, timingSafeEqual } from "node:crypto";

import type { Digest } from "../application/bearer.js";

/**
 * The default comparer every authentication goes through. `timingSafeEqual`
 * compares in time that does not depend on where the first difference is, and
 * it throws `RangeError` on digests of different lengths rather than comparing
 * a prefix of them.
 */
export function digestsEqual(a: Digest, b: Digest): boolean {
  return timingSafeEqual(a, b);
}

/**
 * A project token: 32 random bytes in base64url, which is 43 characters and
 * inside the grammar a bearer token has to match.
 */
export function mintToken(): string {
  return randomBytes(32).toString("base64url");
}
