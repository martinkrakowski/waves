import { readFile } from "node:fs/promises";

import { READ_TOKEN_FILE_VARIABLE } from "../application/config.js";

/**
 * Reads the read token from a file whose trimmed content is the password. The
 * file keeps the secret out of the process environment, where any co-tenant of
 * the host could read it from `/proc`.
 */
export async function readReadToken(path: string): Promise<string> {
  const raw = await readFile(path, "utf8").catch((error: unknown) => {
    throw new Error(
      `${READ_TOKEN_FILE_VARIABLE} ${path} cannot be read: ${(error as Error).message}`,
    );
  });
  const token = raw.trim();
  if (token === "") {
    throw new Error(`${READ_TOKEN_FILE_VARIABLE} is empty`);
  }
  return token;
}
