import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
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
    if (!isNoteName(project) || !isNoteName(name)) {
      return false;
    }
    if (Buffer.byteLength(text, "utf8") > this.#cap) {
      return false;
    }
    const dir = join(this.#dataDir, "notes", project);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const target = join(dir, name);
    const temp = `${target}.tmp`;
    await writeFile(temp, text, { mode: 0o600 });
    await rename(temp, target);
    return true;
  }

  async getNote(project: string, name: string): Promise<string | undefined> {
    if (!isNoteName(project) || !isNoteName(name)) {
      return undefined;
    }
    return readFile(join(this.#dataDir, "notes", project, name), "utf8");
  }
}
