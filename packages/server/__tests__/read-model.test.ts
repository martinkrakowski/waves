import { describe, expect, it } from "vitest";

import type { StoredSnapshot } from "@hexagen-monaco/waves-contract";

import {
  createReadModel,
  MAX_CACHED_ROWS,
  MAX_CACHED_WAVES,
  MAX_PROJECT_LANES,
  MAX_PROJECT_LANES_BYTES,
  utf8Length,
} from "../src/application/read-model.js";
import { MemoryStore } from "../src/infrastructure/memory-store.js";
import { project, snapshot, withLanes } from "./store-contract.js";

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

  it("keeps no more than the wave bound, dropping the oldest-inserted wave", async () => {
    const store = new WaryStore("wv-absent");
    await store.putProject(project("p1"));
    // Every wave received in the same millisecond, so the order they are read in
    // is the order the store orders its heads in and the first wave of the
    // listing is the first the cache holds. Ids are zero-padded so that `wv10`
    // does not sort before `wv2`.
    for (const at of [...Array(MAX_CACHED_WAVES).keys()]) {
      const wave = `wv${String(at + 1).padStart(3, "0")}`;
      await store.putSnapshot(
        pushed("p1", wave, RECEIVED_AT, [laneOf(`${wave}-a`)]),
      );
    }
    // A second project, with a wave id of its own so the asks are unambiguous.
    await store.putProject(project("p2"));
    await store.putSnapshot(
      pushed("p2", "wv1", RECEIVED_AT, [laneOf("wv1-a")]),
    );
    const read = model(store);

    await read.listLanes("p1", true);
    expect(store.asked).toHaveLength(MAX_CACHED_WAVES);
    expect(store.asked[0]).toBe("wv001");
    // A project holding exactly the bound is held whole, so a poll of it again
    // parses nothing.
    await read.listLanes("p1", true);
    expect(store.asked).toHaveLength(MAX_CACHED_WAVES);

    // The read that fills the map past its bound drops p1's first-inserted wave.
    await read.listLanes("p2", true);
    expect(store.asked).toHaveLength(MAX_CACHED_WAVES + 1);
    await read.listLanes("p2", true);
    expect(store.asked).toHaveLength(MAX_CACHED_WAVES + 1);

    // The wave the bound dropped is the first one p1 is asked for again.
    await read.listLanes("p1", true);
    expect(store.asked[MAX_CACHED_WAVES + 1]).toBe("wv001");
  });

  it("keeps no more than the row bound, dropping the oldest-inserted wave", async () => {
    const store = new WaryStore("wv-absent");
    // Fewer projects than the wave bound, so it is the rows that fill the map
    // past a bound: every wave is at the contract's own cap of 200 lanes.
    const projects = Math.floor(MAX_CACHED_ROWS / LANES_PER_WAVE) + 10;
    expect(projects).toBeLessThan(MAX_CACHED_WAVES);
    const ids = [...Array(projects)].map(
      (_unused, at) => `p${String(at + 1).padStart(3, "0")}`,
    );
    for (const [at, id] of ids.entries()) {
      await store.putProject(project(id));
      const wave = `wv${String(at + 1).padStart(3, "0")}`;
      await store.putSnapshot(
        pushed(
          id,
          wave,
          RECEIVED_AT,
          Array.from({ length: LANES_PER_WAVE }, (_unused, lane) =>
            laneOf(`${wave}-${lane}`),
          ),
        ),
      );
    }
    const read = model(store);
    for (const id of ids) {
      await read.listLanes(id, true);
    }
    expect(store.asked).toHaveLength(projects);

    // The newest wave is still cached, and the oldest-inserted one is not.
    await read.listLanes(ids.at(-1) ?? "", true);
    expect(store.asked).toHaveLength(projects);
    await read.listLanes("p001", true);
    expect(store.asked).toHaveLength(projects + 1);
    expect(store.asked[projects]).toBe("wv001");
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
});
