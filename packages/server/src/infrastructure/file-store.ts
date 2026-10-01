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

import type { Project, StoredSnapshot } from "@hexagen-monaco/waves-contract";

import type { SnapshotHead, StorePort } from "../application/ports/store.js";
import { snapshotHead } from "../application/ports/store.js";
import { assertIds } from "./ids.js";

const DATA_DIR_MODE = 0o700;
const FILE_MODE = 0o600;
const PROJECTS_FILE = "projects.json";
const SNAPSHOTS_DIR = "snapshots";
const SNAPSHOT_SUFFIX = ".json";
const HEAD_INFIX = ".head";

function isSnapshotName(name: string): boolean {
  return name.endsWith(SNAPSHOT_SUFFIX) && !name.includes(HEAD_INFIX);
}

function isHeadName(name: string): boolean {
  return name.endsWith(`${HEAD_INFIX}${SNAPSHOT_SUFFIX}`);
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

function assertRealDirectory(info: Stats, path: string): void {
  if (info.isSymbolicLink()) {
    throw new Error(`${path} is a symbolic link, not a directory`);
  }
  if (!info.isDirectory()) {
    throw new Error(`${path} is not a directory`);
  }
  if (info.uid !== process.getuid!()) {
    throw new Error(`${path} is not owned by this process`);
  }
  if ((info.mode & 0o077) !== 0) {
    throw new Error(`${path} is accessible to other users`);
  }
}

function serialiseProjects(projects: ReadonlyMap<string, Project>): string {
  return JSON.stringify(Object.fromEntries(projects), null, 2);
}

function ignore(): undefined {
  return undefined;
}

/**
 * Keeps `projects.json` and `snapshots/<project>/<wave>.json` under one data
 * directory, writing every file atomically through a temporary file and a
 * rename, with 0600 files under 0700 directories. Every path that enters
 * `snapshots/` or `snapshots/<project>/` is checked with `lstat` on the read and
 * delete paths as well as the write path, so a symlinked directory is refused
 * everywhere rather than followed.
 *
 * Beside every snapshot it writes `snapshots/<project>/<wave>.head.json`, the
 * four fields a listing needs, in the same queued operation and with the same
 * atomic write, and it deletes the two together. A listing therefore reads only
 * the small heads and never parses a whole wave, which is what keeps the project
 * list cheap as the number of waves grows.
 *
 * One process owns a data directory: the deployment runs a single replica, and
 * every mutating operation of an instance runs through one in-process queue, so
 * a read-modify-write of `projects.json` never interleaves with another and a
 * `putSnapshot` cannot race a `deleteProject`.
 */
export class FileStore implements StorePort<Project, StoredSnapshot> {
  readonly #dataDir: string;

  #queue: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    this.#dataDir = dataDir;
  }

  async getProject(id: string): Promise<Project | undefined> {
    assertIds(id);
    await this.#checkedDataDir(false);
    const projects = await this.#readProjects();
    return projects.get(id);
  }

  async listProjects(): Promise<readonly Project[]> {
    await this.#checkedDataDir(false);
    const projects = await this.#readProjects();
    return [...projects.keys()].sort().map((id) => projects.get(id) as Project);
  }

  async putProject(project: Project): Promise<void> {
    await this.#serialised(async () => {
      assertIds(project.id);
      await this.#checkedDataDir(true);
      const projects = await this.#readProjects();
      projects.set(project.id, project);
      await this.#writeAtomic(
        this.#projectsPath(),
        serialiseProjects(projects),
      );
    });
  }

  async deleteProject(id: string): Promise<void> {
    await this.#serialised(async () => {
      assertIds(id);
      await this.#checkedDataDir(true);
      const projects = await this.#readProjects();
      projects.delete(id);
      await this.#writeAtomic(
        this.#projectsPath(),
        serialiseProjects(projects),
      );
      await this.#assertSnapshotsPath(this.#projectDir(id));
      await rm(this.#projectDir(id), { recursive: true, force: true });
    });
  }

  async putSnapshot(snapshot: StoredSnapshot): Promise<void> {
    await this.#serialised(async () => {
      const project = snapshot.envelope.project;
      const wave = snapshot.envelope.wave;
      assertIds(project, wave);
      await this.#checkedDataDir(true);
      await this.#directoryForWrite(this.#snapshotsDir());
      await this.#directoryForWrite(this.#projectDir(project));
      await this.#writeAtomic(
        this.#snapshotPath(project, wave),
        JSON.stringify(snapshot, null, 2),
      );
      await this.#writeAtomic(
        this.#headPath(project, wave),
        JSON.stringify(snapshotHead(snapshot)),
      );
    });
  }

  async getSnapshot(
    project: string,
    wave: string,
  ): Promise<StoredSnapshot | undefined> {
    assertIds(project, wave);
    await this.#checkedDataDir(false);
    await this.#assertSnapshotsPath(this.#projectDir(project));
    const raw = await this.#readText(this.#snapshotPath(project, wave));
    if (raw === undefined) {
      return undefined;
    }
    return JSON.parse(raw) as StoredSnapshot;
  }

  async listSnapshots(project: string): Promise<readonly StoredSnapshot[]> {
    assertIds(project);
    await this.#checkedDataDir(false);
    const dir = this.#projectDir(project);
    await this.#assertSnapshotsPath(dir);
    const names = await this.#entryNames(dir, isSnapshotName);
    const snapshots: StoredSnapshot[] = [];
    for (const name of names) {
      const raw = await this.#readText(join(dir, name));
      if (raw !== undefined) {
        snapshots.push(JSON.parse(raw) as StoredSnapshot);
      }
    }
    return snapshots;
  }

  async listSnapshotHeads(project: string): Promise<readonly SnapshotHead[]> {
    assertIds(project);
    await this.#checkedDataDir(false);
    const dir = this.#projectDir(project);
    await this.#assertSnapshotsPath(dir);
    const names = await this.#entryNames(dir, isHeadName);
    const heads: SnapshotHead[] = [];
    for (const name of names) {
      const raw = await this.#readText(join(dir, name));
      if (raw !== undefined) {
        heads.push(JSON.parse(raw) as SnapshotHead);
      }
    }
    return heads;
  }

  async deleteSnapshot(project: string, wave: string): Promise<void> {
    assertIds(project, wave);
    await this.#serialised(async () => {
      await this.#checkedDataDir(false);
      await this.#assertSnapshotsPath(this.#projectDir(project));
      await rm(this.#snapshotPath(project, wave), { force: true });
      await rm(this.#headPath(project, wave), { force: true });
    });
  }

  #serialised(operation: () => Promise<void>): Promise<void> {
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

  async #assertSnapshotsPath(dir: string): Promise<void> {
    for (const path of [this.#snapshotsDir(), dir]) {
      const info = await this.#lstatOrUndefined(path);
      if (info !== undefined) {
        assertRealDirectory(info, path);
      }
    }
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
    return entries.filter(keep).sort();
  }

  async #readProjects(): Promise<Map<string, Project>> {
    const raw = await this.#readText(this.#projectsPath());
    if (raw === undefined) {
      return new Map();
    }
    return new Map(Object.entries(JSON.parse(raw) as Record<string, Project>));
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

  #projectsPath(): string {
    return join(this.#dataDir, PROJECTS_FILE);
  }

  #snapshotsDir(): string {
    return join(this.#dataDir, SNAPSHOTS_DIR);
  }

  #projectDir(project: string): string {
    return join(this.#snapshotsDir(), project);
  }

  #snapshotPath(project: string, wave: string): string {
    return join(this.#projectDir(project), `${wave}${SNAPSHOT_SUFFIX}`);
  }

  #headPath(project: string, wave: string): string {
    return join(
      this.#projectDir(project),
      `${wave}${HEAD_INFIX}${SNAPSHOT_SUFFIX}`,
    );
  }
}
