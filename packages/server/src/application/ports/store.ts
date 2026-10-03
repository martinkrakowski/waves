import type {
  ProjectStatus,
  StoredSnapshot,
} from "@hexagen-monaco/waves-contract";

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

/**
 * A project's own status document with the moment this service received it —
 * the second stored thing beside a snapshot, and the same shape: what the
 * pusher sent, and the server's own clock at the instant every staleness rule
 * reads. `generatedAt` is stored and echoed and no rule reads it, exactly as for
 * a wave.
 *
 * It lives here rather than in the contract because the contract owns the
 * document and this service owns when it arrived.
 */
export interface StoredStatus {
  readonly status: ProjectStatus;
  readonly receivedAt: string;
}

export function snapshotHead(snapshot: StoredSnapshot): SnapshotHead {
  return {
    wave: snapshot.envelope.wave,
    receivedAt: snapshot.receivedAt,
    intervalSeconds: snapshot.envelope.intervalSeconds,
    lanes: snapshot.envelope.lanes.length,
  };
}

export type CreateOutcome = "created" | "exists" | "ceiling";

export interface StorePort<TProject, TSnapshot> {
  getProject(id: string): Promise<TProject | undefined>;
  listProjects(): Promise<readonly TProject[]>;
  putProject(project: TProject): Promise<void>;
  /**
   * Stores a project only if its id is free, in one operation the store
   * serialises, and says which of the three things happened: it was created, the
   * id was already taken, or the registry is already at `ceiling` projects.
   *
   * `ceiling` is an argument rather than a constant of this port on purpose: it
   * is a rule of the enrollment path in the application layer, not of storage,
   * and a port that hard-coded it would make the registry's size a property of
   * the adapter. The store only applies the number it is handed, which is what
   * lets a test drive the boundary with any ceiling at all.
   */
  createProject(project: TProject, ceiling: number): Promise<CreateOutcome>;
  deleteProject(id: string): Promise<void>;
  putSnapshot(snapshot: TSnapshot): Promise<void>;
  getSnapshot(project: string, wave: string): Promise<TSnapshot | undefined>;
  listSnapshots(project: string): Promise<readonly TSnapshot[]>;
  listSnapshotHeads(project: string): Promise<readonly SnapshotHead[]>;
  deleteSnapshot(project: string, wave: string): Promise<void>;
  /**
   * The project's status document, or undefined when it has pushed none. The
   * status is a whole project rather than a wave, so it takes a project and no
   * wave: there is one of them, and its own directory beside `snapshots/` is
   * what keeps a wave whose id is `status` from colliding with it.
   */
  putStatus(stored: StoredStatus): Promise<void>;
  getStatus(project: string): Promise<StoredStatus | undefined>;
}
