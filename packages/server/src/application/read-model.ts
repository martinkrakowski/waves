import {
  type DiffStat,
  type Envelope,
  type Gate,
  isRetained,
  isStale,
  type Lane,
  type LaneDerived,
  type LaneEvent,
  type LaneReported,
  type Project,
  type PullRequest,
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

/** The most lanes one project's listing answers with, whatever the project holds. */
export const MAX_PROJECT_LANES = 2_000;

/**
 * The most bytes one project's listing answers with. The contract caps `seat`,
 * `planReview`, `risk` and every disagreement in characters, so a lane of
 * non-ASCII text is several times larger in bytes than one of ASCII at the same
 * length: a `"` is two bytes once JSON has escaped it, a CJK ideograph is three,
 * and a lone surrogate — which is not a control character, so the contract
 * accepts it — is six. Counting rows alone would not bound the answer, so the
 * rows are bounded in bytes as well.
 */
export const MAX_PROJECT_LANES_BYTES = 2 * 1024 * 1024;

/**
 * What one row costs beyond its own JSON: the wave id, the reasons and the
 * `alive` value that the request settles. Generous by design — the bound is on
 * what leaves the server, and this is the part of it that is not measured.
 */
export const ROW_OVERHEAD_BYTES = 256;

/**
 * The most waves one listing asks the store for. A project that has pushed a wave
 * every ten minutes for a year holds thousands, and past the retention nothing
 * deletes them, so `all = true` is otherwise a read over everything the project
 * ever pushed. The wave heads carry the lane counts, so a wave bound costs the
 * reader the same rows the row bounds would have cut.
 */
export const MAX_WAVES_PER_READ = 200;

/**
 * How many waves' computed rows one read model holds at once, and how many rows
 * they may add up to. The wave count is generous on purpose: a poll that asks
 * for more waves than this would evict each of them just before it asked for it,
 * so what bounds memory is the row count. A wave is dropped only when it has not
 * been used for longer than every other one.
 */
export const MAX_CACHED_WAVES = 512;
export const MAX_CACHED_ROWS = 10_000;

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

/**
 * One lane as a project's listing answers it. It is the wave's own lane with the
 * three heavy things left out — `reported.detail`, the text of the log tail and
 * every disagreement after the first — so that the whole project fits in one
 * answer. Every optional key is absent when the stored lane has none, never
 * present holding nothing: a client reading `row.seat` has to be able to tell a
 * lane with no seat from a seat the server has not been told about.
 */
export interface LaneRow {
  readonly wave: string;
  readonly id: string;
  readonly seat?: string;
  readonly reported?: {
    readonly stage: string;
    readonly event: LaneEvent;
    readonly ts: string;
    readonly pr?: number;
    readonly round?: number;
  };
  readonly derived: {
    readonly alive: AliveView;
    readonly exit?: number;
    readonly gate?: Gate;
    readonly pr?: PullRequest;
    readonly diff?: DiffStat;
    readonly planReview?: string;
    readonly risk?: string;
    readonly log?: {
      readonly bytes: number;
      readonly mtimeMs: number;
      readonly tail: boolean;
    };
  };
  /** How many disagreements the lane has. */
  readonly disagreements: number;
  /** The first of them, when there is one. */
  readonly disagreement?: string;
  readonly reasons: readonly AttentionReason[];
}

/**
 * Every lane of one project's waves, with the wave strip beside them so a reader
 * needs no second request. `truncated` says that more lanes matched than the cap
 * let through.
 */
export interface ProjectLanesView {
  readonly project: {
    readonly id: string;
    readonly name: string;
    readonly repo?: string;
  };
  readonly waves: readonly WaveSummary[];
  readonly lanes: readonly LaneRow[];
  readonly truncated: boolean;
}

export interface ReadModelDeps {
  readonly store: StorePort<Project, StoredSnapshot>;
  readonly now: Now;
}

export interface ReadModel {
  listProjects(): Promise<readonly ProjectSummary[]>;
  listWaves(projectId: string): Promise<readonly WaveSummary[] | undefined>;
  listLanes(
    projectId: string,
    all: boolean,
  ): Promise<ProjectLanesView | undefined>;
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

/**
 * A project's waves newest receive first, which is the order the wave list has
 * always answered in and the order both the wave route and the project listing
 * read their waves in.
 */
function waveSummaries(
  heads: readonly SnapshotHead[],
  nowMs: number,
): readonly WaveSummary[] {
  return heads
    .map((head) => waveSummary(head, nowMs))
    .sort(
      (left, right) =>
        Date.parse(right.receivedAt) - Date.parse(left.receivedAt),
    );
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
 * One lane with everything that does not depend on the request settled and the
 * heavy text left out: no `reported.detail`, no tail, no disagreement after the
 * first, and the two answers for the lane's reasons, one for a fresh wave and
 * one for a wave that has gone past its own interval. `bytes` is what the row
 * costs in the answer, so nothing has to measure it per request. Nothing
 * time-dependent is kept, so an entry stays the answer for as long as its wave
 * is the same wave.
 */
interface CachedLane {
  readonly id: string;
  readonly bytes: number;
  readonly seat?: string;
  readonly reported?: LaneRow["reported"];
  readonly derived: {
    readonly alive: boolean;
    readonly exit?: number;
    readonly gate?: Gate;
    readonly pr?: PullRequest;
    readonly diff?: DiffStat;
    readonly planReview?: string;
    readonly risk?: string;
    readonly log?: {
      readonly bytes: number;
      readonly mtimeMs: number;
      readonly tail: boolean;
    };
  };
  readonly disagreements: number;
  readonly disagreement?: string;
  readonly freshReasons: readonly AttentionReason[];
  readonly staleReasons: readonly AttentionReason[];
}

/** One wave's lanes, kept against the wave the store handed over. */
interface CachedWave {
  readonly receivedAt: string;
  readonly intervalSeconds: number | null;
  readonly lanes: readonly CachedLane[];
}

/** The reported half of a lane without the free-form detail it may carry. */
function reportedOf(reported: LaneReported): NonNullable<LaneRow["reported"]> {
  return {
    stage: reported.stage,
    event: reported.event,
    ts: reported.ts,
    ...(reported.pr === undefined ? {} : { pr: reported.pr }),
    ...(reported.round === undefined ? {} : { round: reported.round }),
  };
}

/**
 * The UTF-8 length of a string, counted over its code units: below `0x80` is one
 * byte, below `0x800` is two, a well-formed surrogate pair is four for the pair
 * and anything else is three — a lone surrogate among them. It is asked for the
 * JSON text of a row, in which `JSON.stringify` has already written a lone
 * surrogate as an ASCII escape, so the answer is the length in bytes of what the
 * response will carry. No `Buffer` and no `TextEncoder`: this is the
 * application layer.
 */
export function utf8Length(text: string): number {
  let bytes = 0;
  let at = 0;
  while (at < text.length) {
    const code = text.charCodeAt(at);
    if (code < 0x80) {
      bytes += 1;
      at += 1;
    } else if (code < 0x800) {
      bytes += 2;
      at += 1;
    } else if (opensPairAt(text, at)) {
      bytes += 4;
      at += 2;
    } else {
      bytes += 3;
      at += 1;
    }
  }
  return bytes;
}

/** Whether the code unit at `at` is a high surrogate with its low one after it. */
function opensPairAt(text: string, at: number): boolean {
  const high = text.charCodeAt(at);
  if (high < 0xd800 || high > 0xdbff) {
    return false;
  }
  // Past the end of the string `charCodeAt` answers NaN, which is in no range.
  const low = text.charCodeAt(at + 1);
  return low >= 0xdc00 && low <= 0xdfff;
}

function cachedLane(lane: Lane): CachedLane {
  const derived = lane.derived;
  const log = derived.log;
  const row: Omit<CachedLane, "bytes" | "freshReasons" | "staleReasons"> = {
    id: lane.id,
    ...(lane.seat === undefined ? {} : { seat: lane.seat }),
    ...(lane.reported === undefined
      ? {}
      : { reported: reportedOf(lane.reported) }),
    derived: {
      alive: derived.alive,
      ...(derived.exit === undefined ? {} : { exit: derived.exit }),
      ...(derived.gate === undefined ? {} : { gate: derived.gate }),
      ...(derived.pr === undefined ? {} : { pr: derived.pr }),
      ...(derived.diff === undefined ? {} : { diff: derived.diff }),
      ...(derived.planReview === undefined
        ? {}
        : { planReview: derived.planReview }),
      ...(derived.risk === undefined ? {} : { risk: derived.risk }),
      // Whether a tail was pushed, never the tail: it is the heaviest string in
      // the envelope and the only drawer reads it.
      ...(log === undefined
        ? {}
        : {
            log: {
              bytes: log.bytes,
              mtimeMs: log.mtimeMs,
              tail: typeof log.tail === "string",
            },
          }),
    },
    disagreements: lane.disagreements.length,
    ...(lane.disagreements[0] === undefined
      ? {}
      : { disagreement: lane.disagreements[0] }),
  };
  return {
    ...row,
    // What the row costs, measured once: the wave it belongs to, the reasons and
    // the resolved `alive` are added per request and counted separately.
    bytes: utf8Length(JSON.stringify(row)),
    freshReasons: attentionReasons(lane, false),
    staleReasons: attentionReasons(lane, true),
  };
}

/**
 * One lane as a project's listing answers it. The wave and its staleness are
 * the request's to settle; the row is what the cache holds.
 */
function laneRow(cached: CachedLane, wave: string, stale: boolean): LaneRow {
  return {
    wave,
    id: cached.id,
    ...(cached.seat === undefined ? {} : { seat: cached.seat }),
    ...(cached.reported === undefined ? {} : { reported: cached.reported }),
    derived: {
      ...cached.derived,
      alive: aliveView(cached.derived.alive, stale),
    },
    disagreements: cached.disagreements,
    ...(cached.disagreement === undefined
      ? {}
      : { disagreement: cached.disagreement }),
    reasons: stale ? cached.staleReasons : cached.freshReasons,
  };
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
  lane: CachedLane,
  reasons: readonly AttentionReason[],
  receivedAt: string,
  stale: boolean,
): AttentionLane {
  const pr = lane.derived.pr?.number;
  return {
    project,
    wave: head.wave,
    lane: lane.id,
    ...(lane.seat === undefined ? {} : { seat: lane.seat }),
    reasons,
    receivedAt,
    stale,
    ...(pr === undefined ? {} : { pr }),
  };
}

export function createReadModel(deps: ReadModelDeps): ReadModel {
  const { store, now } = deps;

  /**
   * The lanes each wave has already been parsed into, keyed by project and wave,
   * in the order they were last used. A ten-second poll over a fleet re-reads the
   * same waves every time, and a wave is only re-parsed when its head says it is
   * not the wave that was read: the same `receivedAt` with a different number of
   * lanes is a push that landed inside one millisecond, which the store's own
   * resolution cannot tell apart.
   */
  const cache = new Map<string, CachedWave>();
  let cachedRows = 0;

  const forget = (key: string): void => {
    const dropped = cache.get(key);
    cache.delete(key);
    cachedRows -= dropped?.lanes.length ?? 0;
  };

  const overBounds = (): boolean =>
    cache.size > MAX_CACHED_WAVES || cachedRows > MAX_CACHED_ROWS;

  /**
   * Keeps a wave, and drops the ones used longest ago while either bound is
   * exceeded. A `Map` iterates in insertion order, which is the order of last
   * use here, so its first key is the one to go. The entry just inserted is the
   * last key and is never the one dropped, so a wave that is over the row bound
   * on its own is kept whole and read from the store again rather than re-parsed
   * on every poll.
   */
  const remember = (key: string, entry: CachedWave): void => {
    // A replaced key is deleted first, so that the entry answers as the newest.
    forget(key);
    cache.set(key, entry);
    cachedRows += entry.lanes.length;
    for (const oldest of cache.keys()) {
      if (oldest !== key && overBounds()) {
        forget(oldest);
      }
    }
  };

  /**
   * The lanes of one wave, from the cache when its head still describes the wave
   * the entry was built from, and from the store when it does not. Reading a wave
   * is a use of it, so an entry that is answered moves to the newest position:
   * a poll that asks for more waves than the map holds must not evict the wave it
   * is about to ask for. A wave the store no longer holds is not an answer and is
   * not cached: the head may describe a push that has not landed yet, so the next
   * read asks again.
   */
  const cachedWave = async (
    projectId: string,
    head: SnapshotHead,
  ): Promise<CachedWave | undefined> => {
    const key = `${projectId}/${head.wave}`;
    const hit = cache.get(key);
    if (
      hit !== undefined &&
      hit.receivedAt === head.receivedAt &&
      hit.lanes.length === head.lanes
    ) {
      cache.delete(key);
      cache.set(key, hit);
      return hit;
    }
    const snapshot = await store.getSnapshot(projectId, head.wave);
    if (snapshot === undefined) {
      return undefined;
    }
    const entry: CachedWave = {
      receivedAt: snapshot.receivedAt,
      // The staleness of a wave is its own receive time and its own interval, so
      // both are read from the snapshot: a push that lands between the heads and
      // the snapshot must not be judged by the head it replaced.
      intervalSeconds: snapshot.envelope.intervalSeconds,
      lanes: snapshot.envelope.lanes.map(cachedLane),
    };
    remember(key, entry);
    return entry;
  };

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
      return waveSummaries(heads, nowMs);
    },

    /**
     * Every lane of one project's waves in the order the wave route already
     * answers its waves: newest wave first, and each wave's own order inside it.
     * `all` widens the scope from the waves the store is meant to be holding to
     * every wave it holds. The rows are the cache's, so a poll that finds nothing
     * new parses nothing, and the read stops at whichever bound it reaches first
     * rather than reading the waves whose rows it would have to throw away.
     */
    async listLanes(
      projectId: string,
      all: boolean,
    ): Promise<ProjectLanesView | undefined> {
      const project = await store.getProject(projectId);
      if (project === undefined) {
        return undefined;
      }
      const nowMs = now();
      const waves = waveSummaries(
        await store.listSnapshotHeads(projectId),
        nowMs,
      );
      const rows: LaneRow[] = [];
      let bytes = 0;
      let read = 0;
      let truncated = false;
      // Set when a bound has stopped the rows. No later wave can add one either,
      // and each of them that holds lanes means rows that are not listed.
      let stopped = false;
      for (const summary of waves) {
        if (!all && !summary.retained) {
          continue;
        }
        if (rows.length === MAX_PROJECT_LANES || stopped) {
          // A bound is spent. The head carries the number of lanes, so a wave
          // that has any is known to hold rows that are not listed, and no
          // snapshot is read to learn it.
          truncated = truncated || summary.lanes > 0;
          continue;
        }
        if (summary.lanes === 0) {
          // Nothing to read, and the head has already said so.
          continue;
        }
        if (read === MAX_WAVES_PER_READ) {
          // The wave bound is spent: the rest are heads only, and each that holds
          // lanes means rows that are not listed.
          truncated = truncated || summary.lanes > 0;
          stopped = true;
          continue;
        }
        read += 1;
        const entry = await cachedWave(projectId, summary);
        if (entry === undefined) {
          continue;
        }
        for (const lane of entry.lanes) {
          const cost = lane.bytes + ROW_OVERHEAD_BYTES;
          // The first row is answered whatever it costs: a reader told nothing
          // cannot tell a lane from a lane that is missing.
          if (
            rows.length === MAX_PROJECT_LANES ||
            (rows.length > 0 && bytes + cost > MAX_PROJECT_LANES_BYTES)
          ) {
            truncated = true;
            stopped = true;
            break;
          }
          bytes += cost;
          rows.push(laneRow(lane, summary.wave, summary.stale));
        }
      }
      return {
        project: {
          id: project.id,
          name: project.name,
          ...(project.repo === undefined ? {} : { repo: project.repo }),
        },
        waves,
        lanes: rows,
        truncated,
      };
    },

    /**
     * Every lane of every project's recent waves that wants a reader, newest
     * receive first. It reads the wave heads of every project and then the lanes
     * of the waves still inside the attention window, through the same cache the
     * project listing uses, and never `listSnapshots`: a fleet of projects is
     * answered from one wave each.
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
          const entry = await cachedWave(project.id, head);
          if (entry === undefined) {
            // The wave went away between the heads and the snapshot: another
            // push for the same wave, or a deletion. Either way it is not there
            // to be listed, and there is nothing to fail this answer over.
            continue;
          }
          const stale = isStale(
            Date.parse(entry.receivedAt),
            entry.intervalSeconds,
            nowMs,
          );
          for (const lane of entry.lanes) {
            const reasons = stale ? lane.staleReasons : lane.freshReasons;
            if (reasons.length === 0) {
              continue;
            }
            count += 1;
            matched.push(
              attentionLane(
                project.id,
                head,
                lane,
                reasons,
                entry.receivedAt,
                stale,
              ),
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
