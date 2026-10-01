import { readFile } from "node:fs/promises";

import { ADMIN_TOKEN_FILE_VARIABLE } from "../application/config.js";
import { TOKEN_PATTERN } from "../application/bearer.js";

export type AdminToken =
  | { readonly kind: "enabled"; readonly token: string }
  | { readonly kind: "absent" };

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

/**
 * Reads the admin token from the file it is mounted as. A missing file is not an
 * error: it means the operator mounted no admin secret, so the admin routes are
 * disabled and answer 404 exactly as an unknown path does. Any other read
 * failure, and a token outside the grammar, is a configuration problem the
 * process must refuse to start on. The token is never logged.
 */
export async function readAdminToken(path: string): Promise<AdminToken> {
  const raw = await readFile(path, "utf8").catch((error: unknown) => {
    if (errorCode(error) === "ENOENT") {
      return undefined;
    }
    throw new Error(
      `${ADMIN_TOKEN_FILE_VARIABLE} ${path} cannot be read: ${(error as Error).message}`,
    );
  });
  if (raw === undefined) {
    return { kind: "absent" };
  }
  const token = raw.trim();
  if (!TOKEN_PATTERN.test(token)) {
    throw new Error(
      `${ADMIN_TOKEN_FILE_VARIABLE} must hold 32 to 128 characters of A-Z, a-z, 0-9, _ and -`,
    );
  }
  return { kind: "enabled", token };
}
