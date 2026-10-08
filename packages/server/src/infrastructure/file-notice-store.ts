import { randomUUID } from "node:crypto";
import type { Stats } from "node:fs";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import type {
  AppendOutcome,
  NoticeStorePort,
  StoredDecision,
  StoredEntry,
  StoredEvent,
  StoredRevision,
} from "../application/ports/notice-store.js";
import { assertIds, assertNoticeIds } from "./ids.js";
import { assertRealDirectory, errorCode } from "./store-helpers.js";

const DATA_DIR_MODE = 0o700;
const FILE_MODE = 0o600;
const DECISIONS_DIR = "decisions";
const EVENTS_DIR = "events";
const SNAPSHOT_SUFFIX = ".json";

function ignore(): undefined {
  return undefined;
}

function isDecisionName(name: string): boolean {
  return name.endsWith(SNAPSHOT_SUFFIX);
}

/**
 * Writes the notice files of a decision and the events of a project under one
 * data directory — `decisions/<project>/<id>.json` (one file per decision,
 * written atomically) and `events/<project>.json` (one per project). It reuses
 * the file store's directory checks and its atomic temp-file-and-rename write,
 * and serialises its appends the same way `createProject` does: nothing is
 * awaited between the read and the write of one append, so two writers that
 * read the same count cannot both pass.
 */
export class FileNoticeStore implements NoticeStorePort {
  readonly #dataDir: string;
  #queue: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    this.#dataDir = dataDir;
  }

  async getDecision(
    project: string,
    id: string,
  ): Promise<StoredDecision | undefined> {
    assertNoticeIds(project, id);
    await this.#checkedDataDir(false);
    await this.#assertDecisionDir(project);
    const raw = await this.#readText(this.#decisionPath(project, id));
    if (raw === undefined) {
      return undefined;
    }
    return JSON.parse(raw) as StoredDecision;
  }

  async listDecisions(project: string): Promise<readonly StoredDecision[]> {
    assertIds(project);
    await this.#checkedDataDir(false);
    await this.#assertDecisionDir(project);
    const dir = this.#projectDecisionsDir(project);
    const names = await this.#decisionNames(dir);
    const decisions: StoredDecision[] = [];
    for (const name of names) {
      const raw = await this.#readText(join(dir, name));
      if (raw !== undefined) {
        decisions.push(JSON.parse(raw) as StoredDecision);
      }
    }
    return decisions.sort(byDecisionId);
  }

  async appendRevision(
    project: string,
    id: string,
    revision: StoredRevision,
    expectRevisions: number,
    ceiling: number,
  ): Promise<AppendOutcome> {
    assertNoticeIds(project, id);
    return this.#serialised(async () => {
      await this.#checkedDataDir(true);
      await this.#directoryForWrite(this.#decisionsDir());
      const dir = this.#projectDecisionsDir(project);
      await this.#directoryForWrite(dir);
      const raw = await this.#readText(this.#decisionPath(project, id));
      if (raw === undefined) {
        if (expectRevisions !== 0) {
          return "conflict";
        }
        if ((await this.#decisionCount(project)) >= ceiling) {
          return "ceiling";
        }
        await this.#writeAtomic(
          this.#decisionPath(project, id),
          JSON.stringify(
            {
              project,
              id,
              revisions: [revision],
              entries: [],
            } satisfies StoredDecision,
            null,
            2,
          ),
        );
        return "stored";
      }
      const stored = JSON.parse(raw) as StoredDecision;
      if (stored.revisions.length !== expectRevisions) {
        return "conflict";
      }
      stored.revisions.push(revision);
      await this.#writeAtomic(
        this.#decisionPath(project, id),
        JSON.stringify(stored, null, 2),
      );
      return "stored";
    });
  }

  async appendEntry(
    project: string,
    id: string,
    entry: StoredEntry,
    expectEntries: number,
  ): Promise<AppendOutcome> {
    assertNoticeIds(project, id);
    return this.#serialised(async () => {
      await this.#checkedDataDir(false);
      await this.#assertDecisionDir(project);
      const path = this.#decisionPath(project, id);
      const raw = await this.#readText(path);
      if (raw === undefined) {
        return "missing";
      }
      const stored = JSON.parse(raw) as StoredDecision;
      if (stored.entries.length !== expectEntries) {
        return "conflict";
      }
      stored.entries.push(entry);
      await this.#writeAtomic(path, JSON.stringify(stored, null, 2));
      return "stored";
    });
  }

  async appendEvent(
    project: string,
    stored: StoredEvent,
    keep: number,
  ): Promise<{ dropped: number }> {
    assertIds(project);
    return this.#serialised(async () => {
      await this.#checkedDataDir(true);
      const eventsDir = this.#eventsDir();
      await this.#directoryForWrite(eventsDir);
      const path = this.#eventsPath(project);
      const raw = await this.#readText(path);
      const current: StoredEvent[] =
        raw === undefined ? [] : (JSON.parse(raw) as StoredEvent[]);
      current.push(stored);
      const dropped = Math.max(0, current.length - keep);
      const kept = current.slice(dropped);
      await this.#writeAtomic(path, JSON.stringify(kept, null, 2));
      return { dropped };
    });
  }

  async listEvents(
    project: string,
    limit: number,
  ): Promise<readonly StoredEvent[]> {
    assertIds(project);
    await this.#checkedDataDir(false);
    await this.#assertEventsDir();
    const raw = await this.#readText(this.#eventsPath(project));
    if (raw === undefined) {
      return [];
    }
    const events = (JSON.parse(raw) as StoredEvent[]).reverse();
    return limit < 0 ? events : events.slice(0, limit);
  }

  async deleteNotices(project: string): Promise<void> {
    assertIds(project);
    return this.#serialised(async () => {
      await this.#checkedDataDir(false);
      await this.#assertRealDirectoryOrAbsent(this.#decisionsDir());
      await this.#assertRealDirectoryOrAbsent(this.#eventsDir());
      await rm(this.#projectDecisionsDir(project), {
        recursive: true,
        force: true,
      });
      await rm(this.#eventsPath(project), { force: true });
    });
  }

  #serialised<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(operation);
    this.#queue = run.then(ignore, ignore);
    return run;
  }

  async #checkedDataDir(create: boolean): Promise<void> {
    const info = await this.#lstatOrUndefined(this.#dataDir);
    if (info === undefined) {
      if (create) {
        await mkdir(this.#dataDir, { mode: DATA_DIR_MODE });
      }
      return;
    }
    assertRealDirectory(info, this.#dataDir);
  }

  async #directoryForWrite(dir: string): Promise<void> {
    const info = await this.#lstatOrUndefined(dir);
    if (info === undefined) {
      await mkdir(dir, { mode: DATA_DIR_MODE });
      return;
    }
    assertRealDirectory(info, dir);
  }

  async #assertDecisionDir(project: string): Promise<void> {
    await this.#assertRealDirectoryOrAbsent(this.#decisionsDir());
    await this.#assertRealDirectoryOrAbsent(this.#projectDecisionsDir(project));
  }

  async #assertEventsDir(): Promise<void> {
    await this.#assertRealDirectoryOrAbsent(this.#eventsDir());
  }

  async #assertRealDirectoryOrAbsent(path: string): Promise<void> {
    const info = await this.#lstatOrUndefined(path);
    if (info !== undefined) {
      assertRealDirectory(info, path);
    }
  }

  async #decisionCount(project: string): Promise<number> {
    const dir = this.#projectDecisionsDir(project);
    return (await this.#decisionNames(dir)).length;
  }

  async #decisionNames(dir: string): Promise<string[]> {
    return (await this.#entryNames(dir, isDecisionName)).sort();
  }

  async #lstatOrUndefined(path: string): Promise<Stats | undefined> {
    try {
      return await lstat(path);
    } catch (error) {
      if (errorCode(error) === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  }

  async #readText(path: string): Promise<string | undefined> {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if (errorCode(error) === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  }

  async #entryNames(
    dir: string,
    keep: (name: string) => boolean,
  ): Promise<string[]> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch (error) {
      if (errorCode(error) === "ENOENT") {
        return [];
      }
      throw error;
    }
    return entries.filter(keep);
  }

  async #writeAtomic(target: string, payload: string): Promise<void> {
    const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
    try {
      await writeFile(temporary, payload, {
        encoding: "utf8",
        mode: FILE_MODE,
      });
      await rename(temporary, target);
    } catch (error) {
      try {
        await rm(temporary, { force: true });
      } catch {
        void ignore();
      }
      throw error;
    }
  }

  #decisionsDir(): string {
    return join(this.#dataDir, DECISIONS_DIR);
  }

  #eventsDir(): string {
    return join(this.#dataDir, EVENTS_DIR);
  }

  #projectDecisionsDir(project: string): string {
    return join(this.#decisionsDir(), project);
  }

  #decisionPath(project: string, id: string): string {
    return join(this.#projectDecisionsDir(project), `${id}${SNAPSHOT_SUFFIX}`);
  }

  #eventsPath(project: string): string {
    return join(this.#eventsDir(), `${project}${SNAPSHOT_SUFFIX}`);
  }
}

function byDecisionId(a: StoredDecision, b: StoredDecision): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
