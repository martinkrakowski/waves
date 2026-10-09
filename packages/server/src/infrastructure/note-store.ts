import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { isNoteName, noteCap } from "./note-names.js";

/** One free-text note per project, kept beside its snapshots. */
export class NoteStore {
  readonly #dataDir: string;
  readonly #cap: number;

  constructor(dataDir: string, capSetting: string | undefined) {
    this.#dataDir = dataDir;
    this.#cap = noteCap(capSetting);
  }

  async putNote(project: string, name: string, text: string): Promise<boolean> {
    if (!isNoteName(name)) {
      return false;
    }
    if (text.length > this.#cap) {
      return false;
    }
    await writeFile(join(this.#dataDir, "notes", project, name), text);
    return true;
  }

  async getNote(project: string, name: string): Promise<string | undefined> {
    if (!isNoteName(name)) {
      return undefined;
    }
    return readFile(join(this.#dataDir, "notes", project, name), "utf8");
  }
}

/** Whether the bearer token a request carried may write this project's note. */
export function mayWriteNote(
  presented: string | undefined,
  tokens: ReadonlyMap<string, string>,
): boolean {
  for (const token of tokens.values()) {
    if (presented === token) {
      return true;
    }
  }
  return false;
}
