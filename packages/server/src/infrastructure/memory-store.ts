import type {
  Project,
  ProjectId,
  StoredSnapshot,
  WaveId,
} from "@hexagen-monaco/waves-contract";

import type { StorePort } from "../application/ports/store.js";

export class MemoryStore implements StorePort<Project, StoredSnapshot> {
  readonly #projects = new Map<ProjectId, Project>();
  readonly #waves = new Map<ProjectId, Map<WaveId, StoredSnapshot>>();

  async getProject(id: ProjectId): Promise<Project | undefined> {
    const stored = this.#projects.get(id);
    if (stored === undefined) {
      return undefined;
    }
    return structuredClone(stored);
  }

  async listProjects(): Promise<readonly Project[]> {
    return [...this.#projects.keys()]
      .sort()
      .map((id) => structuredClone(this.#projects.get(id) as Project));
  }

  async putProject(project: Project): Promise<void> {
    this.#projects.set(project.id, structuredClone(project));
  }

  async deleteProject(id: ProjectId): Promise<void> {
    this.#projects.delete(id);
    this.#waves.delete(id);
  }

  async putSnapshot(snapshot: StoredSnapshot): Promise<void> {
    const project = snapshot.envelope.project;
    const waves = this.#waves.get(project) ?? new Map<WaveId, StoredSnapshot>();
    waves.set(snapshot.envelope.wave, structuredClone(snapshot));
    this.#waves.set(project, waves);
  }

  async getSnapshot(
    project: ProjectId,
    wave: WaveId,
  ): Promise<StoredSnapshot | undefined> {
    const stored = this.#waves.get(project)?.get(wave);
    if (stored === undefined) {
      return undefined;
    }
    return structuredClone(stored);
  }

  async listSnapshots(project: ProjectId): Promise<readonly StoredSnapshot[]> {
    const waves = this.#waves.get(project);
    if (waves === undefined) {
      return [];
    }
    return [...waves.keys()]
      .sort()
      .map((wave) => structuredClone(waves.get(wave) as StoredSnapshot));
  }

  async deleteSnapshot(project: ProjectId, wave: WaveId): Promise<void> {
    this.#waves.get(project)?.delete(wave);
  }
}
