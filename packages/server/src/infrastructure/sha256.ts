import { createHash } from "node:crypto";

/**
 * The lower-case hex SHA-256 of a UTF-8 string: the hash the notice write model
 * takes as `hashText`, and never computes itself, because hashing is an
 * adapter's work (`node:crypto`) and the application layer must not import it.
 *
 * It is not the `sha256` of `http-security.ts`, which returns a `Buffer` for the
 * constant-time token comparison; this one returns the hex string the contract
 * and the write model pass back to a writer.
 */
export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
