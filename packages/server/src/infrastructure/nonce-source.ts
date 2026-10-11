import { randomBytes } from "node:crypto";

/**
 * A fresh nonce value: 32 random bytes as base64url, which is 43 characters
 * and an alphabet a URL or a JSON body carries unchanged. Randomness is an
 * adapter's work (`node:crypto`), so the application layer holds only the
 * `NonceSource` type and is handed this function.
 */
export function randomNonce(): string {
  return randomBytes(32).toString("base64url");
}
