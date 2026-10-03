import { describe, expect, it } from "vitest";

import type { StoredSnapshot } from "@hexagen-monaco/waves-contract";

import {
  createReadModel,
  MAX_ATTENTION_WAVES,
  MAX_CACHED_ROWS,
  MAX_CACHED_WAVES,
  MAX_LISTED_WAVES,
  MAX_PROJECT_LANES,
  MAX_PROJECT_LANES_BYTES,
  MAX_WAVES_PER_READ,
  utf8Length,
} from "../src/application/read-model.js";
import { MemoryStore } from "../src/infrastructure/memory-store.js";
import { project, snapshot, status, withLanes } from "./store-contract.js";

type Lane = StoredSnapshot["envelope"]["lanes"][number];

const PUSHED_AT_MS = Date.parse("2026-10-01T12:00:00Z");
const RECEIVED_AT_MS = PUSHED_AT_MS + 1_000;
const RECEIVED_AT = "2026-10-01T12:00:01Z";
const BOUNDARY_MS = 30_000;
const NOW_MS = PUSHED_AT_MS + 20_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function withLane(wave: string, alive: boolean): StoredSnapshot {
  return {
    envelope: {
      ...snapshot(wave).envelope,
      lanes: [{ id: `${wave}-a`, derived: { alive }, disagreements: [] }],
    },
    receivedAt: RECEIVED_AT,
  };
}

/** A lane of a wave that wants a reader, whatever the wave's staleness. */
function laneOf(id: string, overrides: Partial<Lane> = {}): Lane {
  return {
    id,
    derived: { alive: false, exit: 1 },
    disagreements: [],
    ...overrides,
  };
}

/** One wave of one project, received when the argument says. */
function pushed(
  of: string,
  wave: string,
  receivedAt: string,
  lanes: Lane[],
): StoredSnapshot {
  return {
    envelope: { ...snapshot(wave).envelope, project: of, wave, lanes },
    receivedAt,
  };
}

/** An ISO time the given number of milliseconds before the model reads the clock. */
function agoFrom(nowMs: number, olderMs: number): string {
  return new Date(nowMs - olderMs).toISOString();
}

/** A wave of as many lanes as asked, every one of them reporting a failure. */
function failing(wave: string, count: number): StoredSnapshot {
  const base = withLanes(wave, count);
  return {
    ...base,
    envelope: {
      ...base.envelope,
      lanes: base.envelope.lanes.map((lane) => ({
        ...lane,
        reported: {
          stage: "implement",
          event: "failed",
          ts: "2026-10-01T12:00:00Z",
        },
      })),
    },
  };
}

/** The caps `waves/v1` puts on a lane, which the size test fills to the letter. */
const LANE_ID_CHARS = 80;
const SEAT_CHARS = 128;
const STAGE_CHARS = 32;
const REVIEW_CHARS = 200;
const DISAGREEMENTS = 20;
const DISAGREEMENT_CHARS = 300;
const LANES_PER_WAVE = 200;
const TAIL_TEXT = "the tail text that must never reach a project listing";
const DETAIL_TEXT = "the detail text that must never reach a listing either";

/** 80 characters of the lane-id alphabet, indexed by the number given. */
function bigLaneId(index: number): string {
  const prefix = `${String(index).padStart(3, "0")}-`;
  return `${prefix}${"l".repeat(LANE_ID_CHARS - prefix.length)}`;
}

/**
 * A lane as large as the contract allows: every string at its cap, a full gate,
 * a pull request, a diff, a log with a tail and a detail. The caps are in
 * characters and the contract refuses only control characters, so the fill
 * decides what the row costs in bytes: a `"` is two once JSON has escaped it,
 * CJK text is three, and a lone surrogate is six as `\udXXX`. The lane id and
 * the stage keep to their patterns, which are ASCII.
 *
 * The lane is alive with no exit, so in a wave that has gone stale it carries
 * five reasons of its own: `failed`, `disagreement`, `checks`, `gate` and
 * `silent`.
 */
function biggestLane(index: number, fill: string): Lane {
  return {
    id: bigLaneId(index),
    seat: fill.repeat(SEAT_CHARS),
    reported: {
      // A stage is a-z and hyphens, so 32 characters is 31 hyphens after the first.
      stage: `s${"-".repeat(STAGE_CHARS - 1)}`,
      event: "failed",
      ts: "2026-10-01T12:00:00Z",
      pr: 123_456,
      round: 7,
      detail: { note: DETAIL_TEXT },
    },
    derived: {
      alive: true,
      gate: {
        exit: 255,
        coverage: {
          statements: 99.99,
          branches: 99.99,
          functions: 99.99,
          lines: 99.99,
        },
      },
      pr: {
        number: 123_456,
        state: "open",
        checks: "fail",
        unresolvedThreads: "unknown",
      },
      diff: { files: 12, insertions: 3_456, deletions: 789 },
      log: { bytes: 9_999_999, mtimeMs: 1_759_320_000_000, tail: TAIL_TEXT },
      planReview: fill.repeat(REVIEW_CHARS),
      risk: fill.repeat(REVIEW_CHARS),
    },
    disagreements: Array.from(
      { length: DISAGREEMENTS },
      (_unused, at) =>
        `${String(at).padStart(3, "0")}${fill.repeat(DISAGREEMENT_CHARS - 3)}`,
    ),
  };
}

/** A lane small enough that the cap's whole 2 000 fit inside the byte bound. */
function plainLane(index: number): Lane {
  return {
    id: bigLaneId(index),
    reported: {
      stage: "implement",
      event: "settled",
      ts: "2026-10-01T12:00:00Z",
    },
    derived: { alive: false, exit: 0, planReview: "looks good" },
    disagreements: [],
  };
}

/** The wave a wave index stands for, newest last. */
function waveIdOf(index: number): string {
  return `wv${String(index).padStart(3, "0")}`;
}

/** The wave id of the largest length `waves/v1` allows, unique by its index. */
function longWaveIdOf(index: number): string {
  return `wv${String(index).padStart(3, "0")}${"w".repeat(75)}`;
}

/** One second after the wave before it, so the newest wave is the last index. */
function receivedAtOf(index: number): string {
  return new Date(RECEIVED_AT_MS + index * 1_000).toISOString();
}

/** A project holding `waves` waves of lanes built by `build`, newest last. */
async function filled(
  store: MemoryStore,
  of: string,
  waves: number,
  build: (wave: string, index: number) => Lane[],
  id: (index: number) => string = waveIdOf,
): Promise<void> {
  await store.putProject(project(of));
  for (let index = 1; index <= waves; index += 1) {
    const wave = id(index);
    await store.putSnapshot(
      pushed(of, wave, receivedAtOf(index), build(wave, index)),
    );
  }
}

/**
 * A store that loses one named wave between its heads and its snapshot, and
 * counts what it was asked for. `MemoryStore` keeps the two in step, so the one
 * answer a real store can give and this one cannot is a head whose snapshot has
 * gone; and the fleet route is only cheap if it never reads every wave.
 */
class WaryStore extends MemoryStore {
  readonly #gone: string;
  readonly asked: string[] = [];
  wholeLists = 0;

  constructor(gone: string) {
    super();
    this.#gone = gone;
  }

  override async getSnapshot(
    of: string,
    wave: string,
  ): Promise<StoredSnapshot | undefined> {
    this.asked.push(wave);
    if (wave === this.#gone) {
      return undefined;
    }
    return super.getSnapshot(of, wave);
  }

  override async listSnapshots(of: string): Promise<readonly StoredSnapshot[]> {
    this.wholeLists += 1;
    return super.listSnapshots(of);
  }
}

/**
 * A store whose waves are replaced between the heads a request read and the
 * snapshot it then asks for: what comes back was received later, and says an
 * interval of its own. It is the one answer a store can give and `MemoryStore`
 * cannot, and a reader that mixes the head's interval with the snapshot's
 * receive time gets the wrong answer from it.
 */
class ReplacedStore extends WaryStore {
  override async getSnapshot(
    of: string,
    wave: string,
  ): Promise<StoredSnapshot | undefined> {
    const stored = await super.getSnapshot(of, wave);
    if (stored === undefined) {
      return undefined;
    }
    return {
      ...stored,
      receivedAt: new Date(Date.parse(stored.receivedAt) + 2_000).toISOString(),
      envelope: { ...stored.envelope, intervalSeconds: 300 },
    };
  }
}

function model(store: MemoryStore, nowMs: number = NOW_MS) {
  return createReadModel({
    store,
    now: () => nowMs,
  });
}

describe("read model", () => {
  it("lists the projects without the token", async () => {
    const store = new MemoryStore();
    await store.putProject(project("alpha", "Alpha"));
    await store.putProject({
      id: "beta",
      name: "Beta",
      tokenSha256: "c".repeat(64),
      registeredAt: "2026-09-01T09:00:00Z",
    });
    await store.putSnapshot(snapshot("wv1"));

    const projects = await model(store).listProjects();

    expect(projects).toEqual([
      {
        id: "alpha",
        name: "Alpha",
        repo: "https://example.com/alpha.git",
        registeredAt: "2026-10-01T12:00:00Z",
        waves: 1,
        lanes: 0,
        lastPush: "2026-10-01T12:00:01Z",
        stale: false,
      },
      {
        id: "beta",
        name: "Beta",
        repo: undefined,
        registeredAt: "2026-09-01T09:00:00Z",
        waves: 0,
        lanes: 0,
        lastPush: undefined,
        stale: false,
      },
    ]);
    expect(JSON.stringify(projects)).not.toContain("tokenSha256");
  });

  it("counts the waves and reports the most recent push", async () => {
    const store = new MemoryStore();
    await store.putProject(project("alpha"));
    await store.putSnapshot(snapshot("wv1"));
    await store.putSnapshot({
      ...snapshot("wv2"),
      receivedAt: "2026-10-01T11:00:05Z",
    });
    await store.putSnapshot({
      ...snapshot("wv3"),
      receivedAt: "2026-10-01T13:00:05Z",
    });

    const projects = await model(store).listProjects();

    expect(projects[0]?.waves).toBe(3);
    expect(projects[0]?.lastPush).toBe("2026-10-01T13:00:05Z");
  });

  it("counts the lanes of a project's waves", async () => {
    const store = new MemoryStore();
    await store.putProject(project("alpha"));
    await store.putSnapshot(withLanes("wv1", 2));
    await store.putSnapshot(withLanes("wv2", 3));

    const projects = await model(store).listProjects();

    expect(projects[0]?.lanes).toBe(5);
  });

  it("counts no lane for a project that has pushed nothing", async () => {
    const store = new MemoryStore();
    await store.putProject(project("alpha"));

    const projects = await model(store).listProjects();

    expect(projects[0]?.waves).toBe(0);
    expect(projects[0]?.lanes).toBe(0);
  });

  it("leaves a wave the store is past retaining out of the lane count", async () => {
    const store = new MemoryStore();
    await store.putProject(project("alpha"));
    await store.putSnapshot(withLanes("wv1", 2));
    await store.putSnapshot({
      ...withLanes("wv2", 3),
      receivedAt: agoFrom(NOW_MS, 15 * DAY_MS),
    });

    const projects = await model(store).listProjects();

    expect(projects[0]?.waves).toBe(2);
    expect(projects[0]?.lanes).toBe(2);
  });

  it("marks a project stale on its newest wave, not on its oldest", async () => {
    const store = new MemoryStore();
    await store.putProject(project("alpha"));
    // An interval of 10 seconds is stale after 30, so an hour-old wave is long
    // overdue while the newest one is not until half a minute after it arrived.
    await store.putSnapshot({
      ...snapshot("wv1"),
      receivedAt: "2026-10-01T11:00:01Z",
    });
    await store.putSnapshot({
      ...snapshot("wv2"),
      receivedAt: "2026-10-01T11:59:40Z",
    });

    const fresh = await model(store, PUSHED_AT_MS + 10_000).listProjects();
    const overdue = await model(store, PUSHED_AT_MS + 60_000).listProjects();

    expect(fresh[0]?.stale).toBe(false);
    expect(overdue[0]?.stale).toBe(true);
  });

  it("does not mark a project with no waves stale", async () => {
    const store = new MemoryStore();
    await store.putProject(project("alpha"));

    const projects = await model(store, PUSHED_AT_MS + DAY_MS).listProjects();

    expect(projects[0]).toMatchObject({
      waves: 0,
      lastPush: undefined,
      stale: false,
    });
  });

  it("marks a project stale when its newest wave says nothing about an interval", async () => {
    const store = new MemoryStore();
    await store.putProject(project("alpha"));
    await store.putSnapshot({
      ...snapshot("wv1"),
      envelope: { ...snapshot("wv1").envelope, intervalSeconds: null },
    });

    // No interval means the default five minutes, counted from the moment the
    // wave arrived rather than from the moment the test started.
    const projects = await model(store, PUSHED_AT_MS + 299_000).listProjects();
    const overdue = await model(store, PUSHED_AT_MS + 302_000).listProjects();

    expect(projects[0]?.stale).toBe(false);
    expect(overdue[0]?.stale).toBe(true);
  });

  it("leaves the status key out of a project that has pushed none", async () => {
    const store = new MemoryStore();
    await store.putProject(project("alpha"));
    await store.putSnapshot(snapshot("wv1"));

    const projects = await model(store).listProjects();

    expect(projects[0]?.status).toBeUndefined();
    expect(Object.hasOwn(projects[0] as object, "status")).toBe(false);
  });

  it("carries the two status facts a card shows, and nothing more", async () => {
    const store = new MemoryStore();
    await store.putProject(project("alpha"));
    await store.putStatus({
      status: status("alpha"),
      receivedAt: RECEIVED_AT,
    });

    const projects = await model(store).listProjects();

    expect(projects[0]?.status).toEqual({
      receivedAt: RECEIVED_AT,
      stale: false,
      prsSkipped: 2,
      backlogState: "recorded",
    });
    expect(JSON.stringify(projects[0]?.status)).not.toContain("premises");
  });

  it("leaves a summary fact out when the document does not carry its field", async () => {
    const store = new MemoryStore();
    await store.putProject(project("alpha"));
    await store.putProject(project("beta"));
    // A document that never mentioned `prs` and one that never mentioned
    // `backlog`: a `prsSkipped` of `0` would say no rows went unread, which is
    // not what silence said.
    await store.putStatus({
      status: status("alpha", { prs: undefined }),
      receivedAt: RECEIVED_AT,
    });
    await store.putStatus({
      status: status("beta", { backlog: undefined }),
      receivedAt: RECEIVED_AT,
    });

    const projects = await model(store).listProjects();

    expect(projects[0]?.status).toEqual({
      receivedAt: RECEIVED_AT,
      stale: false,
      backlogState: "recorded",
    });
    expect(projects[1]?.status).toEqual({
      receivedAt: RECEIVED_AT,
      stale: false,
      prsSkipped: 2,
    });
  });

  it("counts a skipped pull-request row of zero as a zero, not as silence", async () => {
    const store = new MemoryStore();
    await store.putProject(project("alpha"));
    await store.putStatus({
      status: status("alpha", { prs: { skipped: 0 }, backlog: undefined }),
      receivedAt: RECEIVED_AT,
    });

    expect((await model(store).listProjects())[0]?.status).toEqual({
      receivedAt: RECEIVED_AT,
      stale: false,
      prsSkipped: 0,
    });
  });

  it("marks a summary status stale on its own interval", async () => {
    const store = new MemoryStore();
    await store.putProject(project("alpha"));
    await store.putStatus({
      status: status("alpha"),
      receivedAt: RECEIVED_AT,
    });

    // An interval of 10 seconds goes stale after 30, exactly as a wave's does.
    const inside = await model(store, RECEIVED_AT_MS + 10_000).listProjects();
    const outside = await model(store, RECEIVED_AT_MS + 60_000).listProjects();

    expect(inside[0]?.status?.stale).toBe(false);
    expect(outside[0]?.status?.stale).toBe(true);
  });

  it("answers a project's status document, or undefined when there is none", async () => {
    const store = new MemoryStore();
    await store.putProject(project("alpha"));

    expect(await model(store).getStatus("alpha")).toBeUndefined();

    await store.putStatus({
      status: status("alpha"),
      receivedAt: RECEIVED_AT,
    });

    expect(await model(store).getStatus("alpha")).toEqual({
      status: status("alpha"),
      receivedAt: RECEIVED_AT,
      stale: false,
      staleAfterMs: BOUNDARY_MS,
    });
    expect(await model(store).getStatus("absent")).toBeUndefined();
  });

  it("never serves a status its registry does not vouch for", async () => {
    // A status write that finished after its project was deleted.
    const store = new MemoryStore();
    await store.putStatus({ status: status("alpha"), receivedAt: RECEIVED_AT });

    expect(await model(store).getStatus("alpha")).toBeUndefined();
  });

  it("answers a status fresh inside its own window, and with the default past it", async () => {
    const store = new MemoryStore();
    await store.putProject(project("alpha"));
    await store.putStatus({
      status: status("alpha", { intervalSeconds: null }),
      receivedAt: RECEIVED_AT,
    });

    const inside = await model(store, RECEIVED_AT_MS + 1000).getStatus("alpha");
    const outside = await model(store, RECEIVED_AT_MS + 302_000).getStatus(
      "alpha",
    );

    expect(inside?.stale).toBe(false);
    expect(inside?.staleAfterMs).toBe(300_000);
    expect(outside?.stale).toBe(true);
  });

  it("lists the waves of a project newest first", async () => {
    const store = new MemoryStore();
    await store.putProject(project("alpha"));
    await store.putSnapshot(withLane("wv1", true));
    await store.putSnapshot({
      ...withLane("wv2", false),
      envelope: { ...withLane("wv2", false).envelope, intervalSeconds: null },
      receivedAt: "2026-10-01T12:00:02Z",
    });

    const waves = await model(store).listWaves("alpha");

    expect(waves).toEqual([
      {
        wave: "wv2",
        receivedAt: "2026-10-01T12:00:02Z",
        intervalSeconds: null,
        stale: false,
        retained: true,
        lanes: 1,
      },
      {
        wave: "wv1",
        receivedAt: "2026-10-01T12:00:01Z",
        intervalSeconds: 10,
        stale: false,
        retained: true,
        lanes: 1,
      },
    ]);
  });

  it("calls a wave stale only past the staleness boundary", async () => {
    const store = new MemoryStore();
    await store.putProject(project("alpha"));
    await store.putSnapshot(withLane("wv1", true));

    const atBoundary = await model(
      store,
      RECEIVED_AT_MS + BOUNDARY_MS,
    ).listWaves("alpha");
    const pastBoundary = await model(
      store,
      RECEIVED_AT_MS + BOUNDARY_MS + 1,
    ).listWaves("alpha");
    const forgotten = await model(
      store,
      RECEIVED_AT_MS + 15 * DAY_MS,
    ).listWaves("alpha");

    expect(atBoundary?.[0]?.stale).toBe(false);
    expect(pastBoundary?.[0]?.stale).toBe(true);
    expect(atBoundary?.[0]?.retained).toBe(true);
    expect(forgotten?.[0]?.retained).toBe(false);
  });

  it("returns nothing for an unknown project", async () => {
    const store = new MemoryStore();

    await expect(model(store).listWaves("absent")).resolves.toBeUndefined();
    await expect(
      model(store).getWave("absent", "wv1"),
    ).resolves.toBeUndefined();
  });

  it("returns the envelope of a fresh wave with the lane untouched", async () => {
    const store = new MemoryStore();
    await store.putProject(project("alpha"));
    await store.putSnapshot(withLane("wv1", true));

    const view = await model(store, RECEIVED_AT_MS + BOUNDARY_MS).getWave(
      "alpha",
      "wv1",
    );

    expect(view).toEqual({
      envelope: withLane("wv1", true).envelope,
      receivedAt: "2026-10-01T12:00:01Z",
      stale: false,
      staleAfterMs: BOUNDARY_MS,
    });
  });

  it("shows an alive lane of a stale wave as unknown and keeps the store intact", async () => {
    const store = new MemoryStore();
    await store.putProject(project("alpha"));
    await store.putSnapshot(withLane("wv1", true));
    await store.putSnapshot(withLane("wv2", false));

    const view = await model(store, RECEIVED_AT_MS + BOUNDARY_MS + 1).getWave(
      "alpha",
      "wv1",
    );
    const settled = await model(
      store,
      RECEIVED_AT_MS + BOUNDARY_MS + 1,
    ).getWave("alpha", "wv2");

    expect(view?.stale).toBe(true);
    expect(view?.envelope.lanes[0]?.derived.alive).toBe("unknown");
    expect(settled?.stale).toBe(true);
    expect(settled?.envelope.lanes[0]?.derived.alive).toBe(false);
    await expect(store.getSnapshot("alpha", "wv1")).resolves.toEqual(
      withLane("wv1", true),
    );
  });

  it("keeps every other field of a lane in the view", async () => {
    const store = new MemoryStore();
    const lane: Lane = {
      id: "wv1-a",
      seat: "left",
      reported: {
        stage: "review",
        event: "settled",
        ts: "2026-10-01T12:00:00Z",
        pr: 7,
        round: 2,
        detail: { note: "done" },
      },
      derived: {
        alive: true,
        exit: 0,
        gate: {
          exit: 0,
          coverage: {
            statements: 100,
            branches: 100,
            functions: 100,
            lines: 100,
          },
        },
        pr: { number: 7, state: "open", checks: "pass", unresolvedThreads: 0 },
        diff: { files: 2, insertions: 10, deletions: 1 },
        log: { bytes: 12, mtimeMs: 1, tail: "done" },
        planReview: "looks good",
        risk: "low",
      },
      disagreements: ["scope"],
    };
    await store.putProject(project("alpha"));
    await store.putSnapshot({
      envelope: { ...snapshot("wv1").envelope, lanes: [lane] },
      receivedAt: "2026-10-01T12:00:01Z",
    });

    const view = await model(store, RECEIVED_AT_MS + BOUNDARY_MS + 1).getWave(
      "alpha",
      "wv1",
    );

    expect(view?.envelope.lanes[0]).toEqual({
      ...lane,
      derived: { ...lane.derived, alive: "unknown" },
    });
  });
});

describe("the project lanes view", () => {
  it("returns nothing for a project the store does not have", async () => {
    const store = new MemoryStore();
    await store.putProject(project("alpha"));
    await store.putSnapshot(withLane("wv1", true));

    await expect(
      model(store).listLanes("absent", false),
    ).resolves.toBeUndefined();
    await expect(
      model(store).listLanes("absent", true),
    ).resolves.toBeUndefined();
  });

  it("names the project, and its repository only when it registered one", async () => {
    const store = new MemoryStore();
    await store.putProject(project("alpha", "Alpha"));
    await store.putProject({
      id: "beta",
      name: "Beta",
      tokenSha256: "c".repeat(64),
      registeredAt: "2026-10-01T12:00:00Z",
    });

    const withRepo = await model(store).listLanes("alpha", false);
    const without = await model(store).listLanes("beta", false);

    expect(withRepo?.project).toStrictEqual({
      id: "alpha",
      name: "Alpha",
      repo: "https://example.com/alpha.git",
    });
    expect(without?.project).toStrictEqual({ id: "beta", name: "Beta" });
    expect(Object.hasOwn(without?.project ?? {}, "repo")).toBe(false);
    expect(JSON.stringify(without?.project)).not.toContain("tokenSha256");
  });

  it("answers the waves the wave route answers, in the same order", async () => {
    const store = new MemoryStore();
    await store.putProject(project("alpha"));
    await store.putSnapshot(withLane("wv1", true));
    await store.putSnapshot({
      ...withLane("wv2", false),
      receivedAt: "2026-10-01T12:00:02Z",
    });

    const view = await model(store).listLanes("alpha", true);

    expect(view?.waves).toStrictEqual(await model(store).listWaves("alpha"));
  });

  it("carries every optional field of a lane that has one", async () => {
    const store = new MemoryStore();
    const lane: Lane = {
      id: "wv1-a",
      seat: "left",
      reported: {
        stage: "review",
        event: "failed",
        ts: "2026-10-01T12:00:00Z",
        pr: 7,
        round: 2,
        detail: { note: "done" },
      },
      derived: {
        alive: false,
        exit: 1,
        gate: {
          exit: 3,
          coverage: {
            statements: 99.99,
            branches: 99.99,
            functions: 99.99,
            lines: 99.99,
          },
        },
        pr: {
          number: 7,
          state: "open",
          checks: "fail",
          unresolvedThreads: "unknown",
        },
        diff: { files: 2, insertions: 10, deletions: 1 },
        log: { bytes: 12, mtimeMs: 1_759_320_000_000, tail: "done" },
        planReview: "looks good",
        risk: "low",
      },
      disagreements: ["scope", "tests", "timing"],
    };
    await store.putProject(project("alpha"));
    await store.putSnapshot({
      envelope: { ...snapshot("wv1").envelope, lanes: [lane] },
      receivedAt: RECEIVED_AT,
    });

    const view = await model(store).listLanes("alpha", true);

    expect(view?.lanes).toStrictEqual([
      {
        wave: "wv1",
        id: "wv1-a",
        seat: "left",
        reported: {
          stage: "review",
          event: "failed",
          ts: "2026-10-01T12:00:00Z",
          pr: 7,
          round: 2,
        },
        derived: {
          alive: false,
          exit: 1,
          gate: lane.derived.gate,
          pr: lane.derived.pr,
          diff: lane.derived.diff,
          log: { bytes: 12, mtimeMs: 1_759_320_000_000, tail: true },
          planReview: "looks good",
          risk: "low",
        },
        disagreements: 3,
        disagreement: "scope",
        reasons: ["failed", "disagreement", "checks", "gate", "exit"],
      },
    ]);
  });

  it("carries no optional key of a lane that has none", async () => {
    const store = new MemoryStore();
    await store.putProject(project("alpha"));
    await store.putSnapshot(
      pushed("alpha", "wv1", RECEIVED_AT, [
        { id: "wv1-a", derived: { alive: true }, disagreements: [] },
      ]),
    );

    const view = await model(store).listLanes("alpha", true);
    const row = view?.lanes[0];

    expect(row).toStrictEqual({
      wave: "wv1",
      id: "wv1-a",
      derived: { alive: true },
      disagreements: 0,
      reasons: [],
    });
    for (const key of ["seat", "reported", "disagreement"]) {
      expect(Object.hasOwn(row ?? {}, key)).toBe(false);
    }
  });

  it("says whether a tail was pushed, and sends neither the tail nor a detail", async () => {
    const store = new MemoryStore();
    await store.putProject(project("alpha"));
    await store.putSnapshot(
      pushed("alpha", "wv1", RECEIVED_AT, [
        laneOf("wv1-a", {
          reported: {
            stage: "implement",
            event: "settled",
            ts: "2026-10-01T12:00:00Z",
            detail: { note: DETAIL_TEXT },
          },
          derived: {
            alive: false,
            exit: 1,
            log: { bytes: 4_096, mtimeMs: 2, tail: TAIL_TEXT },
          },
        }),
        laneOf("wv1-b", {
          derived: {
            alive: false,
            exit: 1,
            log: { bytes: 0, mtimeMs: 3 },
          },
        }),
      ]),
    );

    const view = await model(store).listLanes("alpha", true);
    const body = JSON.stringify(view);

    expect(view?.lanes[0]?.derived.log).toStrictEqual({
      bytes: 4_096,
      mtimeMs: 2,
      tail: true,
    });
    expect(view?.lanes[1]?.derived.log).toStrictEqual({
      bytes: 0,
      mtimeMs: 3,
      tail: false,
    });
    expect(Object.hasOwn(view?.lanes[0]?.reported ?? {}, "detail")).toBe(false);
    expect(body).not.toContain("detail");
    expect(body).not.toContain(TAIL_TEXT);
  });

  it("counts the disagreements of a lane and carries the first of them", async () => {
    const store = new MemoryStore();
    await store.putProject(project("alpha"));
    await store.putSnapshot(
      pushed("alpha", "wv1", RECEIVED_AT, [
        laneOf("wv1-a", { disagreements: ["scope", "the second one"] }),
      ]),
    );

    const view = await model(store).listLanes("alpha", true);
    const row = view?.lanes[0];

    expect(row?.disagreements).toBe(2);
    expect(row?.disagreement).toBe("scope");
    expect(JSON.stringify(view)).not.toContain("the second one");
  });

  it("leaves the waves the store is past retaining out unless asked for all", async () => {
    const store = new MemoryStore();
    await store.putProject(project("alpha"));
    await store.putSnapshot(
      pushed("alpha", "wv1", RECEIVED_AT, [laneOf("wv1-a")]),
    );
    await store.putSnapshot(
      pushed("alpha", "wv2", agoFrom(NOW_MS, 15 * DAY_MS), [laneOf("wv2-a")]),
    );

    const retained = await model(store).listLanes("alpha", false);
    const all = await model(store).listLanes("alpha", true);

    expect(retained?.waves.map((wave) => [wave.wave, wave.retained])).toEqual([
      ["wv1", true],
      ["wv2", false],
    ]);
    expect(retained?.lanes.map((row) => row.id)).toEqual(["wv1-a"]);
    expect(all?.lanes.map((row) => row.id)).toEqual(["wv1-a", "wv2-a"]);
  });

  it("resolves liveness and the reasons of a lane per request, not per wave", async () => {
    const store = new WaryStore("wv-absent");
    await store.putProject(project("alpha"));
    await store.putSnapshot(
      pushed("alpha", "wv1", RECEIVED_AT, [
        laneOf("wv1-a", { derived: { alive: true } }),
      ]),
    );
    let clock = NOW_MS;
    const read = createReadModel({ store, now: () => clock });

    const fresh = await read.listLanes("alpha", false);
    clock = RECEIVED_AT_MS + BOUNDARY_MS + 1;
    const stale = await read.listLanes("alpha", false);

    expect(fresh?.lanes[0]?.derived.alive).toBe(true);
    expect(fresh?.lanes[0]?.reasons).toEqual([]);
    expect(stale?.lanes[0]?.derived.alive).toBe("unknown");
    expect(stale?.lanes[0]?.reasons).toEqual(["silent"]);
    // The one read of the wave answered both requests: what changed between them
    // is the clock, not the wave.
    expect(store.asked).toEqual(["wv1"]);

    const elsewhere = await model(store, NOW_MS).listLanes("alpha", false);

    expect(elsewhere?.lanes[0]?.derived.alive).toBe(true);
    expect(elsewhere?.lanes[0]?.reasons).toEqual([]);
    // A read model of its own has a cache of its own, so it reads the wave again.
    expect(store.asked).toEqual(["wv1", "wv1"]);
    expect(store.wholeLists).toBe(0);
  });

  it("reads a wave once while its head still describes it", async () => {
    const store = new WaryStore("wv-absent");
    await store.putProject(project("alpha"));
    await store.putSnapshot(
      pushed("alpha", "wv1", RECEIVED_AT, [laneOf("wv1-a")]),
    );
    const read = model(store);

    const first = await read.listLanes("alpha", true);
    const second = await read.listLanes("alpha", true);

    expect(second).toStrictEqual(first);
    expect(store.asked).toEqual(["wv1"]);
    expect(store.wholeLists).toBe(0);
  });

  it("reads a wave again once its head describes a different one", async () => {
    const store = new WaryStore("wv-absent");
    await store.putProject(project("alpha"));
    await store.putSnapshot(
      pushed("alpha", "wv1", RECEIVED_AT, [laneOf("wv1-a")]),
    );
    const read = model(store);

    const first = await read.listLanes("alpha", true);
    // The same wave pushed again within the same millisecond: the received time
    // alone cannot tell the two apart, and the lane count in the head can.
    await store.putSnapshot(
      pushed("alpha", "wv1", RECEIVED_AT, [laneOf("wv1-a"), laneOf("wv1-b")]),
    );
    const second = await read.listLanes("alpha", true);

    expect(first?.lanes.map((row) => row.id)).toEqual(["wv1-a"]);
    expect(second?.lanes.map((row) => row.id)).toEqual(["wv1-a", "wv1-b"]);
    expect(store.asked).toEqual(["wv1", "wv1"]);
  });

  it("answers the lanes of a wave a later push has replaced", async () => {
    const store = new WaryStore("wv-absent");
    await store.putProject(project("alpha"));
    await store.putSnapshot(
      pushed("alpha", "wv1", RECEIVED_AT, [laneOf("wv1-a")]),
    );
    const read = model(store);

    const first = await read.listLanes("alpha", true);
    // The same wave of the same size, received later: only the received time in
    // the head tells this push from the one the cache holds.
    await store.putSnapshot(
      pushed("alpha", "wv1", "2026-10-01T12:00:04Z", [laneOf("wv1-c")]),
    );
    const second = await read.listLanes("alpha", true);

    expect(first?.lanes.map((row) => row.id)).toEqual(["wv1-a"]);
    expect(second?.lanes.map((row) => row.id)).toEqual(["wv1-c"]);
    expect(store.asked).toEqual(["wv1", "wv1"]);
  });

  it("carries no rows for a wave whose snapshot has gone, and asks again", async () => {
    const store = new WaryStore("wv2");
    await store.putProject(project("alpha"));
    await store.putSnapshot(
      pushed("alpha", "wv1", RECEIVED_AT, [laneOf("wv1-a")]),
    );
    await store.putSnapshot(
      pushed("alpha", "wv2", receivedAtOf(2), [laneOf("wv2-a")]),
    );
    const read = model(store);

    const first = await read.listLanes("alpha", true);
    const second = await read.listLanes("alpha", true);

    expect(first?.lanes.map((row) => row.id)).toEqual(["wv1-a"]);
    expect(second?.lanes.map((row) => row.id)).toEqual(["wv1-a"]);
    // The wave that went away is not cached, so it is asked for again, while the
    // one that stayed is not.
    expect(store.asked).toEqual(["wv2", "wv1", "wv2"]);
    expect(store.wholeLists).toBe(0);
  });

  it("reads a polled wave once however many polls a project takes", async () => {
    const store = new WaryStore("wv-absent");
    // More waves than the map used to hold. A poll of all of them evicted each
    // wave just before the same poll asked for it, so every poll parsed every
    // wave again.
    const waves = 65;
    await filled(store, "alpha", waves, (wave) => [laneOf(`${wave}-a`)]);
    const read = model(store);

    for (const poll of [1, 2, 3]) {
      const view = await read.listLanes("alpha", true);
      expect(view?.lanes).toHaveLength(waves);
      expect(store.asked.length).toBeLessThanOrEqual(waves * poll);
    }
    expect(store.asked).toHaveLength(waves);
  });

  it("reads each in-window wave of a fleet once across two polls", async () => {
    const store = new WaryStore("wv-absent");
    for (const at of [...Array(7).keys()]) {
      await filled(store, `p${String(at + 1).padStart(3, "0")}`, 10, (wave) => [
        laneOf(`${wave}-a`),
      ]);
    }
    const read = model(store);

    await read.listAttention();
    await read.listAttention();

    expect(store.asked).toHaveLength(70);
  });

  it("keeps no more than the wave bound, dropping the least recently used wave", async () => {
    const store = new WaryStore("wv-absent");
    // Three projects of 171 waves each, which is more than the map holds and
    // under the 200 waves one read may read. Every wave of a project holds one
    // lane, and every wave id carries its project's own so the asks are
    // unambiguous.
    const each = 171;
    for (const at of [1, 2, 3]) {
      const of = `p${at}`;
      await store.putProject(project(of));
      for (let index = 1; index <= each; index += 1) {
        const wave = `${of}-wv${String(index).padStart(3, "0")}`;
        await store.putSnapshot(
          pushed(
            of,
            wave,
            // One second older per wave, so each project is read from its
            // newest wave to its oldest and its newest wave is the first its
            // reads used.
            new Date(RECEIVED_AT_MS - index * 1_000).toISOString(),
            [laneOf(`${wave}-a`)],
          ),
        );
      }
    }
    const read = model(store);

    for (const at of [1, 2, 3]) {
      await read.listLanes(`p${at}`, true);
    }
    expect(store.asked).toHaveLength(MAX_CACHED_WAVES + 1);
    expect(store.asked[0]).toBe("p1-wv001");
    expect(store.asked[MAX_CACHED_WAVES]).toBe("p3-wv171");

    // The map never grew past its bound: p3's waves were the last ones used and
    // are all still held, so reading that project again parses nothing.
    await read.listLanes("p3", true);
    expect(store.asked).toHaveLength(MAX_CACHED_WAVES + 1);

    // And p1 is asked first for the wave the bound dropped: the one used longest
    // ago, which is its newest wave — the first of its reads. Its other waves are
    // still held, but they are the entries used longest ago (p2's and p3's are
    // newer), so its reads roll the entry it has just used off the end.
    await read.listLanes("p1", true);
    expect(store.asked[MAX_CACHED_WAVES + 1]).toBe("p1-wv001");
  });

  it("keeps no more than the row bound, dropping the least recently used wave", async () => {
    const store = new WaryStore("wv-absent");
    // One wave per project, every wave at the contract's own cap of 200 lanes,
    // so it is the rows that fill the map past a bound and never the waves.
    const held = Math.floor(MAX_CACHED_ROWS / LANES_PER_WAVE);
    const id = (at: number): string => `p${String(at).padStart(3, "0")}`;
    const full = (wave: string): Lane[] =>
      Array.from({ length: LANES_PER_WAVE }, (_unused, lane) =>
        laneOf(`${wave}-${lane}`),
      );
    for (const at of [...Array(held).keys()]) {
      await store.putProject(project(id(at + 1)));
      await store.putSnapshot(
        pushed(id(at + 1), "wv001", RECEIVED_AT, full("wv001")),
      );
    }
    const read = model(store);
    for (const at of [...Array(held).keys()]) {
      await read.listLanes(id(at + 1), true);
    }
    expect(store.asked).toHaveLength(held);

    // Reading a wave again is a use: p001's wave is the most recently used of
    // all, and a map at its row bound still answers it.
    await read.listLanes("p001", true);
    expect(store.asked).toHaveLength(held);

    // Ten more projects take the map past the row bound again, and what goes
    // each time is the wave used longest ago: never the wave just read.
    for (const at of [...Array(10).keys()]) {
      const next = id(held + at + 1);
      await store.putProject(project(next));
      await store.putSnapshot(
        pushed(next, "wv001", RECEIVED_AT, full("wv001")),
      );
      await read.listLanes(next, true);
    }
    expect(store.asked).toHaveLength(held + 10);

    // So the touched wave is still held, and the one beside it is read again.
    await read.listLanes("p001", true);
    expect(store.asked).toHaveLength(held + 10);
    await read.listLanes("p002", true);
    expect(store.asked).toHaveLength(held + 11);
  });

  it("stops at the lane cap and reads no wave past it", async () => {
    const store = new WaryStore("wv-absent");
    const waves = Math.ceil(MAX_PROJECT_LANES / LANES_PER_WAVE) + 1;
    await filled(store, "alpha", waves, (wave) =>
      Array.from({ length: LANES_PER_WAVE }, (_unused, at) =>
        laneOf(`${wave}-${at}`),
      ),
    );

    const view = await model(store).listLanes("alpha", true);

    expect(view?.lanes).toHaveLength(MAX_PROJECT_LANES);
    expect(view?.truncated).toBe(true);
    // Wave order first, then the order of the lanes inside each wave.
    expect(view?.lanes[0]?.wave).toBe("wv011");
    expect(view?.lanes[0]?.id).toBe("wv011-0");
    expect(view?.lanes[LANES_PER_WAVE - 1]?.id).toBe("wv011-199");
    expect(view?.lanes[MAX_PROJECT_LANES - 1]?.wave).toBe("wv002");
    expect(view?.lanes[MAX_PROJECT_LANES - 1]?.id).toBe("wv002-199");
    // The wave whose rows the cap had no room for is never read: its head says
    // how many lanes it holds, and that is all the answer needs.
    expect(store.asked).toEqual([
      "wv011",
      "wv010",
      "wv009",
      "wv008",
      "wv007",
      "wv006",
      "wv005",
      "wv004",
      "wv003",
      "wv002",
    ]);
  });

  it("truncates nothing when exactly the cap matches", async () => {
    const store = new WaryStore("wv-absent");
    await filled(store, "alpha", 11, (wave, index) =>
      // The oldest wave holds no lanes at all, so the wave the cap is spent at
      // is followed by one with nothing left to leave out.
      index === 1
        ? []
        : Array.from({ length: LANES_PER_WAVE }, (_unused, at) =>
            laneOf(`${wave}-${at}`),
          ),
    );

    const view = await model(store).listLanes("alpha", true);

    expect(view?.lanes).toHaveLength(MAX_PROJECT_LANES);
    expect(view?.lanes.at(-1)?.wave).toBe("wv002");
    expect(view?.truncated).toBe(false);
    expect(store.asked).toHaveLength(MAX_PROJECT_LANES / LANES_PER_WAVE);
  });

  it("stops in the middle of the wave that reaches the cap", async () => {
    const store = new WaryStore("wv-absent");
    // Read newest first, so nine waves of 200 lanes and then one of 199 leave the
    // cap a single row short and the wave after them is cut in the middle rather
    // than at its first lane.
    await filled(store, "alpha", 12, (wave, index) =>
      Array.from(
        { length: index === 3 ? LANES_PER_WAVE - 1 : LANES_PER_WAVE },
        (_unused, at) => laneOf(`${wave}-${at}`),
      ),
    );

    const view = await model(store).listLanes("alpha", true);

    expect(view?.lanes).toHaveLength(MAX_PROJECT_LANES);
    expect(view?.lanes.at(-1)?.wave).toBe("wv002");
    expect(view?.lanes.at(-1)?.id).toBe("wv002-0");
    expect(view?.truncated).toBe(true);
    // The wave the cap was spent in was read, because it contributed a row; the
    // one after it was not.
    expect(store.asked).toHaveLength(11);
    expect(store.asked[10]).toBe("wv002");
  });

  it("reads no wave whose head says it holds no lanes", async () => {
    const store = new WaryStore("wv-absent");
    // Every wave a project ever pushed, and only the newest one holds a lane.
    await filled(store, "alpha", 301, (_wave, index) =>
      index === 301 ? [laneOf("wv301-a")] : [],
    );

    const view = await model(store).listLanes("alpha", true);

    expect(view?.lanes.map((row) => row.id)).toEqual(["wv301-a"]);
    expect(view?.waves).toHaveLength(301);
    expect(view?.truncated).toBe(false);
    expect(store.asked).toEqual(["wv301"]);
  });

  it("stops at the wave bound and reads no wave past it", async () => {
    const store = new WaryStore("wv-absent");
    const waves = MAX_WAVES_PER_READ + 50;
    await filled(store, "alpha", waves, (wave) => [laneOf(`${wave}-a`)]);

    const view = await model(store).listLanes("alpha", true);

    expect(view?.lanes).toHaveLength(MAX_WAVES_PER_READ);
    expect(view?.truncated).toBe(true);
    expect(store.asked).toHaveLength(MAX_WAVES_PER_READ);
    // The newest waves, in the order the answer lists them.
    expect(store.asked).toEqual(
      (view?.waves ?? []).map((wave) => wave.wave).slice(0, MAX_WAVES_PER_READ),
    );
  });

  it("truncates nothing when exactly the wave bound matches", async () => {
    const store = new WaryStore("wv-absent");
    await filled(store, "alpha", MAX_WAVES_PER_READ, (wave) => [
      laneOf(`${wave}-a`),
    ]);

    const view = await model(store).listLanes("alpha", true);

    expect(view?.lanes).toHaveLength(MAX_WAVES_PER_READ);
    expect(view?.truncated).toBe(false);
    expect(store.asked).toHaveLength(MAX_WAVES_PER_READ);
  });

  it("lists the newest of at most MAX_LISTED_WAVES heads and counts the rest", async () => {
    const store = new WaryStore("wv-absent");
    // Only the five oldest waves hold a lane, so the rows a listing answers are
    // the lanes of waves its own wave strip had no room for.
    await filled(store, "alpha", MAX_LISTED_WAVES + 5, (_wave, index) =>
      index > 5 ? [] : [laneOf(`${waveIdOf(index)}-a`)],
    );

    const view = await model(store).listLanes("alpha", true);

    expect(view?.waves).toHaveLength(MAX_LISTED_WAVES);
    expect(view?.waves[0]?.wave).toBe(`wv${MAX_LISTED_WAVES + 5}`);
    expect(view?.waves[MAX_LISTED_WAVES - 1]?.wave).toBe("wv006");
    expect(view?.waves.every((wave) => wave.retained)).toBe(true);
    expect(view?.wavesOmitted).toBe(5);

    // The rows are not cut with the strip: the bound is on the wave list alone,
    // and a wave too old to be listed still has its lanes in the table.
    expect(view?.lanes.map((row) => [row.wave, row.id])).toEqual([
      ["wv005", "wv005-a"],
      ["wv004", "wv004-a"],
      ["wv003", "wv003-a"],
      ["wv002", "wv002-a"],
      ["wv001", "wv001-a"],
    ]);
    expect(view?.truncated).toBe(false);
    expect(store.asked).toEqual(["wv005", "wv004", "wv003", "wv002", "wv001"]);
  });

  it("omits no head while the project holds fewer than the bound", async () => {
    const store = new WaryStore("wv-absent");
    await filled(store, "alpha", 12, (wave) => [laneOf(`${wave}-a`)]);

    const view = await model(store).listLanes("alpha", true);

    expect(view?.waves).toHaveLength(12);
    expect(view?.wavesOmitted).toBe(0);
    expect(view?.waves).toStrictEqual(await model(store).listWaves("alpha"));
  });

  it("answers the whole cap of small lanes without cutting it", async () => {
    const store = new MemoryStore();
    await filled(
      store,
      "alpha",
      MAX_PROJECT_LANES / LANES_PER_WAVE,
      (_wave, index) =>
        Array.from({ length: LANES_PER_WAVE }, (_unused, at) =>
          plainLane(index * 10_000 + at),
        ),
      longWaveIdOf,
    );

    const view = await model(store, RECEIVED_AT_MS + 40_001).listLanes(
      "alpha",
      true,
    );
    const body = JSON.stringify(view);

    expect(view?.lanes).toHaveLength(MAX_PROJECT_LANES);
    expect(view?.truncated).toBe(false);
    expect(Buffer.byteLength(body)).toBeLessThan(MAX_PROJECT_LANES_BYTES);
  });

  it.each([
    // A quote is one character and two bytes once JSON has escaped it.
    ["a quote", '"'],
    // One CJK ideograph is one character and three UTF-8 bytes.
    ["CJK text", "\u4e2d"],
    // A lone surrogate is one character, and `JSON.stringify` writes it as six
    // ASCII bytes of `\udXXX`. The contract refuses control characters, and a
    // surrogate is not one.
    ["a lone surrogate", "\ud83d"],
  ])(
    "bounds a project of 2 000 largest lanes filled with %s",
    async (_what, fill) => {
      const store = new MemoryStore();
      await filled(
        store,
        "alpha",
        MAX_PROJECT_LANES / LANES_PER_WAVE,
        (_wave, index) =>
          Array.from({ length: LANES_PER_WAVE }, (_unused, at) =>
            biggestLane(index * 10_000 + at, fill),
          ),
        longWaveIdOf,
      );

      const view = await model(store, RECEIVED_AT_MS + 40_001).listLanes(
        "alpha",
        true,
      );
      const body = JSON.stringify(view);

      expect(view?.lanes.length).toBeGreaterThan(0);
      expect(view?.lanes.length).toBeLessThan(MAX_PROJECT_LANES);
      expect(view?.truncated).toBe(true);
      // The rows themselves are bounded, and what the answer wraps them in is the
      // project's own name and the wave strip.
      expect(Buffer.byteLength(body)).toBeLessThan(
        MAX_PROJECT_LANES_BYTES + 256 * 1024,
      );
      expect(body).not.toContain(TAIL_TEXT);
      expect(body).not.toContain(DETAIL_TEXT);
    },
  );

  it("reads no wave past the one the byte bound stopped in", async () => {
    const store = new WaryStore("wv-absent");
    await filled(store, "alpha", 10, () =>
      Array.from({ length: LANES_PER_WAVE }, (_unused, at) =>
        biggestLane(10_000 + at, '"'),
      ),
    );

    const view = await model(store, RECEIVED_AT_MS + 40_001).listLanes(
      "alpha",
      true,
    );

    expect(view?.truncated).toBe(true);
    expect(view?.lanes.length).toBeLessThan(MAX_PROJECT_LANES);
    expect(store.asked.length).toBeGreaterThan(0);
    expect(store.asked.length).toBeLessThan(10);
    // The waves asked for are the newest ones, in the order the view lists them,
    // and the read stopped there.
    expect(store.asked).toEqual(
      (view?.waves ?? []).map((wave) => wave.wave).slice(0, store.asked.length),
    );
  });
});

describe("utf8Length", () => {
  it.each([
    ["", 0],
    ["waves/v1", 8],
    ["é", 2],
    ["\u4e2d", 3],
    ["\u{1f680}", 4],
    // A lone high surrogate is three bytes, and so is a lone low one.
    ["\ud83d", 3],
    ["\udc00", 3],
    // A high surrogate that is not followed by a low one is not a pair.
    ["\ud83dA", 4],
    ["\ud83d\ue000", 6],
    ['a\u{1f680}\u4e2d"', 9],
  ])("counts %j as %i bytes", (text, expected) => {
    expect(utf8Length(text)).toBe(expected);
  });
});

describe("the attention view", () => {
  it("lists what every project is asking for, and what none is", async () => {
    const store = new MemoryStore();
    await store.putProject(project("alpha", "Alpha"));
    await store.putProject(project("beta", "Beta"));
    await store.putSnapshot(
      pushed("alpha", "wv1", RECEIVED_AT, [laneOf("wv1-a")]),
    );
    await store.putSnapshot(
      pushed("beta", "wv1", RECEIVED_AT, [
        laneOf("wv1-b", { seat: "left" }),
        laneOf("wv1-c"),
      ]),
    );

    const view = await model(store).listAttention();

    expect(view).toEqual({
      lanes: [
        {
          project: "alpha",
          wave: "wv1",
          lane: "wv1-a",
          reasons: ["exit"],
          receivedAt: RECEIVED_AT,
          stale: false,
        },
        {
          project: "beta",
          wave: "wv1",
          lane: "wv1-b",
          seat: "left",
          reasons: ["exit"],
          receivedAt: RECEIVED_AT,
          stale: false,
        },
        {
          project: "beta",
          wave: "wv1",
          lane: "wv1-c",
          reasons: ["exit"],
          receivedAt: RECEIVED_AT,
          stale: false,
        },
      ],
      projects: [
        { id: "alpha", attention: 1 },
        { id: "beta", attention: 2 },
      ],
      truncated: false,
      wavesOmitted: 0,
    });
  });

  it("keeps only the waves received inside the attention window", async () => {
    const nowMs = PUSHED_AT_MS + 5 * DAY_MS;
    const store = new MemoryStore();
    await store.putProject(project("alpha"));
    await store.putSnapshot(
      pushed("alpha", "wv1", agoFrom(nowMs, 73 * HOUR_MS), [laneOf("wv1-a")]),
    );
    await store.putSnapshot(
      pushed("alpha", "wv2", agoFrom(nowMs, 71 * HOUR_MS), [laneOf("wv2-a")]),
    );

    const view = await model(store, nowMs).listAttention();

    expect(view.lanes.map((entry) => entry.wave)).toEqual(["wv2"]);
    expect(view.projects).toEqual([{ id: "alpha", attention: 1 }]);
  });

  it("calls an alive lane of a stale wave silent, and says the wave is stale", async () => {
    const store = new MemoryStore();
    await store.putProject(project("alpha"));
    await store.putSnapshot(
      pushed("alpha", "wv1", RECEIVED_AT, [
        laneOf("wv1-a", { derived: { alive: true } }),
      ]),
    );

    const fresh = await model(store).listAttention();
    const stale = await model(
      store,
      RECEIVED_AT_MS + BOUNDARY_MS + 1,
    ).listAttention();

    expect(fresh.lanes).toEqual([]);
    expect(fresh.projects).toEqual([{ id: "alpha", attention: 0 }]);
    expect(stale.lanes[0]?.reasons).toEqual(["silent"]);
    expect(stale.lanes[0]?.stale).toBe(true);
  });

  it("judges a wave by the interval of the snapshot it read", async () => {
    const store = new ReplacedStore("wv-absent");
    await store.putProject(project("alpha"));
    await store.putSnapshot(
      pushed("alpha", "wv1", RECEIVED_AT, [
        // A lane that wants a reader whether or not the wave is stale, and one
        // that only wants one when the wave is: the difference is the interval.
        laneOf("wv1-a"),
        laneOf("wv1-b", { derived: { alive: true } }),
      ]),
    );

    // A hundred seconds after the head says it received the wave, which its own
    // ten-second interval makes long overdue. The snapshot that comes back was
    // received two seconds later and says five minutes, which it is not.
    const view = await model(store, RECEIVED_AT_MS + 100_000).listAttention();

    expect(view.lanes.map((entry) => entry.lane)).toEqual(["wv1-a"]);
    expect(view.lanes[0]?.stale).toBe(false);
    expect(view.lanes[0]?.receivedAt).toBe("2026-10-01T12:00:03.000Z");
    expect(view.lanes[0]?.reasons).toEqual(["exit"]);
    expect(view.projects).toEqual([{ id: "alpha", attention: 1 }]);
  });

  it("leaves a lane with no reason of its own out of the list", async () => {
    const store = new MemoryStore();
    await store.putProject(project("alpha"));
    await store.putSnapshot(
      pushed("alpha", "wv1", RECEIVED_AT, [
        laneOf("wv1-a", { derived: { alive: true } }),
        laneOf("wv1-b"),
      ]),
    );

    const view = await model(store).listAttention();

    expect(view.lanes.map((entry) => entry.lane)).toEqual(["wv1-b"]);
    expect(view.projects).toEqual([{ id: "alpha", attention: 1 }]);
  });

  it("reads no wave of its own beyond the ones the window keeps", async () => {
    const store = new WaryStore("wv1");
    await store.putProject(project("alpha"));
    await store.putSnapshot(
      pushed("alpha", "wv1", RECEIVED_AT, [laneOf("wv1-a")]),
    );
    await store.putSnapshot(
      pushed("alpha", "wv2", agoFrom(NOW_MS, 15 * DAY_MS), [laneOf("wv2-a")]),
    );

    await model(store).listAttention();

    expect(store.asked).toEqual(["wv1"]);
    expect(store.wholeLists).toBe(0);
  });

  it("skips a wave whose snapshot has gone since the head was read", async () => {
    const store = new WaryStore("wv1");
    await store.putProject(project("alpha"));
    await store.putSnapshot(
      pushed("alpha", "wv1", RECEIVED_AT, [laneOf("wv1-a")]),
    );
    await store.putSnapshot(
      pushed("alpha", "wv2", RECEIVED_AT, [laneOf("wv2-a")]),
    );

    const view = await model(store).listAttention();

    expect(view.lanes.map((entry) => entry.lane)).toEqual(["wv2-a"]);
    expect(view.projects).toEqual([{ id: "alpha", attention: 1 }]);
    expect(store.asked).toEqual(["wv1", "wv2"]);
    expect(store.wholeLists).toBe(0);
  });

  it("carries no seat and no pull request for a lane that has neither", async () => {
    const store = new MemoryStore();
    await store.putProject(project("alpha"));
    await store.putSnapshot(
      pushed("alpha", "wv1", RECEIVED_AT, [laneOf("wv1-a")]),
    );

    const view = await model(store).listAttention();
    const entry = view.lanes[0];

    expect(entry).toEqual({
      project: "alpha",
      wave: "wv1",
      lane: "wv1-a",
      reasons: ["exit"],
      receivedAt: RECEIVED_AT,
      stale: false,
    });
    expect(Object.hasOwn(entry ?? {}, "seat")).toBe(false);
    expect(Object.hasOwn(entry ?? {}, "pr")).toBe(false);
  });

  it("carries the seat and the pull request number a lane does have", async () => {
    const store = new MemoryStore();
    await store.putProject(project("alpha"));
    await store.putSnapshot(
      pushed("alpha", "wv1", RECEIVED_AT, [
        laneOf("wv1-a", {
          seat: "left",
          derived: {
            alive: false,
            exit: 1,
            pr: { number: 7, state: "open", checks: "fail" },
          },
        }),
      ]),
    );

    const view = await model(store).listAttention();

    expect(view.lanes[0]).toEqual({
      project: "alpha",
      wave: "wv1",
      lane: "wv1-a",
      seat: "left",
      reasons: ["checks", "exit"],
      receivedAt: RECEIVED_AT,
      stale: false,
      pr: 7,
    });
  });

  it("lists the newest receive first", async () => {
    const store = new MemoryStore();
    await store.putProject(project("alpha"));
    await store.putProject(project("beta"));
    await store.putSnapshot(
      pushed("alpha", "wv1", RECEIVED_AT, [laneOf("wv1-a")]),
    );
    await store.putSnapshot(
      pushed("alpha", "wv2", "2026-10-01T12:00:03Z", [laneOf("wv2-a")]),
    );
    await store.putSnapshot(
      pushed("beta", "wv1", "2026-10-01T12:00:02Z", [laneOf("wv1-b")]),
    );

    const view = await model(store).listAttention();

    expect(
      view.lanes.map((entry) => `${entry.project}/${entry.wave}/${entry.lane}`),
    ).toEqual(["alpha/wv2/wv2-a", "beta/wv1/wv1-b", "alpha/wv1/wv1-a"]);
  });

  it("keeps the order it found lanes in when two waves arrived together", async () => {
    const store = new MemoryStore();
    await store.putProject(project("alpha"));
    await store.putProject(project("beta"));
    await store.putSnapshot(
      pushed("alpha", "wv1", RECEIVED_AT, [laneOf("wv1-a"), laneOf("wv1-b")]),
    );
    await store.putSnapshot(
      pushed("beta", "wv1", RECEIVED_AT, [laneOf("wv1-b"), laneOf("wv1-c")]),
    );

    const view = await model(store).listAttention();

    expect(view.lanes.map((entry) => `${entry.project}/${entry.lane}`)).toEqual(
      ["alpha/wv1-a", "alpha/wv1-b", "beta/wv1-b", "beta/wv1-c"],
    );
  });

  it("cuts the list at 200 lanes and still counts what the cut left out", async () => {
    const store = new MemoryStore();
    await store.putProject(project("alpha"));
    await store.putSnapshot(failing("wv1", 201));

    const view = await model(store).listAttention();

    expect(view.lanes).toHaveLength(200);
    expect(view.lanes[0]?.lane).toBe("wv1-0");
    expect(view.lanes[199]?.lane).toBe("wv1-199");
    expect(view.projects).toEqual([{ id: "alpha", attention: 201 }]);
    expect(view.truncated).toBe(true);
  });

  it("truncates nothing when exactly 200 lanes match", async () => {
    const store = new MemoryStore();
    await store.putProject(project("alpha"));
    await store.putSnapshot(failing("wv1", 200));

    const view = await model(store).listAttention();

    expect(view.lanes).toHaveLength(200);
    expect(view.projects).toEqual([{ id: "alpha", attention: 200 }]);
    expect(view.truncated).toBe(false);
  });

  it("counts a project whose lanes the cap left out of the list", async () => {
    const store = new MemoryStore();
    await store.putProject(project("alpha"));
    await store.putProject(project("beta"));
    await store.putSnapshot({
      ...failing("wv1", 200),
      receivedAt: "2026-10-01T12:00:03Z",
    });
    await store.putSnapshot(
      pushed("beta", "wv1", RECEIVED_AT, [laneOf("wv1-a")]),
    );

    const view = await model(store).listAttention();

    expect(view.lanes).toHaveLength(200);
    expect(view.lanes.map((entry) => entry.lane)).not.toContain("wv1-a");
    expect(view.projects).toEqual([
      { id: "alpha", attention: 200 },
      { id: "beta", attention: 1 },
    ]);
    expect(view.truncated).toBe(true);
  });

  it("reads each wave of the window once across two calls", async () => {
    const store = new WaryStore("wv-absent");
    await store.putProject(project("alpha"));
    await store.putSnapshot(
      pushed("alpha", "wv1", RECEIVED_AT, [laneOf("wv1-a")]),
    );
    const read = model(store);

    await read.listAttention();
    const second = await read.listAttention();

    expect(second.lanes.map((entry) => entry.lane)).toEqual(["wv1-a"]);
    expect(store.asked).toEqual(["wv1"]);
    expect(store.wholeLists).toBe(0);
  });

  it("reads the newest MAX_ATTENTION_WAVES waves and counts what it left out", async () => {
    const store = new WaryStore("wv-absent");
    // Receive times are interleaved across the two projects and the wave ids sort
    // in the opposite order to the receive times, so reading the store's own head
    // order would read a different set of waves than reading newest first.
    for (let index = 1; index <= MAX_ATTENTION_WAVES + 2; index += 1) {
      const of = index % 4 < 2 ? "alpha" : "beta";
      await store.putSnapshot(
        pushed(
          of,
          `wv${index}`,
          new Date(RECEIVED_AT_MS - index * 1_000).toISOString(),
          // A lane that wants a reader in every other wave and a settled one in the
          // rest: every wave holds a lane, so each takes a read slot, and the
          // lanes that match stay under the lane cap, so only the wave bound can
          // make this answer truncated.
          index % 2 === 1
            ? [laneOf(`wv${index}-a`)]
            : [laneOf(`wv${index}-a`, { derived: { alive: false, exit: 0 } })],
        ),
      );
    }
    // A third project whose only wave is the oldest of them all. It is still
    // read, because every project's newest wave is read before any project's
    // second, so a quiet project is not starved by two busy ones.
    await store.putProject(project("alpha"));
    await store.putProject(project("beta"));
    await store.putProject(project("gamma"));
    await store.putSnapshot(
      pushed(
        "gamma",
        "gvw1",
        new Date(RECEIVED_AT_MS - 10 * 60_000).toISOString(),
        [laneOf("gvw1-a")],
      ),
    );

    const view = await model(store).listAttention();

    expect(store.asked).toHaveLength(MAX_ATTENTION_WAVES);
    // The newest receive first, not the order the store answered its heads in.
    // Each project's newest wave first (alpha's, beta's, gamma's), then the rest
    // newest first.
    expect(store.asked.slice(0, 4)).toEqual(["wv1", "wv2", "gvw1", "wv3"]);
    expect(store.asked[MAX_ATTENTION_WAVES - 1]).toBe(
      `wv${MAX_ATTENTION_WAVES - 1}`,
    );
    expect(store.asked).not.toContain(`wv${MAX_ATTENTION_WAVES}`);
    expect(store.asked).not.toContain(`wv${MAX_ATTENTION_WAVES + 1}`);
    expect(store.asked).not.toContain(`wv${MAX_ATTENTION_WAVES + 2}`);
    expect(view.wavesOmitted).toBe(3);
    // The lanes that matched fit under the lane cap, so the cut is the waves'.
    expect(view.lanes).toHaveLength(129);
    expect(view.truncated).toBe(true);
    expect(view.projects).toEqual([
      { id: "alpha", attention: 64 },
      { id: "beta", attention: 64 },
      { id: "gamma", attention: 1 },
    ]);
  });

  it("reads a quiet project's newest wave though a busy one fills the bound", async () => {
    const store = new WaryStore("wv-absent");
    await filled(store, "busy", MAX_ATTENTION_WAVES + 10, (wave) => [
      laneOf(`${wave}-a`),
    ]);
    await store.putProject(project("quiet"));
    // Older than every one of the busy project's waves.
    await store.putSnapshot(
      pushed("quiet", "qw1", new Date(RECEIVED_AT_MS - 60_000).toISOString(), [
        laneOf("qw1-a"),
      ]),
    );

    const view = await model(store).listAttention();

    expect(store.asked).toHaveLength(MAX_ATTENTION_WAVES);
    expect(store.asked).toContain("qw1");
    expect(view.projects.find((entry) => entry.id === "quiet")).toEqual({
      id: "quiet",
      attention: 1,
    });
    expect(view.wavesOmitted).toBe(11);
  });

  it("gives no read slot to a wave with no lanes", async () => {
    const store = new WaryStore("wv-absent");
    // Many newer empty waves, then one older wave with a lane: the empty ones
    // cannot match anything, so they neither crowd it out nor count as omitted.
    await filled(store, "alpha", MAX_ATTENTION_WAVES + 20, () => []);
    await store.putSnapshot(
      pushed("alpha", "old", new Date(RECEIVED_AT_MS - 60_000).toISOString(), [
        laneOf("old-a"),
      ]),
    );

    const view = await model(store).listAttention();

    expect(store.asked).toEqual(["old"]);
    expect(view.wavesOmitted).toBe(0);
    expect(view.truncated).toBe(false);
    expect(view.lanes.map((entry) => entry.lane)).toEqual(["old-a"]);
  });

  it("omits no wave while the window holds fewer than the bound", async () => {
    const store = new WaryStore("wv-absent");
    await store.putProject(project("alpha"));
    await store.putSnapshot(
      pushed("alpha", "wv1", RECEIVED_AT, [laneOf("wv1-a")]),
    );
    await store.putSnapshot(
      pushed("alpha", "wv2", receivedAtOf(2), [laneOf("wv2-a")]),
    );

    const view = await model(store).listAttention();

    expect(view.wavesOmitted).toBe(0);
    expect(view.truncated).toBe(false);
    expect(view.lanes.map((entry) => entry.lane)).toEqual(["wv2-a", "wv1-a"]);
    expect(store.asked).toEqual(["wv2", "wv1"]);
  });

  it("reads no wave again on the second of two answers over the wave bound", async () => {
    const store = new WaryStore("wv-absent");
    // More waves in the window than the cache holds, one lane each. Without the
    // bound each request would read all of them newest first and the last reads
    // would evict the first, so the second request would read every one again.
    // With it, both read the same newest 256, which the cache keeps whole.
    await filled(store, "alpha", MAX_CACHED_WAVES + 1, (wave) => [
      laneOf(`${wave}-a`),
    ]);
    const read = model(store);

    await read.listAttention();
    expect(store.asked).toHaveLength(MAX_ATTENTION_WAVES);

    await read.listAttention();
    expect(store.asked).toHaveLength(MAX_ATTENTION_WAVES);
  });
});
