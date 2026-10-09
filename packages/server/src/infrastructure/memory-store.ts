import type { Project, StoredSnapshot } from "@hexagen-monaco/waves-contract";

import {
  type CreateOutcome,
  type SnapshotHead,
  type StorePort,
  type StoredStatus,
  snapshotHead,
} from "../application/ports/store.js";
import {
  type AppendOutcome,
  type NoticeStorePort,
  type StoredDecision,
  type StoredEntry,
  type StoredEvent,
  type StoredRevision,
} from "../application/ports/notice-store.js";
import { assertIds, assertNoticeIds } from "./ids.js";
import { nextEventSequence, assertPositiveBound } from "./store-helpers.js";

export class MemoryStore
  implements StorePort<Project, StoredSnapshot>, NoticeStorePort
{
  readonly #projects = new Map<string, Project>();
  readonly #waves = new Map<string, Map<string, StoredSnapshot>>();
  readonly #heads = new Map<string, Map<string, SnapshotHead>>();
  /** One document per project, cloned in and out exactly as a snapshot is. */
  readonly #statuses = new Map<string, StoredStatus>();
  /** Decisions: `project` -> `id` -> StoredDecision. */
  readonly #decisions = new Map<string, Map<string, StoredDecision>>();
  /** Events: `project` -> StoredEvent[], newest last. */
  readonly #events = new Map<string, StoredEvent[]>();

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

  /**
   * The same three answers as the file store. Nothing is awaited between the
   * test and the write, so one call cannot interleave with another and the
   * contract the two stores share holds here too.
   */
  async createProject(
    project: Project,
    ceiling: number,
  ): Promise<CreateOutcome> {
    assertIds(project.id);
    if (this.#projects.has(project.id)) {
      return "exists";
    }
    if (this.#projects.size >= ceiling) {
      return "ceiling";
    }
    this.#projects.set(project.id, structuredClone(project));
    // A status left by an earlier project of the same id is not this one's.
    this.#statuses.delete(project.id);
    return "created";
  }

  async deleteProject(id: string): Promise<void> {
    assertIds(id);
    this.#projects.delete(id);
    this.#waves.delete(id);
    this.#heads.delete(id);
    this.#statuses.delete(id);
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

  async putStatus(stored: StoredStatus): Promise<void> {
    assertIds(stored.status.project);
    this.#statuses.set(stored.status.project, structuredClone(stored));
  }

  async getStatus(project: string): Promise<StoredStatus | undefined> {
    assertIds(project);
    const stored = this.#statuses.get(project);
    if (stored === undefined) {
      return undefined;
    }
    return structuredClone(stored);
  }

  async getDecision(
    project: string,
    id: string,
  ): Promise<StoredDecision | undefined> {
    assertNoticeIds(project, id);
    const stored = this.#decisions.get(project)?.get(id);
    if (stored === undefined) {
      return undefined;
    }
    return structuredClone(stored);
  }

  async listDecisions(project: string): Promise<readonly StoredDecision[]> {
    assertIds(project);
    const decisions = this.#decisions.get(project);
    if (decisions === undefined) {
      return [];
    }
    return [...decisions.keys()]
      .sort()
      .map((id) => structuredClone(decisions.get(id) as StoredDecision));
  }

  /**
   * The create and the update read and write with nothing awaited between them,
   * the same property the file store's queue gives: one call cannot interleave
   * with another, so two writers with the same `expectRevisions` cannot both win.
   */
  async appendRevision(
    project: string,
    id: string,
    revision: StoredRevision,
    expectRevisions: number,
    ceiling: number,
  ): Promise<AppendOutcome> {
    assertNoticeIds(project, id);
    assertPositiveBound(ceiling, "ceiling");
    const decisions =
      this.#decisions.get(project) ?? new Map<string, StoredDecision>();
    const existing = decisions.get(id);
    const count = existing?.revisions.length ?? 0;
    if (count !== expectRevisions) {
      return "conflict";
    }
    if (expectRevisions === 0) {
      if (decisions.size >= ceiling) {
        return "ceiling";
      }
      decisions.set(id, {
        project,
        id,
        revisions: [structuredClone(revision)],
        entries: [],
      });
      this.#decisions.set(project, decisions);
      return "stored";
    }
    existing!.revisions.push(structuredClone(revision));
    return "stored";
  }

  async appendEntry(
    project: string,
    id: string,
    entry: StoredEntry,
    expectEntries: number,
    expectRevisions: number,
  ): Promise<AppendOutcome> {
    assertNoticeIds(project, id);
    const decisions = this.#decisions.get(project);
    if (decisions === undefined) {
      return "missing";
    }
    const existing = decisions.get(id);
    if (existing === undefined) {
      return "missing";
    }
    if (
      existing.entries.length !== expectEntries ||
      existing.revisions.length !== expectRevisions
    ) {
      return "conflict";
    }
    existing.entries.push(structuredClone(entry));
    return "stored";
  }

  async appendEvent(
    project: string,
    stored: StoredEvent,
    keep: number,
  ): Promise<{ id: string; dropped: number }> {
    assertIds(project);
    assertPositiveBound(keep, "keep");
    const current = this.#events.get(project) ?? [];
    const id = `${stored.receivedAt}-${nextEventSequence(current)}`;
    const next = [...current, { ...structuredClone(stored), id }];
    const dropped = Math.max(0, next.length - keep);
    this.#events.set(project, next.slice(dropped));
    return { id, dropped };
  }

  async listEvents(
    project: string,
    limit: number,
  ): Promise<readonly StoredEvent[]> {
    assertIds(project);
    assertPositiveBound(limit, "limit");
    const events = this.#events.get(project);
    if (events === undefined) {
      return [];
    }
    return structuredClone(
      [...events].reverse().slice(0, Math.max(0, limit)),
    ) as StoredEvent[];
  }

  async deleteNotices(project: string): Promise<void> {
    assertIds(project);
    this.#decisions.delete(project);
    this.#events.delete(project);
  }
}
