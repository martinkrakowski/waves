import {
  type BacklogState,
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
  type ProjectStatus,
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
import {
  waveState,
  type WaveState,
  type WaveStateLane,
} from "../domain/wave-state.js";
import {
  type SnapshotHead,
  type StorePort,
  type StoredStatus,
} from "./ports/store.js";

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
 * The most wave heads one project's listing answers with, whatever the project
 * holds. A project that pushes a new wave id every ten minutes reaches a
 * thousand of them in a week, and the page's wave strip is unreadable long
 * before that; at about 190 bytes a head this bounds the strip near 190 KiB. The
 * rows are not cut with it — the row loop walks every head, as it always has,
 * and its own bounds stop it — so this bounds what the wave strip carries and
 * nothing else in the answer.
 */
export const MAX_LISTED_WAVES = 1_000;

/**
 * How many waves' computed rows one read model holds at once, and how many rows
 * they may add up to. The wave count is generous on purpose: a poll that asks
 * for more waves than this would evict each of them just before it asked for it,
 * so what bounds memory is the row count. A wave is dropped only when it has not
 * been used for longer than every other one.
 */
export const MAX_CACHED_WAVES = 512;
export const MAX_CACHED_ROWS = 10_000;

/**
 * The most waves one project summary carries, of all the waves it holds. Cold,
 * the route reads at most this many × N snapshots for a fleet of N projects;
 * warm, it reads none at all, because the answers are the cache's. It is a
 * bound about the cache as much as about the answer: 12 × N stays inside
 * `MAX_CACHED_WAVES` (512) while the rows it holds stay under
 * `MAX_CACHED_ROWS` (10 000) for about 42 projects, and past that a
 * `?all=1` listing of one large project can evict fleet entries, which then
 * cost one parse each on the next poll.
 */
export const MAX_RECENT_WAVES = 12;

/**
 * The most waves the cross-project view reads in one request, a fact about the
 * cache rather than about the view: it is below `MAX_CACHED_WAVES`, so the wave
 * bound alone can never make one request evict the entry it is about to ask for
 * next. The row bound still can, when the waves are large ones, which is what the
 * cache is for. Every wave received inside the attention window is collected and
 * sorted before any of them is read, so the waves that are read are the newest
 * ones whatever order the store answered its heads in.
 */
export const MAX_ATTENTION_WAVES = 256;

/**
 * One of a project's waves as a fleet card reads it: what the wave is called,
 * when it arrived, how many lanes it holds, what those lanes say about the wave,
 * whether the wave has gone past the point where its own interval says it should
 * have pushed again, and how many of its lanes have a merged pull request.
 *
 * `lanes` is counted from the cached entry rather than from the head the wave
 * was chosen by, because `merged` is too: a push that lands between the heads
 * and the snapshot can hold more lanes than the head said, and a `lanes` from
 * the head beside a `merged` from the snapshot would break `merged <= lanes`
 * and take the whole project list down for a poll.
 */
export interface RecentWave {
  readonly wave: string;
  readonly receivedAt: string;
  readonly lanes: number;
  readonly state: WaveState;
  readonly stale: boolean;
  readonly merged: number;
}

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
  /**
   * The project's newest at most `MAX_RECENT_WAVES` **retained** waves, newest
   * receive first, each with the state its lanes derive. A project with no
   * retained wave answers an empty list: the field is never absent, so a reader
   * asks for the waves of a project and gets none rather than a key it has to
   * guess about.
   */
  readonly recentWaves: readonly RecentWave[];
  /**
   * The two facts a fleet card shows about the project's own status, and not the
   * document itself: when it arrived, whether it has gone past the window its own
   * `intervalSeconds` sets, and the two counts it carries. Absent when the
   * project has pushed no status at all, and every optional key inside it absent
   * when the document does not carry the field — `prsSkipped` is a `0` a reader
   * would read as "no rows were unread", which is not what "no `prs` was sent"
   * means.
   */
  readonly status?: {
    readonly receivedAt: string;
    readonly stale: boolean;
    readonly prsSkipped?: number;
    readonly backlogState?: BacklogState;
  };
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

/**
 * A project's status document with the two facts a rule reads about it: the
 * instant the service received it, and whether that is past the window its own
 * `intervalSeconds` sets. Both are the same rule the wave view uses, with the
 * same clock and the same `null` default — what differs is only the document.
 */
export interface StatusView {
  readonly status: ProjectStatus;
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
  /**
   * The waves inside the attention window holding at least one lane that this
   * request did not read (a wave with no lanes can match nothing and is never
   * counted), which
   * `truncated` is then `true` for: the list may be missing lanes a reader would
   * otherwise see, and no other field of this view says how many. While it is
   * above zero each project's `attention` count covers the waves that were read
   * only, so a project none of whose waves was read still appears, with `0`.
   */
  readonly wavesOmitted: number;
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
  /** How many heads `waves` leaves out: past the newest `MAX_LISTED_WAVES`. */
  readonly wavesOmitted: number;
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
  getStatus(projectId: string): Promise<StatusView | undefined>;
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

/** Whether a stored status is past the window its own interval sets. */
function statusStale(stored: StoredStatus, nowMs: number): boolean {
  return isStale(
    Date.parse(stored.receivedAt),
    stored.status.intervalSeconds,
    nowMs,
  );
}

/**
 * The two facts a fleet card shows about a project's status. Every optional key
 * is present exactly when the document carries the field it comes from: a
 * `prsSkipped` of `0` would say no rows went unread, which is not what a
 * document that never mentioned `prs` says.
 */
function statusFacts(
  stored: StoredStatus,
  nowMs: number,
): NonNullable<ProjectSummary["status"]> {
  const { prs, backlog } = stored.status;
  return {
    receivedAt: stored.receivedAt,
    stale: statusStale(stored, nowMs),
    ...(prs === undefined ? {} : { prsSkipped: prs.skipped }),
    ...(backlog === undefined ? {} : { backlogState: backlog.state }),
  };
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

/**
 * The four facts about a cached lane that a wave's state reads, and nothing
 * else. The reported event and the pull request state are optional because a
 * lane that has neither is the state of a lane that has said nothing.
 */
function stateLane(lane: CachedLane): WaveStateLane {
  return {
    alive: lane.derived.alive,
    ...(lane.derived.exit === undefined ? {} : { exit: lane.derived.exit }),
    ...(lane.reported === undefined ? {} : { event: lane.reported.event }),
    ...(lane.derived.pr === undefined
      ? {}
      : { prState: lane.derived.pr.state }),
  };
}

/**
 * One wave as a project summary carries it, read from the cache entry rather
 * than from the head it was chosen by: `receivedAt`, `lanes` and the `stale`
 * flag all come from the snapshot that answered, exactly as `listAttention`
 * reads them, because a push can land between the heads and the snapshot and
 * the entry is the push the reader is being told about. The head supplies only
 * which wave this is.
 */
function recentWave(
  head: SnapshotHead,
  entry: CachedWave,
  nowMs: number,
): RecentWave {
  const stale = isStale(
    Date.parse(entry.receivedAt),
    entry.intervalSeconds,
    nowMs,
  );
  let merged = 0;
  for (const lane of entry.lanes) {
    if (lane.derived.pr?.state === "merged") {
      merged += 1;
    }
  }
  return {
    wave: head.wave,
    receivedAt: entry.receivedAt,
    lanes: entry.lanes.length,
    state: waveState(entry.lanes.map(stateLane), stale),
    stale,
    merged,
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

  /**
   * A project's status for the fleet listing, or nothing when its stored file
   * is not JSON: one corrupt file costs that card its status row, never the
   * whole listing. Any other failure (a directory the store refuses, a read the
   * kernel refused) is not about one file, and it still fails the listing.
   */
  const summaryStatus = async (
    projectId: string,
  ): Promise<StoredStatus | undefined> => {
    try {
      return await store.getStatus(projectId);
    } catch (error) {
      if (error instanceof SyntaxError) {
        return undefined;
      }
      throw error;
    }
  };

  /**
   * A project's newest retained waves, through the same cache the project
   * listing and the cross-project view use. Retention and the order come from
   * the wave summaries, so the waves listed are the ones `waveSummaries` would
   * order newest first, and a wave past the retention is never read at all.
   *
   * A wave the cache answers `undefined` for — one that went away between the
   * heads and the snapshot — is skipped rather than listed empty: there is
   * nothing there to describe, and a poll that finds one must still answer the
   * rest of the fleet.
   */
  const recentWaves = async (
    projectId: string,
    heads: readonly SnapshotHead[],
    nowMs: number,
  ): Promise<readonly RecentWave[]> => {
    const recent: RecentWave[] = [];
    // Retention first, so a project's long tail of old heads is never sorted
    // on the fleet's hottest read.
    const newest = waveSummaries(
      heads.filter((head) => isRetained(Date.parse(head.receivedAt), nowMs)),
      nowMs,
    ).slice(0, MAX_RECENT_WAVES);
    for (const head of newest) {
      // One wave file that is not JSON costs this card that one segment, never
      // the fleet listing, as a corrupt status file costs only its row. Any other
      // failure is not about one file, and it still fails the listing.
      let entry: CachedWave | undefined;
      try {
        entry = await cachedWave(projectId, head);
      } catch (error) {
        if (!(error instanceof SyntaxError)) {
          throw error;
        }
        continue;
      }
      if (entry !== undefined) {
        recent.push(recentWave(head, entry, nowMs));
      }
    }
    return recent;
  };

  return {
    async listProjects(): Promise<readonly ProjectSummary[]> {
      const projects = await store.listProjects();
      const nowMs = now();
      const summaries: ProjectSummary[] = [];
      for (const project of projects) {
        const heads = await store.listSnapshotHeads(project.id);
        const newest = newestHead(heads);
        // One status read per project, beside the heads: the card shows two facts
        // about it, and a project that has pushed none has no key to show at all.
        const status = await summaryStatus(project.id);
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
          recentWaves: await recentWaves(project.id, heads, nowMs),
          ...(status === undefined
            ? {}
            : { status: statusFacts(status, nowMs) }),
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
     * Every lane of one project's waves in the order the wave route answers its
     * waves, newest wave first, and each wave's own order inside it — as far as
     * `MAX_LISTED_WAVES` heads carry that list. `all` widens the scope from the
     * waves the store is meant to be holding to every wave it holds. The rows are
     * the cache's, so a poll that finds nothing new parses nothing, and the read
     * stops at whichever bound it reaches first rather than reading the waves
     * whose rows it would have to throw away.
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
      const heads = waveSummaries(
        await store.listSnapshotHeads(projectId),
        nowMs,
      );
      // Which heads are LISTED and which are READ for rows are separate
      // questions, and only the first is cut here: the rows loop below walks
      // every head, as it always has, and its own bounds stop it. So the rows and
      // `truncated` are exactly what they were, and a wave too old to be listed
      // can still have its lanes in the table.
      //
      // Retention is a function of the receive time alone (`isRetained`), so in
      // a newest-first list every retained head already precedes every
      // unretained one: cutting at the bound keeps every retained head ahead of
      // every wave past retention, with nothing left to reorder.
      const waves = heads.slice(0, MAX_LISTED_WAVES);
      const rows: LaneRow[] = [];
      let bytes = 0;
      let read = 0;
      let truncated = false;
      // Set when a bound has stopped the rows. No later wave can add one either,
      // and each of them that holds lanes means rows that are not listed.
      let stopped = false;
      for (const summary of heads) {
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
        wavesOmitted: heads.length - waves.length,
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
     *
     * The heads inside the window are collected and sorted before any snapshot is
     * read, so which waves the request reads is decided by receive time rather
     * than by the order the store answered its heads in, and it reads at most
     * `MAX_ATTENTION_WAVES` of them. Each project's newest wave in the window is
     * read before any project's second: one busy project pushing many wave ids
     * would otherwise fill the bound on its own and leave every other project
     * answering zero. Everything the answer says about a project is then counted
     * from the waves that were read.
     */
    async listAttention(): Promise<AttentionView> {
      const nowMs = now();
      const projects = await store.listProjects();
      const inWindow: {
        readonly project: string;
        readonly head: SnapshotHead;
        readonly ms: number;
      }[] = [];
      for (const project of projects) {
        const heads = await store.listSnapshotHeads(project.id);
        for (const head of heads) {
          // A wave with no lanes can match no lane, so it takes no read slot and
          // is not counted as left out.
          if (head.lanes === 0) {
            continue;
          }
          const ms = Date.parse(head.receivedAt);
          if (inAttentionWindow(ms, nowMs)) {
            inWindow.push({ project: project.id, head, ms });
          }
        }
      }
      // Newest receive first, and `Array.prototype.sort` is stable, so waves that
      // arrived within the same millisecond keep the order they were found in:
      // project order, then wave order. Each receive time is parsed once, above.
      inWindow.sort((left, right) => right.ms - left.ms);
      // Every project's newest wave first, then the rest by receive time.
      const newest: typeof inWindow = [];
      const rest: typeof inWindow = [];
      const seen = new Set<string>();
      for (const item of inWindow) {
        if (seen.has(item.project)) {
          rest.push(item);
        } else {
          seen.add(item.project);
          newest.push(item);
        }
      }
      const toRead = [...newest, ...rest].slice(0, MAX_ATTENTION_WAVES);
      // Every registered project answers, in the order the registry answered it,
      // and a project none of whose waves was read is one of them with `0`.
      const counts = new Map<string, number>();
      const matched: AttentionLane[] = [];
      for (const { project, head } of toRead) {
        const entry = await cachedWave(project, head);
        if (entry === undefined) {
          // The wave went away between the heads and the snapshot: another push
          // for the same wave, or a deletion. Either way it is not there to be
          // listed, and there is nothing to fail this answer over.
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
          counts.set(project, (counts.get(project) ?? 0) + 1);
          matched.push(
            attentionLane(
              project,
              head,
              lane,
              reasons,
              entry.receivedAt,
              stale,
            ),
          );
        }
      }
      // `Array.prototype.sort` is stable, so lanes that arrived within the same
      // millisecond keep the order they were found in: wave order, then the order
      // the wave itself lists its lanes in.
      const lanes = matched
        .slice()
        .sort(
          (left, right) =>
            Date.parse(right.receivedAt) - Date.parse(left.receivedAt),
        )
        .slice(0, MAX_ATTENTION_LANES);
      // The count is what the project asked for, not what the lane cap below lets
      // through: a reader is told how much the list it is holding is not. A
      // project whose waves were none of them read has no count at all and
      // answers zero.
      const perProject = projects.map((project) => ({
        id: project.id,
        attention: counts.get(project.id) ?? 0,
      }));
      const wavesOmitted = inWindow.length - toRead.length;
      return {
        lanes,
        projects: perProject,
        truncated: wavesOmitted > 0 || matched.length > lanes.length,
        wavesOmitted,
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

    /**
     * One project's own status document, or undefined when it has pushed none
     * or does not exist. Both are the same `404` at the route — a project the
     * server has never heard of and one that has said nothing about itself are
     * not two things a reader can be told apart. The project is looked up first,
     * as the wave list does: a status write that finished after its project was
     * deleted leaves a file the registry no longer vouches for, and it is never
     * served.
     */
    async getStatus(projectId: string): Promise<StatusView | undefined> {
      if ((await store.getProject(projectId)) === undefined) {
        return undefined;
      }
      const stored = await store.getStatus(projectId);
      if (stored === undefined) {
        return undefined;
      }
      return {
        status: stored.status,
        receivedAt: stored.receivedAt,
        stale: statusStale(stored, now()),
        staleAfterMs: staleAfterMs(stored.status.intervalSeconds),
      };
    },
  };
}
