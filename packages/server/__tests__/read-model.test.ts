import { describe, expect, it } from "vitest";

import type { StoredSnapshot } from "@hexagen-monaco/waves-contract";

import { createReadModel } from "../src/application/read-model.js";
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
});
