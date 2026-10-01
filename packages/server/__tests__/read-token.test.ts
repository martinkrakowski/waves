import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { READ_TOKEN_FILE_VARIABLE } from "../src/application/config.js";
import { readReadToken } from "../src/infrastructure/read-token.js";

const directories: string[] = [];

async function tokenFile(content: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "waves-token-"));
  directories.push(directory);
  const path = join(directory, "read-token");
  await writeFile(path, content, { encoding: "utf8", mode: 0o600 });
  return path;
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("readReadToken", () => {
  it("returns the trimmed content of the file", async () => {
    const path = await tokenFile("  s3cret-token\n");

    await expect(readReadToken(path)).resolves.toBe("s3cret-token");
  });

  it("refuses a file that holds only whitespace", async () => {
    const path = await tokenFile("\n\t \n");

    await expect(readReadToken(path)).rejects.toThrow(
      `${READ_TOKEN_FILE_VARIABLE} is empty`,
    );
  });

  it("propagates the failure to read the file", async () => {
    const path = await tokenFile("s3cret-token");

    await expect(readReadToken(`${path}.absent`)).rejects.toThrow(
      `${READ_TOKEN_FILE_VARIABLE} ${path}.absent cannot be read`,
    );
    await expect(readReadToken(`${path}.absent`)).rejects.toThrow(/ENOENT/);
  });
});
