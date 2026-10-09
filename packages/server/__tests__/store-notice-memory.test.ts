import { describe, expect, it } from "vitest";

import { MemoryStore } from "../src/index.js";
import { event, storedEntry, storedRevision } from "./notice-contract.js";

const PROJECT = "alpha";

function store() {
  return new MemoryStore();
}

describe("MemoryStore notice methods", () => {
  it("lists a project's decisions ordered by id", async () => {
    const s = store();
    await s.appendRevision(PROJECT, "z", storedRevision(1, "z"), 0, 3);
    await s.appendRevision(PROJECT, "a", storedRevision(1, "a"), 0, 3);

    expect((await s.listDecisions(PROJECT)).map((d) => d.id)).toEqual([
      "a",
      "z",
    ]);
    expect(await s.listDecisions("absent")).toEqual([]);
  });

  it("answers missing when the project has no decision on appendEntry", async () => {
    const s = store();
    expect(await s.appendEntry(PROJECT, "d1", storedEntry(0), 0, 1)).toBe(
      "missing",
    );
  });

  it("answers missing when the decision is absent on appendEntry", async () => {
    const s = store();
    await s.appendRevision(PROJECT, "other", storedRevision(1, "other"), 0, 3);
    expect(await s.appendEntry(PROJECT, "d1", storedEntry(0), 0, 1)).toBe(
      "missing",
    );
  });

  it("answers conflict when the revision count is stale on appendRevision", async () => {
    const s = store();
    await s.appendRevision(PROJECT, "d1", storedRevision(1), 0, 3);
    expect(await s.appendRevision(PROJECT, "d1", storedRevision(2), 5, 3)).toBe(
      "conflict",
    );
  });

  it("answers conflict when the revision count is stale on appendEntry", async () => {
    const s = store();
    await s.appendRevision(PROJECT, "d1", storedRevision(1), 0, 3);
    expect(await s.appendEntry(PROJECT, "d1", storedEntry(0), 0, 5)).toBe(
      "conflict",
    );
  });

  it("lists no events for a project that has none", async () => {
    const s = store();
    expect(await s.listEvents(PROJECT, 10)).toEqual([]);
  });

  it("assigns unique ids even after dropping the oldest, same millisecond", async () => {
    const s = store();
    const at = "2026-10-08T13:00:00.000Z";
    const ids: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const { id, dropped } = await s.appendEvent(
        PROJECT,
        { id: "", receivedAt: at, event: event() },
        2,
      );
      ids.push(id);
      expect(dropped).toBe(i > 1 ? 1 : 0);
    }
    expect(new Set(ids).size).toBe(4);
    expect(ids).toEqual([`${at}-1`, `${at}-2`, `${at}-3`, `${at}-4`]);
  });
});

describe("MemoryStore bounds", () => {
  it.each([
    ["NaN", NaN],
    ["zero", 0],
    ["negative", -1],
    ["non-integer", 1.5],
  ])("appendRevision refuses a %s ceiling", async (_label, bad) => {
    const s = store();
    await expect(
      s.appendRevision(PROJECT, "d1", storedRevision(1), 0, bad),
    ).rejects.toThrow(RangeError);
  });

  it.each([
    ["NaN", NaN],
    ["zero", 0],
    ["negative", -1],
    ["non-integer", 1.5],
  ])("appendEvent refuses a %s keep", async (_label, bad) => {
    const s = store();
    await expect(
      s.appendEvent(
        PROJECT,
        { id: "e0", receivedAt: "2026-10-08T13:00:00Z", event: event() },
        bad,
      ),
    ).rejects.toThrow(RangeError);
  });

  it.each([
    ["NaN", NaN],
    ["zero", 0],
    ["negative", -1],
    ["non-integer", 1.5],
  ])("listEvents refuses a %s limit", async (_label, bad) => {
    const s = store();
    await expect(s.listEvents(PROJECT, bad)).rejects.toThrow(RangeError);
  });
});
