import { readFile } from "node:fs/promises";

import {
  ADMIN_TOKEN_FILE_VARIABLE,
  ENROLL_TOKEN_FILE_VARIABLE,
} from "../application/config.js";
import { TOKEN_PATTERN } from "../application/bearer.js";
import { digestsEqual } from "./digest.js";
import { sha256 } from "./http-security.js";

export type AdminToken =
  | { readonly kind: "enabled"; readonly token: string }
  | { readonly kind: "absent" };

/** The two service tokens are the same kind of file; only their names differ. */
export type SecretToken = AdminToken;

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

/**
 * Reads one of the service's own tokens from the file it is mounted as. A
 * missing file is not an error: it means the operator mounted no such secret, so
 * what that token could do is disabled and the route answers as an unknown path
 * does. Any other read failure, and a token outside the grammar, is a
 * configuration problem the process must refuse to start on. Every message
 * names the variable that pointed at the file, and the token itself is never
 * logged, printed or put in a message.
 */
async function readSecretFile(
  path: string,
  variable: string,
): Promise<SecretToken> {
  const raw = await readFile(path, "utf8").catch((error: unknown) => {
    if (errorCode(error) === "ENOENT") {
      return undefined;
    }
    throw new Error(
      `${variable} ${path} cannot be read: ${(error as Error).message}`,
    );
  });
  if (raw === undefined) {
    return { kind: "absent" };
  }
  const token = raw.trim();
  if (!TOKEN_PATTERN.test(token)) {
    throw new Error(
      `${variable} must hold 32 to 128 characters of A-Z, a-z, 0-9, _ and -`,
    );
  }
  return { kind: "enabled", token };
}

/**
 * The admin token answers both admin routes. When its file is absent, or names
 * a file that does not exist, they are disabled and answer 404.
 */
export async function readAdminToken(path: string): Promise<SecretToken> {
  return readSecretFile(path, ADMIN_TOKEN_FILE_VARIABLE);
}

/**
 * The enrollment token answers one thing: registering a project that does not
 * exist yet. It is optional, and when its file is absent enrollment is disabled
 * and `POST /api/v1/projects` is answered by the admin token alone.
 */
export async function readEnrollToken(path: string): Promise<SecretToken> {
  return readSecretFile(path, ENROLL_TOKEN_FILE_VARIABLE);
}

/**
 * Whether two tokens are the same value, compared as digests through
 * `timingSafeEqual` and never as strings: an enrollment file that held the admin
 * token would carry every admin power to wherever the enrollment copy lives, so
 * the process refuses to start rather than run with two names for one secret.
 * The two values are of different shapes, which the digests absorb.
 */
export function sameToken(a: string, b: string): boolean {
  return digestsEqual(sha256(a), sha256(b));
}
