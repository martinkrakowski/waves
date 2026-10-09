import type { Stats } from "node:fs";
import { lstat, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { validateDecision } from "@hexagen-monaco/waves-contract";

import type {
  AppendOutcome,
  NoticeStorePort,
  StoredDecision,
  StoredEntry,
  StoredEvent,
  StoredRevision,
} from "../application/ports/notice-store.js";
import { assertIds, assertNoticeIds } from "./ids.js";
import {
  assertPositiveBound,
  assertRealDirectory,
  errorCode,
  nextEventSequence,
  writeAtomic,
} from "./store-helpers.js";

const TEXT_SHA256_PATTERN = /^[0-9a-f]{64}$/;

const DATA_DIR_MODE = 0o700;
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
 * One stored decision, parsed and fully shape-checked, or undefined when the file
 * is absent, unparseable, or fails the check: the top-level `project`/`id` must
 * match what was asked for, every revision must carry a positive integer
 * `revision`, a 64-hex `textSha256`, a string `receivedAt` and a `decision`
 * valid under the contract's `validateDecision` with that `project` and `id`,
 * and every entry must be an object with an integer `index` and `revision`, and
 * string `state`, `source`, `textSha256` and `receivedAt`. A bad file is never
 * thrown on: it is treated as absent so the inbox keeps listing the good
 * decisions alongside it, reads report no decision, and a write against it is a
 * conflict.
 */
function readDecision(
  raw: string,
  project: string,
  id: string,
): StoredDecision | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object") {
    return undefined;
  }
  const obj = parsed as Record<string, unknown>;
  const revisions = obj.revisions;
  const entries = obj.entries;
  if (
    typeof obj.project !== "string" ||
    obj.project !== project ||
    typeof obj.id !== "string" ||
    obj.id !== id ||
    !Array.isArray(revisions) ||
    revisions.length === 0 ||
    !Array.isArray(entries)
  ) {
    return undefined;
  }
  for (const revision of revisions) {
    if (typeof revision !== "object" || revision === null) {
      return undefined;
    }
    const rev = revision as Record<string, unknown>;
    const validated = validateDecision(rev.decision);
    const revNum = rev.revision;
    const hash = rev.textSha256;
    if (
      !validated.ok ||
      validated.value.project !== project ||
      validated.value.id !== id ||
      typeof revNum !== "number" ||
      !Number.isInteger(revNum) ||
      revNum <= 0 ||
      typeof hash !== "string" ||
      !TEXT_SHA256_PATTERN.test(hash) ||
      typeof rev.receivedAt !== "string"
    ) {
      return undefined;
    }
  }
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) {
      return undefined;
    }
    const ent = entry as Record<string, unknown>;
    if (
      !Number.isInteger(ent.index) ||
      !Number.isInteger(ent.revision) ||
      typeof ent.state !== "string" ||
      typeof ent.source !== "string" ||
      typeof ent.textSha256 !== "string" ||
      typeof ent.receivedAt !== "string"
    ) {
      return undefined;
    }
  }
  return obj as unknown as StoredDecision;
}

/**
 * One stored events list, parsed and shape-checked: an array. Throws a store
 * error when the file exists but is not a JSON array (truncated or wrong shape),
 * so an append to an invalid file fails and leaves the file untouched; a missing
 * file is an empty list so a new one can start. `listEvents` catches the throw
 * and answers no events.
 */
function readEvents(raw: string | undefined): StoredEvent[] {
  if (raw === undefined) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("events file is not valid JSON");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("events file is not an array");
  }
  return parsed as StoredEvent[];
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
    return readDecision(raw, project, id);
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
        const decision = readDecision(
          raw,
          project,
          name.slice(0, -SNAPSHOT_SUFFIX.length),
        );
        if (decision !== undefined) {
          decisions.push(decision);
        }
      }
    }
    return decisions;
  }

  async appendRevision(
    project: string,
    id: string,
    revision: StoredRevision,
    expectRevisions: number,
    ceiling: number,
  ): Promise<AppendOutcome> {
    assertNoticeIds(project, id);
    assertPositiveBound(ceiling, "ceiling");
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
        await writeAtomic(
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
      const stored = readDecision(raw, project, id);
      if (stored === undefined || stored.revisions.length !== expectRevisions) {
        return "conflict";
      }
      stored.revisions.push(revision);
      await writeAtomic(
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
    expectRevisions: number,
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
      const stored = readDecision(raw, project, id);
      if (
        stored === undefined ||
        stored.entries.length !== expectEntries ||
        stored.revisions.length !== expectRevisions
      ) {
        return "conflict";
      }
      stored.entries.push(entry);
      await writeAtomic(path, JSON.stringify(stored, null, 2));
      return "stored";
    });
  }

  async appendEvent(
    project: string,
    stored: StoredEvent,
    keep: number,
  ): Promise<{ id: string; dropped: number }> {
    assertIds(project);
    assertPositiveBound(keep, "keep");
    return this.#serialised(async () => {
      await this.#checkedDataDir(true);
      const eventsDir = this.#eventsDir();
      await this.#directoryForWrite(eventsDir);
      const path = this.#eventsPath(project);
      const raw = await this.#readText(path);
      const current = readEvents(raw);
      const id = `${stored.receivedAt}-${nextEventSequence(current)}`;
      current.push({ ...stored, id });
      const dropped = Math.max(0, current.length - keep);
      const kept = current.slice(dropped);
      await writeAtomic(path, JSON.stringify(kept, null, 2));
      return { id, dropped };
    });
  }

  async listEvents(
    project: string,
    limit: number,
  ): Promise<readonly StoredEvent[]> {
    assertIds(project);
    assertPositiveBound(limit, "limit");
    await this.#checkedDataDir(false);
    await this.#assertEventsDir();
    const raw = await this.#readText(this.#eventsPath(project));
    let events: StoredEvent[];
    try {
      events = readEvents(raw);
    } catch {
      events = [];
    }
    return events.reverse().slice(0, limit);
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
