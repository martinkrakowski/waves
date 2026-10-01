import type { StoredSnapshot } from "@hexagen-monaco/waves-contract";

/**
 * The one field of a stored snapshot a listing needs. Keeping it apart from
 * the envelope lets a store answer a listing without reading or parsing every
 * wave, which is what the project list and the wave list are for.
 */
export interface SnapshotHead {
  readonly wave: string;
  readonly receivedAt: string;
  readonly intervalSeconds: number | null;
  readonly lanes: number;
}

export function snapshotHead(snapshot: StoredSnapshot): SnapshotHead {
  return {
    wave: snapshot.envelope.wave,
    receivedAt: snapshot.receivedAt,
    intervalSeconds: snapshot.envelope.intervalSeconds,
    lanes: snapshot.envelope.lanes.length,
  };
}

export interface StorePort<TProject, TSnapshot> {
  getProject(id: string): Promise<TProject | undefined>;
  listProjects(): Promise<readonly TProject[]>;
  putProject(project: TProject): Promise<void>;
  deleteProject(id: string): Promise<void>;
  putSnapshot(snapshot: TSnapshot): Promise<void>;
  getSnapshot(project: string, wave: string): Promise<TSnapshot | undefined>;
  listSnapshots(project: string): Promise<readonly TSnapshot[]>;
  listSnapshotHeads(project: string): Promise<readonly SnapshotHead[]>;
  deleteSnapshot(project: string, wave: string): Promise<void>;
}
