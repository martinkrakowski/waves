import type { Project, StoredSnapshot } from "@hexagen-monaco/waves-contract";

import {
  type SnapshotHead,
  type StorePort,
  snapshotHead,
} from "../application/ports/store.js";
import { assertIds } from "./ids.js";

export class MemoryStore implements StorePort<Project, StoredSnapshot> {
  readonly #projects = new Map<string, Project>();
  readonly #waves = new Map<string, Map<string, StoredSnapshot>>();
  readonly #heads = new Map<string, Map<string, SnapshotHead>>();

  async getProject(id: string): Promise<Project | undefined> {
    assertIds(id);
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
    assertIds(project.id);
    this.#projects.set(project.id, structuredClone(project));
  }

  async deleteProject(id: string): Promise<void> {
    assertIds(id);
    this.#projects.delete(id);
    this.#waves.delete(id);
    this.#heads.delete(id);
  }

  async putSnapshot(snapshot: StoredSnapshot): Promise<void> {
    const project = snapshot.envelope.project;
    assertIds(project, snapshot.envelope.wave);
    const waves = this.#waves.get(project) ?? new Map<string, StoredSnapshot>();
    waves.set(snapshot.envelope.wave, structuredClone(snapshot));
    this.#waves.set(project, waves);
    const heads = this.#heads.get(project) ?? new Map<string, SnapshotHead>();
    heads.set(snapshot.envelope.wave, snapshotHead(snapshot));
    this.#heads.set(project, heads);
  }

  async getSnapshot(
    project: string,
    wave: string,
  ): Promise<StoredSnapshot | undefined> {
    assertIds(project, wave);
    const stored = this.#waves.get(project)?.get(wave);
    if (stored === undefined) {
      return undefined;
    }
    return structuredClone(stored);
  }

  async listSnapshots(project: string): Promise<readonly StoredSnapshot[]> {
    assertIds(project);
    const waves = this.#waves.get(project);
    if (waves === undefined) {
      return [];
    }
    return [...waves.keys()]
      .sort()
      .map((wave) => structuredClone(waves.get(wave) as StoredSnapshot));
  }

  async listSnapshotHeads(project: string): Promise<readonly SnapshotHead[]> {
    assertIds(project);
    const heads = this.#heads.get(project);
    if (heads === undefined) {
      return [];
    }
    return [...heads.keys()]
      .sort()
      .map((wave) => heads.get(wave) as SnapshotHead);
  }

  async deleteSnapshot(project: string, wave: string): Promise<void> {
    assertIds(project, wave);
    this.#waves.get(project)?.delete(wave);
    this.#heads.get(project)?.delete(wave);
  }
}
