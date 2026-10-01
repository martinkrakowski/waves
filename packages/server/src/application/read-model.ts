import type {
  EnvelopeRecord,
  LaneDerivedRecord,
  LaneRecord,
  ProjectRecord,
  StoredSnapshotRecord,
} from "./ports/model.js";
import type { StalenessPort } from "./ports/staleness.js";
import type { StorePort } from "./ports/store.js";

export type Now = () => number;

export type AliveView = boolean | "unknown";

export interface ProjectSummary {
  readonly id: string;
  readonly name: string;
  readonly repo?: string;
  readonly registeredAt: string;
  readonly waves: number;
  readonly lastPush?: string;
}

export interface WaveSummary {
  readonly wave: string;
  readonly receivedAt: string;
  readonly intervalSeconds: number | null;
  readonly stale: boolean;
  readonly retained: boolean;
  readonly lanes: number;
}

export interface LaneDerivedView extends Omit<LaneDerivedRecord, "alive"> {
  readonly alive: AliveView;
}

export interface LaneView extends Omit<LaneRecord, "derived"> {
  readonly derived: LaneDerivedView;
}

export interface EnvelopeView extends Omit<EnvelopeRecord, "lanes"> {
  readonly lanes: readonly LaneView[];
}

export interface WaveView {
  readonly envelope: EnvelopeView;
  readonly receivedAt: string;
  readonly stale: boolean;
  readonly staleAfterMs: number;
}

export interface ReadModelDeps {
  readonly store: StorePort<ProjectRecord, StoredSnapshotRecord>;
  readonly now: Now;
  readonly staleness: StalenessPort;
}

export interface ReadModel {
  listProjects(): Promise<readonly ProjectSummary[]>;
  listWaves(projectId: string): Promise<readonly WaveSummary[] | undefined>;
  getWave(projectId: string, wave: string): Promise<WaveView | undefined>;
}

function lastPushOf(
  snapshots: readonly StoredSnapshotRecord[],
): string | undefined {
  let latest: string | undefined;
  let latestMs = Number.NEGATIVE_INFINITY;
  for (const snapshot of snapshots) {
    const ms = Date.parse(snapshot.receivedAt);
    if (latest === undefined || ms > latestMs) {
      latest = snapshot.receivedAt;
      latestMs = ms;
    }
  }
  return latest;
}

function aliveView(alive: boolean, stale: boolean): AliveView {
  return stale && alive ? "unknown" : alive;
}

function laneView(lane: LaneRecord, stale: boolean): LaneView {
  return {
    ...lane,
    derived: { ...lane.derived, alive: aliveView(lane.derived.alive, stale) },
  };
}

function waveSummary(
  snapshot: StoredSnapshotRecord,
  nowMs: number,
  staleness: StalenessPort,
): WaveSummary {
  const receivedAtMs = Date.parse(snapshot.receivedAt);
  const intervalSeconds = snapshot.envelope.intervalSeconds;
  return {
    wave: snapshot.envelope.wave,
    receivedAt: snapshot.receivedAt,
    intervalSeconds,
    stale: staleness.isStale(receivedAtMs, intervalSeconds, nowMs),
    retained: staleness.isRetained(receivedAtMs, nowMs),
    lanes: snapshot.envelope.lanes.length,
  };
}

export function createReadModel(deps: ReadModelDeps): ReadModel {
  const { store, now, staleness } = deps;

  return {
    async listProjects(): Promise<readonly ProjectSummary[]> {
      const projects = await store.listProjects();
      const summaries: ProjectSummary[] = [];
      for (const project of projects) {
        const snapshots = await store.listSnapshots(project.id);
        summaries.push({
          id: project.id,
          name: project.name,
          repo: project.repo,
          registeredAt: project.registeredAt,
          waves: snapshots.length,
          lastPush: lastPushOf(snapshots),
        });
      }
      return summaries;
    },

    async listWaves(
      projectId: string,
    ): Promise<readonly WaveSummary[] | undefined> {
      const project = await store.getProject(projectId);
      if (project === undefined) {
        return undefined;
      }
      const nowMs = now();
      const snapshots = await store.listSnapshots(projectId);
      return snapshots
        .map((snapshot) => waveSummary(snapshot, nowMs, staleness))
        .sort(
          (left, right) =>
            Date.parse(right.receivedAt) - Date.parse(left.receivedAt),
        );
    },

    async getWave(
      projectId: string,
      wave: string,
    ): Promise<WaveView | undefined> {
      const snapshot = await store.getSnapshot(projectId, wave);
      if (snapshot === undefined) {
        return undefined;
      }
      const nowMs = now();
      const receivedAtMs = Date.parse(snapshot.receivedAt);
      const intervalSeconds = snapshot.envelope.intervalSeconds;
      const stale = staleness.isStale(receivedAtMs, intervalSeconds, nowMs);
      const lanes = snapshot.envelope.lanes.map((lane) =>
        laneView(lane, stale),
      );
      return {
        envelope: { ...snapshot.envelope, lanes },
        receivedAt: snapshot.receivedAt,
        stale,
        staleAfterMs: staleness.staleAfterMs(intervalSeconds),
      };
    },
  };
}
