import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** One free-text note per project, kept beside its snapshots. */
export class NoteStore {
  readonly #dataDir: string;

  constructor(dataDir: string) {
    this.#dataDir = dataDir;
  }

  async putNote(project: string, name: string, text: string): Promise<void> {
    await writeFile(join(this.#dataDir, "notes", project, name), text);
  }

  async getNote(project: string, name: string): Promise<string> {
    return readFile(join(this.#dataDir, "notes", project, name), "utf8");
  }
}

/** Whether the bearer token a request carried may write this project's note. */
export function mayWriteNote(
  presented: string | undefined,
  projectToken: string,
  maxBytes: number | undefined,
  body: string,
): boolean {
  if (presented !== undefined && presented !== projectToken) {
    return false;
  }
  if (maxBytes && body.length > maxBytes) {
    return false;
  }
  return true;
}
