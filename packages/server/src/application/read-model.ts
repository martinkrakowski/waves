import {
  type Envelope,
  isRetained,
  isStale,
  type Lane,
  type LaneDerived,
  type Project,
  staleAfterMs,
  type StoredSnapshot,
} from "@hexagen-monaco/waves-contract";

import { type SnapshotHead, type StorePort } from "./ports/store.js";

export type Now = () => number;

export type AliveView = boolean | "unknown";

export interface ProjectSummary {
  readonly id: string;
  readonly name: string;
  readonly repo?: string;
  readonly registeredAt: string;
  readonly waves: number;
  readonly lastPush?: string;
  /**
   * Whether the project's newest wave is past the point where its own interval
   * says it should have arrived. A project with no waves is not stale: it has
   * said nothing, which is not the same as having said something that is now
   * overdue.
   */
  readonly stale: boolean;
}

export interface WaveSummary extends SnapshotHead {
  readonly stale: boolean;
  readonly retained: boolean;
}

export interface LaneDerivedView extends Omit<LaneDerived, "alive"> {
  readonly alive: AliveView;
}

export interface LaneView extends Omit<Lane, "derived"> {
  readonly derived: LaneDerivedView;
}

export interface EnvelopeView extends Omit<Envelope, "lanes"> {
  readonly lanes: readonly LaneView[];
}

export interface WaveView {
  readonly envelope: EnvelopeView;
  readonly receivedAt: string;
  readonly stale: boolean;
  readonly staleAfterMs: number;
}

export interface ReadModelDeps {
  readonly store: StorePort<Project, StoredSnapshot>;
  readonly now: Now;
}

export interface ReadModel {
  listProjects(): Promise<readonly ProjectSummary[]>;
  listWaves(projectId: string): Promise<readonly WaveSummary[] | undefined>;
  getWave(projectId: string, wave: string): Promise<WaveView | undefined>;
}

function lastPushOf(heads: readonly SnapshotHead[]): string | undefined {
  let latest: string | undefined;
  let latestMs = Number.NEGATIVE_INFINITY;
  for (const head of heads) {
    const ms = Date.parse(head.receivedAt);
    if (latest === undefined || ms > latestMs) {
      latest = head.receivedAt;
      latestMs = ms;
    }
  }
  return latest;
}

/**
 * The head of a project's most recent wave, which is the one the project summary
 * describes: an older wave may well be stale while the newest is not.
 */
function newestHead(heads: readonly SnapshotHead[]): SnapshotHead | undefined {
  let newest: SnapshotHead | undefined;
  for (const head of heads) {
    if (
      newest === undefined ||
      Date.parse(head.receivedAt) > Date.parse(newest.receivedAt)
    ) {
      newest = head;
    }
  }
  return newest;
}

function aliveView(alive: boolean, stale: boolean): AliveView {
  return stale && alive ? "unknown" : alive;
}

function laneView(lane: Lane, stale: boolean): LaneView {
  return {
    ...lane,
    derived: { ...lane.derived, alive: aliveView(lane.derived.alive, stale) },
  };
}

function waveSummary(head: SnapshotHead, nowMs: number): WaveSummary {
  const receivedAtMs = Date.parse(head.receivedAt);
  return {
    ...head,
    stale: isStale(receivedAtMs, head.intervalSeconds, nowMs),
    retained: isRetained(receivedAtMs, nowMs),
  };
}

export function createReadModel(deps: ReadModelDeps): ReadModel {
  const { store, now } = deps;

  return {
    async listProjects(): Promise<readonly ProjectSummary[]> {
      const projects = await store.listProjects();
      const nowMs = now();
      const summaries: ProjectSummary[] = [];
      for (const project of projects) {
        const heads = await store.listSnapshotHeads(project.id);
        const newest = newestHead(heads);
        summaries.push({
          id: project.id,
          name: project.name,
          repo: project.repo,
          registeredAt: project.registeredAt,
          waves: heads.length,
          lastPush: lastPushOf(heads),
          stale:
            newest !== undefined &&
            isStale(
              Date.parse(newest.receivedAt),
              newest.intervalSeconds,
              nowMs,
            ),
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
      const heads = await store.listSnapshotHeads(projectId);
      return heads
        .map((head) => waveSummary(head, nowMs))
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
      const stale = isStale(receivedAtMs, intervalSeconds, nowMs);
      const lanes = snapshot.envelope.lanes.map((lane) =>
        laneView(lane, stale),
      );
      return {
        envelope: { ...snapshot.envelope, lanes },
        receivedAt: snapshot.receivedAt,
        stale,
        staleAfterMs: staleAfterMs(intervalSeconds),
      };
    },
  };
}
