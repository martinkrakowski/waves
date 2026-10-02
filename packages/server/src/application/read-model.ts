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

import {
  attentionReasons,
  type AttentionReason,
  inAttentionWindow,
  MAX_ATTENTION_LANES,
} from "../domain/attention.js";
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
   * The lanes in the project's retained waves, summed from the wave heads the
   * listing already read: a wave older than the retention is not counted,
   * because the store may still be holding it and the number is about work.
   */
  readonly lanes: number;
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

/** One lane of one project's wave, with the reasons it wants a reader. */
export interface AttentionLane {
  readonly project: string;
  readonly wave: string;
  readonly lane: string;
  readonly seat?: string;
  readonly reasons: readonly AttentionReason[];
  readonly receivedAt: string;
  readonly stale: boolean;
  readonly pr?: number;
}

/**
 * What every project is asking for at once. `projects` counts what each one
 * matched before the cap, so a project whose lanes the cap cut still says how
 * many it wanted.
 */
export interface AttentionView {
  readonly lanes: readonly AttentionLane[];
  readonly projects: readonly {
    readonly id: string;
    readonly attention: number;
  }[];
  readonly truncated: boolean;
}

export interface ReadModelDeps {
  readonly store: StorePort<Project, StoredSnapshot>;
  readonly now: Now;
}

export interface ReadModel {
  listProjects(): Promise<readonly ProjectSummary[]>;
  listWaves(projectId: string): Promise<readonly WaveSummary[] | undefined>;
  listAttention(): Promise<AttentionView>;
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

/** The lanes in a project's waves the store is still meant to be holding. */
function retainedLanes(heads: readonly SnapshotHead[], nowMs: number): number {
  let lanes = 0;
  for (const head of heads) {
    if (isRetained(Date.parse(head.receivedAt), nowMs)) {
      lanes += head.lanes;
    }
  }
  return lanes;
}

/**
 * One lane as the cross-project view answers it. `seat` and `pr` are keys the
 * lane has, not keys holding nothing: a client reading `entry.pr` must be able
 * to tell a lane with no pull request from one whose pull request the server
 * has not been told about.
 */
function attentionLane(
  project: string,
  head: SnapshotHead,
  lane: Lane,
  reasons: readonly AttentionReason[],
  snapshot: StoredSnapshot,
  stale: boolean,
): AttentionLane {
  const pr = lane.derived.pr?.number;
  return {
    project,
    wave: head.wave,
    lane: lane.id,
    ...(lane.seat === undefined ? {} : { seat: lane.seat }),
    reasons,
    receivedAt: snapshot.receivedAt,
    stale,
    ...(pr === undefined ? {} : { pr }),
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
          lanes: retainedLanes(heads, nowMs),
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

    /**
     * Every lane of every project's recent waves that wants a reader, newest
     * receive first. It reads the wave heads of every project and then the full
     * snapshot of the waves still inside the attention window, and never
     * `listSnapshots`: a fleet of projects is answered from one wave each.
     */
    async listAttention(): Promise<AttentionView> {
      const nowMs = now();
      const projects = await store.listProjects();
      const matched: AttentionLane[] = [];
      const perProject: { readonly id: string; readonly attention: number }[] =
        [];
      for (const project of projects) {
        let count = 0;
        const heads = await store.listSnapshotHeads(project.id);
        for (const head of heads) {
          if (!inAttentionWindow(Date.parse(head.receivedAt), nowMs)) {
            continue;
          }
          const snapshot = await store.getSnapshot(project.id, head.wave);
          if (snapshot === undefined) {
            // The wave went away between the heads and the snapshot: another
            // push for the same wave, or a deletion. Either way it is not there
            // to be listed, and there is nothing to fail this answer over.
            continue;
          }
          const stale = isStale(
            Date.parse(snapshot.receivedAt),
            snapshot.envelope.intervalSeconds,
            nowMs,
          );
          for (const lane of snapshot.envelope.lanes) {
            const reasons = attentionReasons(lane, stale);
            if (reasons.length === 0) {
              continue;
            }
            count += 1;
            matched.push(
              attentionLane(project.id, head, lane, reasons, snapshot, stale),
            );
          }
        }
        // The count is what the project asked for, not what the cap below lets
        // through: a reader is told how much the list it is holding is not.
        perProject.push({ id: project.id, attention: count });
      }
      // `Array.prototype.sort` is stable, so lanes that arrived within the same
      // millisecond keep the order they were found in: project order, then wave
      // order, then the order the wave itself lists its lanes in.
      const lanes = matched
        .slice()
        .sort(
          (left, right) =>
            Date.parse(right.receivedAt) - Date.parse(left.receivedAt),
        )
        .slice(0, MAX_ATTENTION_LANES);
      return {
        lanes,
        projects: perProject,
        truncated: matched.length > lanes.length,
      };
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
