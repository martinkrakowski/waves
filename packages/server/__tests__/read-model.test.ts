import { describe, expect, it } from "vitest";

import type { StoredSnapshot } from "@hexagen-monaco/waves-contract";

import { createReadModel } from "../src/application/read-model.js";
import { MemoryStore } from "../src/infrastructure/memory-store.js";
import { project, snapshot } from "./store-contract.js";

type Lane = StoredSnapshot["envelope"]["lanes"][number];

const PUSHED_AT_MS = Date.parse("2026-10-01T12:00:00Z");
const RECEIVED_AT_MS = PUSHED_AT_MS + 1_000;
const BOUNDARY_MS = 30_000;
const NOW_MS = PUSHED_AT_MS + 20_000;
const DAY_MS = 24 * 60 * 60 * 1000;

function withLane(wave: string, alive: boolean): StoredSnapshot {
  return {
    envelope: {
      ...snapshot(wave).envelope,
      lanes: [{ id: `${wave}-a`, derived: { alive }, disagreements: [] }],
    },
    receivedAt: "2026-10-01T12:00:01Z",
  };
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
        lastPush: "2026-10-01T12:00:01Z",
      },
      {
        id: "beta",
        name: "Beta",
        repo: undefined,
        registeredAt: "2026-09-01T09:00:00Z",
        waves: 0,
        lastPush: undefined,
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
