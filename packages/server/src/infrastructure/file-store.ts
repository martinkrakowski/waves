import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import {
  isProjectId,
  isWaveId,
  type Project,
  type ProjectId,
  type StoredSnapshot,
  type WaveId,
} from "@hexagen-monaco/waves-contract";

import type { StorePort } from "../application/ports/store.js";

const DATA_DIR_MODE = 0o700;
const PROJECTS_FILE = "projects.json";
const SNAPSHOTS_DIR = "snapshots";
const SNAPSHOT_SUFFIX = ".json";

function requireProjectId(id: ProjectId): ProjectId {
  if (!isProjectId(id)) {
    throw new Error(`invalid project id: ${JSON.stringify(id)}`);
  }
  return id;
}

function requireWaveId(wave: WaveId): WaveId {
  if (!isWaveId(wave)) {
    throw new Error(`invalid wave id: ${JSON.stringify(wave)}`);
  }
  return wave;
}

export class FileStore implements StorePort<Project, StoredSnapshot> {
  readonly #dataDir: string;

  constructor(dataDir: string) {
    this.#dataDir = dataDir;
  }

  async getProject(id: ProjectId): Promise<Project | undefined> {
    const key = requireProjectId(id);
    const projects = await this.#readProjects();
    return projects[key];
  }

  async listProjects(): Promise<readonly Project[]> {
    const projects = await this.#readProjects();
    return Object.keys(projects)
      .sort()
      .map((id) => projects[id] as Project);
  }

  async putProject(project: Project): Promise<void> {
    const id = requireProjectId(project.id);
    const projects = await this.#readProjects();
    projects[id] = project;
    await this.#writeAtomic(
      this.#projectsPath(),
      JSON.stringify(projects, null, 2),
    );
  }

  async deleteProject(id: ProjectId): Promise<void> {
    const key = requireProjectId(id);
    const projects = await this.#readProjects();
    delete projects[key];
    await this.#writeAtomic(
      this.#projectsPath(),
      JSON.stringify(projects, null, 2),
    );
    await rm(this.#projectDir(key), { recursive: true, force: true });
  }

  async putSnapshot(snapshot: StoredSnapshot): Promise<void> {
    const project = requireProjectId(snapshot.envelope.project);
    const wave = requireWaveId(snapshot.envelope.wave);
    await mkdir(this.#projectDir(project), {
      recursive: true,
      mode: DATA_DIR_MODE,
    });
    await this.#writeAtomic(
      this.#snapshotPath(project, wave),
      JSON.stringify(snapshot, null, 2),
    );
  }

  async getSnapshot(
    project: ProjectId,
    wave: WaveId,
  ): Promise<StoredSnapshot | undefined> {
    const path = this.#snapshotPath(
      requireProjectId(project),
      requireWaveId(wave),
    );
    if (!existsSync(path)) {
      return undefined;
    }
    return JSON.parse(await readFile(path, "utf8")) as StoredSnapshot;
  }

  async listSnapshots(project: ProjectId): Promise<readonly StoredSnapshot[]> {
    const dir = this.#projectDir(requireProjectId(project));
    if (!existsSync(dir)) {
      return [];
    }
    const names = (await readdir(dir))
      .filter((name) => name.endsWith(SNAPSHOT_SUFFIX))
      .sort();
    const snapshots: StoredSnapshot[] = [];
    for (const name of names) {
      const raw = await readFile(join(dir, name), "utf8");
      snapshots.push(JSON.parse(raw) as StoredSnapshot);
    }
    return snapshots;
  }

  async deleteSnapshot(project: ProjectId, wave: WaveId): Promise<void> {
    const path = this.#snapshotPath(
      requireProjectId(project),
      requireWaveId(wave),
    );
    await rm(path, { force: true });
  }

  async #readProjects(): Promise<Record<ProjectId, Project>> {
    const path = this.#projectsPath();
    if (!existsSync(path)) {
      return {};
    }
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as Record<ProjectId, Project>;
  }

  async #writeAtomic(target: string, payload: string): Promise<void> {
    await mkdir(this.#dataDir, { recursive: true, mode: DATA_DIR_MODE });
    const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
    await writeFile(temporary, payload, "utf8");
    await rename(temporary, target);
  }

  #projectsPath(): string {
    return join(this.#dataDir, PROJECTS_FILE);
  }

  #projectDir(project: ProjectId): string {
    return join(this.#dataDir, SNAPSHOTS_DIR, requireProjectId(project));
  }

  #snapshotPath(project: ProjectId, wave: WaveId): string {
    return join(
      this.#projectDir(project),
      requireWaveId(wave) + SNAPSHOT_SUFFIX,
    );
  }
}
